from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import DailyMealPlan, Dish, MealPlanItem, UserProfile

MEALS = ("breakfast", "lunch", "dinner")
GOAL_LABEL_BY_PROFILE = {
    "lose_weight": "Giảm cân",
    "gain_weight": "Tăng cân",
    "maintain_weight": "Duy trì",
    "gain_muscle": "Tăng cơ",
}


def _profile_list(profile: UserProfile, key: str) -> list[str]:
    import json
    return [str(v).strip().casefold() for v in json.loads(getattr(profile, key) or "[]") if str(v).strip()]


def history_counts(db: Session, user_id: int, plan_date: date) -> Counter:
    lower = plan_date - timedelta(days=30)
    rows = db.execute(
        select(MealPlanItem.dish_id, DailyMealPlan.plan_date)
        .join(DailyMealPlan, MealPlanItem.meal_plan_id == DailyMealPlan.id)
        .where(
            DailyMealPlan.user_id == user_id,
            DailyMealPlan.plan_date >= lower,
            DailyMealPlan.plan_date <= plan_date,
        )
    ).all()
    counts: Counter = Counter()
    counted_by_day: dict[date, set[str]] = {}
    for dish_id, exposure_date in rows:
        # Regeneration treats prior same-day versions as repeated history too.
        days_ago = (plan_date - exposure_date).days
        day_dishes = counted_by_day.setdefault(exposure_date, set())
        # Multiple saved versions on a date represent one day's exposure.
        if dish_id not in day_dishes:
            bucket = "same_day" if days_ago == 0 else "yesterday" if days_ago == 1 else "three_days" if days_ago <= 3 else "seven_days" if days_ago <= 7 else "thirty_days"
            counts[dish_id] += settings.repeat_penalties[bucket]
            day_dishes.add(dish_id)
    return counts


def _repeat_penalty(dish_id: str, counts: Counter) -> float:
    return min(1.5, counts[dish_id])


def _nutrition(dish: Dish) -> dict[str, float]:
    """Return the workbook's whole-serving nutrition values for this dish."""
    return {
        "calories": dish.calories_per_serving,
        "protein": dish.protein_per_serving,
        "carb": dish.carb_per_serving,
        "fat": dish.fat_per_serving,
    }


def generate_meals(
    db: Session, user_id: int, profile: UserProfile, dishes: list[Dish], plan_date: date,
    target_calories: float, split: dict[str, float] | None = None,
    model_bundle: dict | None = None,
    target_macros: dict[str, float] | None = None,
    main_meals: int = 3,
    side_meals: int = 0,
) -> tuple[list[dict], list[str]]:
    split = split or settings.meal_split
    if set(split) != set(MEALS) or any(v <= 0 for v in split.values()) or abs(sum(split.values()) - 1.0) > 0.01:
        raise ValueError("meal_split phải có breakfast/lunch/dinner, giá trị dương và tổng bằng 1.")
    if not 1 <= main_meals <= 9 or not 0 <= side_meals <= 6:
        raise ValueError("Số bữa chính phải từ 1 đến 9; số bữa phụ từ 0 đến 6.")
    allergy_terms = _profile_list(profile, "allergies_json") + _profile_list(profile, "avoid_ingredients_json")
    dislikes = _profile_list(profile, "disliked_dishes_json")
    favorites = _profile_list(profile, "favorite_dishes_json")
    counts = history_counts(db, user_id, plan_date)
    warnings: list[str] = []
    eligible = []
    excluded = 0
    for dish in dishes:
        values = [
            dish.calories_per_100g, dish.protein_per_100g, dish.carb_per_100g, dish.fat_per_100g,
            dish.calories_per_serving, dish.protein_per_serving, dish.carb_per_serving,
            dish.fat_per_serving, dish.serving_g,
        ]
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

    # Score the already-filtered candidates once. The probability of the class
    # matching the user's goal is the primary ordering signal for every meal.
    model_scores: dict[str, float] = {}
    if model_bundle:
        try:
            model = model_bundle["model"]
            features = [
                [
                    dish.calories_per_100g,
                    dish.protein_per_100g,
                    dish.carb_per_100g,
                    dish.fat_per_100g,
                ]
                for dish in eligible
            ]
            expected = {
                "lose_weight": 0,
                "gain_weight": 1,
                "maintain_weight": 2,
                "gain_muscle": 3,
            }[profile.goal]
            if hasattr(model, "predict_proba"):
                class_ids = [int(value) for value in model.classes_]
                if expected not in class_ids:
                    raise ValueError(f"Model không có lớp mục tiêu {expected}.")
                probabilities = model.predict_proba(features)
                goal_index = class_ids.index(expected)
                model_scores = {
                    dish.id: float(probabilities[index][goal_index])
                    for index, dish in enumerate(eligible)
                }
            else:
                predictions = model.predict(features)
                model_scores = {
                    dish.id: (1.0 if int(prediction) == expected else 0.0)
                    for dish, prediction in zip(eligible, predictions)
                }
        except Exception:
            # Never reintroduce filtered dishes if model inference is unavailable.
            model_scores = {}
    if not model_scores:
        warnings.append("Random Forest chưa sẵn sàng; các món đạt điều kiện được xếp theo độ khớp dinh dưỡng.")

    selected: list[dict] = []
    selected_ids: set[str] = set()
    selected_groups: set[str] = set()
    main_share = 1.0 if side_meals == 0 else 0.85
    main_split_total = sum(split[MEALS[index % len(MEALS)]] for index in range(main_meals))
    slots: list[tuple[str, str, float]] = []
    for index in range(main_meals):
        meal = MEALS[index % len(MEALS)]
        meal_occurrences = sum(1 for i in range(main_meals) if MEALS[i % len(MEALS)] == meal)
        slots.append((meal, "main", main_share * split[meal] / main_split_total / meal_occurrences))
    for _ in range(side_meals):
        slots.append(("snack", "side", (1.0 - main_share) / side_meals if side_meals else 0.0))
    for meal, course_type, slot_share in slots:
        meal_budget = target_calories * slot_share
        if course_type == "side":
            allowed_categories = {"ăn vặt", "nước uống", "sữa"}
        elif meal == "breakfast":
            allowed_categories = {"bữa sáng"}
        else:
            allowed_categories = {"món chính", "bữa sáng"}
        categorized = [
            dish for dish in eligible
            if (dish.meal_category or "").strip().casefold() in allowed_categories
        ]
        available_categorized = [dish for dish in categorized if dish.id not in selected_ids]
        if available_categorized:
            slot_candidates = categorized
        else:
            # Old catalogs and small filtered pools may not contain a matching
            # category. Preserve plan generation, but make the fallback visible.
            slot_candidates = eligible
            warnings.append(
                f"Không còn món thuộc nhóm phù hợp cho {'bữa phụ' if course_type == 'side' else 'bữa ' + meal}; đã mở rộng sang các nhóm món khác."
            )
        ranking = []
        for dish in slot_candidates:
            if dish.id in selected_ids:
                continue
            # Use the catalog serving and its total nutrition from the workbook.
            grams = dish.serving_g
            nutrition = _nutrition(dish)
            calorie_score = max(0.0, 1 - abs(nutrition["calories"] - meal_budget) / max(meal_budget, 1))
            if target_macros:
                macro_scores = [
                    max(0.0, 1 - abs(nutrition[key] - target_macros[key] * slot_share) / max(target_macros[key] * slot_share, 1))
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
            repeat = _repeat_penalty(dish.id, counts)
            weights = settings.score_weights
            secondary_score = (
                weights["calorie"] * calorie_score
                + weights["goal"] * goal_score
                + weights["preference"] * preference_score
                + weights["variety"] * variety_score
                + weights["macro"] * macro_score
                - settings.repeat_penalties["same_day"] * repeat
            )
            model_score = model_scores.get(dish.id)
            ranking.append((model_score, secondary_score, -repeat, dish, grams, nutrition, repeat, macro_score))
        if not ranking:
            warnings.append("Không đủ món duy nhất cho từng bữa; dữ liệu lựa chọn bị hạn chế.")
            break
        # Highest goal-class probability wins. Nutrition fit, preference,
        # variety, and history only break ties or rank when the model is off.
        ranking.sort(key=lambda x: (
            x[0] if x[0] is not None else -1.0,
            x[1], x[2], x[3].id,
        ), reverse=True)
        model_score, secondary_score, _, dish, grams, nutrition, repeat, macro_score = ranking[0]
        selected_ids.add(dish.id)
        selected_groups.add(dish.food_group or "")
        reason = f"Khẩu phần {grams:.0f} g; dinh dưỡng theo workbook ({nutrition['calories']:.0f} kcal). Độ khớp ngân sách bữa {meal_budget:.0f} kcal là {macro_score:.0%}."
        if model_score is not None:
            reason = f"Điểm Random Forest cho mục tiêu {GOAL_LABEL_BY_PROFILE.get(profile.goal, profile.goal)}: {model_score:.0%}. " + reason
        else:
            reason = f"Điểm xếp hạng dinh dưỡng: {secondary_score:.3f}. " + reason
        if repeat:
            reason += f" Món có lịch sử gần đây (mức phạt {repeat:.2f}); tập món khả dụng có giới hạn."
        if any(term in dish.name.casefold() for term in favorites):
            reason += " Khớp món yêu thích."
        selected.append({
            "dish_id": dish.id, "dish_name": dish.name, "food_group": dish.food_group,
            "ingredients": dish.ingredients, "instructions": dish.instructions,
            "image_url": dish.image_url, "meal_type": meal, "course_type": course_type, "serving_grams": round(grams, 1),
            **{key: round(value, 1) for key, value in nutrition.items()},
            "position": len(selected), "recommendation_reason": reason,
        })
    if len(selected) < main_meals + side_meals:
        raise ValueError("Không đủ món phù hợp để tạo đủ số bữa đã chọn.")
    if len(eligible) < 10:
        warnings.append("Dataset sau lọc có ít món khả dụng; độ đa dạng và hạn chế lặp có thể bị giới hạn.")
    return selected, warnings
