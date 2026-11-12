from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import DailyMealPlan, Dish, MealPlanItem, UserProfile

MEALS = ("breakfast", "lunch", "dinner")


def _profile_list(profile: UserProfile, key: str) -> list[str]:
    import json
    return [str(v).strip().casefold() for v in json.loads(getattr(profile, key) or "[]") if str(v).strip()]


def history_counts(db: Session, user_id: int, plan_date: date, excluded_plan_id: int | None = None) -> tuple[Counter, dict[str, set[str]]]:
    lower = plan_date - timedelta(days=30)
    plans = list(db.scalars(select(DailyMealPlan).where(
        DailyMealPlan.user_id == user_id,
        DailyMealPlan.plan_date >= lower,
        DailyMealPlan.plan_date <= plan_date,
    )).all())
    counts: Counter = Counter()
    same_day: set[str] = set()
    counted_by_day: dict[date, set[str]] = {}
    for plan in plans:
        # Regeneration treats prior same-day versions as repeated history too.
        days_ago = (plan_date - plan.plan_date).days
        day_dishes = counted_by_day.setdefault(plan.plan_date, set())
        for item in plan.items:
            # Multiple saved versions on a date represent one day's exposure;
            # count each dish once per day so regenerating does not inflate its penalty.
            if item.dish_id not in day_dishes:
                counts[(item.dish_id, days_ago)] += 1
                day_dishes.add(item.dish_id)
            if days_ago == 0:
                same_day.add(item.dish_id)
    if excluded_plan_id:
        old_plan = db.scalar(select(DailyMealPlan).where(
            DailyMealPlan.id == excluded_plan_id, DailyMealPlan.user_id == user_id,
        ))
        if old_plan:
            same_day.update(i.dish_id for i in old_plan.items)
    return counts, {"same_day": same_day}


def _repeat_penalty(dish_id: str, counts: Counter, plan_date: date) -> float:
    weights = settings.repeat_penalties
    penalty = 0.0
    for (seen_id, days_ago), frequency in counts.items():
        if seen_id != dish_id:
            continue
        bucket = "same_day" if days_ago == 0 else "yesterday" if days_ago == 1 else "three_days" if days_ago <= 3 else "seven_days" if days_ago <= 7 else "thirty_days"
        penalty += weights[bucket] * frequency
    return min(1.5, penalty)


def _nutrition(dish: Dish, grams: float) -> dict[str, float]:
    factor = grams / 100.0
    return {
        "calories": dish.calories_per_100g * factor,
        "protein": dish.protein_per_100g * factor,
        "carb": dish.carb_per_100g * factor,
        "fat": dish.fat_per_100g * factor,
    }


def generate_meals(
    db: Session, user_id: int, profile: UserProfile, dishes: list[Dish], plan_date: date,
    target_calories: float, split: dict[str, float] | None = None,
    excluded_plan_id: int | None = None, model_bundle: dict | None = None,
    target_macros: dict[str, float] | None = None,
) -> tuple[list[dict], list[str]]:
    split = split or settings.meal_split
    if set(split) != set(MEALS) or any(v <= 0 for v in split.values()) or abs(sum(split.values()) - 1.0) > 0.01:
        raise ValueError("meal_split phải có breakfast/lunch/dinner, giá trị dương và tổng bằng 1.")
    allergy_terms = _profile_list(profile, "allergies_json") + _profile_list(profile, "avoid_ingredients_json")
    dislikes = _profile_list(profile, "disliked_dishes_json")
    favorites = _profile_list(profile, "favorite_dishes_json")
    counts, _ = history_counts(db, user_id, plan_date, excluded_plan_id)
    warnings: list[str] = []
    eligible = []
    excluded = 0
    for dish in dishes:
        values = [dish.calories_per_100g, dish.protein_per_100g, dish.carb_per_100g, dish.fat_per_100g, dish.serving_g]
        if (any(v is None for v in values) or dish.serving_g <= 0
                or dish.calories_per_100g < 0 or dish.calories_per_100g > 900
                or dish.kcal_macro_mismatch):
            excluded += 1
            continue
        haystack = f"{dish.name} {dish.ingredients or ''}".casefold()
        if any(term in haystack for term in allergy_terms) or any(term in dish.name.casefold() for term in dislikes):
            excluded += 1
            continue
        eligible.append(dish)
    if excluded:
        warnings.append(f"Đã loại {excluded} món do thiếu dữ liệu, ngoại lệ dinh dưỡng hoặc khớp chuỗi dị ứng/nguyên liệu tránh/tên món không thích.")
    if allergy_terms:
        warnings.append("Lọc dị ứng chỉ dựa trên chuỗi nguyên liệu trong workbook; không bảo đảm không nhiễm chéo hoặc an toàn tuyệt đối.")
    if len(eligible) < 3:
        raise ValueError("Còn ít hơn 3 món đủ dữ liệu sau lọc; chưa thể tạo đủ ba bữa.")

    # Predict once for the whole catalog instead of invoking sklearn once for
    # every candidate in every meal. Repeated single-row predict calls can make
    # a large catalog exceed the frontend request timeout.
    model_scores: dict[str, float] = {}
    if model_bundle:
        try:
            model = model_bundle["model"]
            predictions = model.predict([
                [
                    dish.calories_per_100g,
                    dish.protein_per_100g,
                    dish.carb_per_100g,
                    dish.fat_per_100g,
                ]
                for dish in eligible
            ])
            expected = {
                "lose_weight": 0,
                "gain_weight": 1,
                "maintain_weight": 2,
                "gain_muscle": 3,
            }[profile.goal]
            model_scores = {
                dish.id: (1.0 if int(prediction) == expected else 0.0)
                for dish, prediction in zip(eligible, predictions)
            }
        except Exception:
            # Model inference is a weak optional signal; ranking can continue
            # from nutrition, preferences, variety, and history alone.
            model_scores = {}

    selected: list[dict] = []
    selected_ids: set[str] = set()
    selected_groups: set[str] = set()
    for meal in MEALS:
        meal_budget = target_calories * split[meal]
        ranking = []
        for dish in eligible:
            if dish.id in selected_ids:
                continue
            # Portion derived only from validated per-100g nutrient values.
            raw_grams = meal_budget * 100 / dish.calories_per_100g if dish.calories_per_100g > 0 else dish.serving_g
            grams = min(max(raw_grams, dish.serving_g * 0.5), dish.serving_g * 2.0)
            nutrition = _nutrition(dish, grams)
            calorie_score = max(0.0, 1 - abs(nutrition["calories"] - meal_budget) / max(meal_budget, 1))
            if target_macros:
                macro_scores = [
                    max(0.0, 1 - abs(nutrition[key] - target_macros[key] * split[meal]) / max(target_macros[key] * split[meal], 1))
                    for key in ("protein", "carb", "fat")
                ]
                macro_score = sum(macro_scores) / len(macro_scores)
            else:
                macro_score = 0.5
            if profile.goal == "gain_muscle":
                goal_score = min(1.0, nutrition["protein"] / max(meal_budget * .06, 1))
            elif profile.goal == "lose_weight":
                goal_score = max(0.0, min(1.0, 1 - (dish.calories_per_100g / 400)))
            elif profile.goal == "gain_weight":
                goal_score = min(1.0, nutrition["calories"] / max(meal_budget, 1))
            else:
                goal_score = 1.0 - min(1.0, abs(nutrition["calories"] - meal_budget) / max(meal_budget, 1))
            dish_name = dish.name.casefold()
            preference_score = 1.0 if any(term in dish_name for term in favorites) else 0.5
            variety_score = 0.0 if dish.food_group in selected_groups else 1.0
            repeat = _repeat_penalty(dish.id, counts, plan_date)
            weights = settings.score_weights
            # Keep the supervised model as a weak secondary signal: its labels
            # were rule-generated and must not override nutrition constraints.
            model_score = model_scores.get(dish.id, 0.5)
            score = (0.95 * (weights["calorie"] * calorie_score + weights["goal"] * goal_score
                     + weights["preference"] * preference_score + weights["variety"] * variety_score
                     + weights["macro"] * macro_score)
                     + 0.05 * model_score - settings.repeat_penalties["same_day"] * repeat)
            ranking.append((score, -repeat, dish, grams, nutrition, repeat, macro_score))
        if not ranking:
            warnings.append("Không đủ món duy nhất cho từng bữa; dữ liệu lựa chọn bị hạn chế.")
            break
        ranking.sort(key=lambda x: (x[0], x[1], x[2].id), reverse=True)
        score, _, dish, grams, nutrition, repeat, macro_score = ranking[0]
        selected_ids.add(dish.id)
        selected_groups.add(dish.food_group or "")
        reason = f"Điểm xếp hạng {score:.3f}: phù hợp ngân sách bữa {meal_budget:.0f} kcal và mục tiêu đa lượng của bữa (độ khớp {macro_score:.0%}); khẩu phần tính từ dinh dưỡng trên 100 g."
        if model_bundle:
            reason += " Dự đoán Random Forest chỉ đóng góp tối đa 5% điểm; mô hình học từ nhãn quy tắc."
        if repeat:
            reason += f" Món có lịch sử gần đây (mức phạt {repeat:.2f}); tập món khả dụng có giới hạn."
        if any(term in dish.name.casefold() for term in favorites):
            reason += " Khớp món yêu thích."
        selected.append({
            "dish_id": dish.id, "dish_name": dish.name, "food_group": dish.food_group,
            "ingredients": dish.ingredients, "instructions": dish.instructions,
            "image_url": dish.image_url, "meal_type": meal, "serving_grams": round(grams, 1),
            **{key: round(value, 1) for key, value in nutrition.items()},
            "position": len(selected), "recommendation_reason": reason,
        })
    if len(selected) < 3:
        raise ValueError("Không thể chọn đủ món duy nhất cho sáng, trưa và tối.")
    if len(eligible) < 10:
        warnings.append("Dataset sau lọc có ít món khả dụng; độ đa dạng và hạn chế lặp có thể bị giới hạn.")
    return selected, warnings
