from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from fastapi import HTTPException
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
    excluded_dish_ids: set[str] | None = None,
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
    avoid_repeat_ids = set(excluded_dish_ids or ())
    if user_id:
        same_day_rows = db.execute(
            select(MealPlanItem.dish_id)
            .join(DailyMealPlan, MealPlanItem.meal_plan_id == DailyMealPlan.id)
            .where(DailyMealPlan.user_id == user_id, DailyMealPlan.plan_date == plan_date)
        ).scalars().all()
        avoid_repeat_ids.update(same_day_rows)
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
        except Exception as exc:
            raise HTTPException(503, f"Không thể dự đoán bằng Random Forest: {type(exc).__name__}.") from exc
    if len(model_scores) != len(eligible):
        raise HTTPException(503, "Random Forest không trả đủ điểm cho các món đủ điều kiện.")

    selected: list[dict] = []
    main_share = 1.0 if side_meals == 0 else 0.85
    main_split_total = sum(split[MEALS[index % len(MEALS)]] for index in range(main_meals))
    slots: list[tuple[str, str, float]] = []
    for index in range(main_meals):
        meal = MEALS[index % len(MEALS)]
        meal_occurrences = sum(1 for i in range(main_meals) if MEALS[i % len(MEALS)] == meal)
        slots.append((meal, "main", main_share * split[meal] / main_split_total / meal_occurrences))
    for _ in range(side_meals):
        slots.append(("snack", "side", (1.0 - main_share) / side_meals if side_meals else 0.0))
    candidate_slots: list[tuple[str, str, float, list[Dish]]] = []
    repeat_fallback_slots = 0
    for meal, course_type, slot_share in slots:
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
        if categorized:
            fresh = [dish for dish in categorized if dish.id not in avoid_repeat_ids]
            if fresh:
                slot_candidates = fresh
            else:
                slot_candidates = categorized
                if avoid_repeat_ids:
                    repeat_fallback_slots += 1
        else:
            # Keep older datasets usable, but surface that the category label
            # could not be honored for this slot.
            fresh = [dish for dish in eligible if dish.id not in avoid_repeat_ids]
            slot_candidates = fresh or eligible
            if not fresh and avoid_repeat_ids:
                repeat_fallback_slots += 1
            warnings.append(
                f"Không còn món thuộc nhóm phù hợp cho {'bữa phụ' if course_type == 'side' else 'bữa ' + meal}; đã mở rộng sang các nhóm món khác."
            )
        candidate_slots.append((meal, course_type, slot_share, slot_candidates))

    if repeat_fallback_slots:
        warnings.append(
            f"Có {repeat_fallback_slots} bữa phải dùng lại nhóm món từ phiên bản trước vì danh sách món phù hợp đã giới hạn."
        )

    if any(not slot_candidates for _, _, _, slot_candidates in candidate_slots):
        raise ValueError("Không có món đủ điều kiện cho một hoặc nhiều bữa.")

    # Beam search chooses the whole day together. Every partial plan is rejected
    # as soon as its calories exceed the daily target; ranking then balances
    # calorie proximity, all three macro targets, and the selected-goal RF score.
    beam_width = 120
    candidate_limit = 80
    beam: list[list[Dish]] = [[]]
    for slot_index, (meal, _course_type, slot_share, slot_candidates) in enumerate(candidate_slots):
        meal_budget = target_calories * slot_share
        macro_targets = {
            key: (target_macros or {}).get(key, 0.0) * slot_share
            for key in ("protein", "carb", "fat")
        }
        local_ranked = []
        for dish in slot_candidates:
            nutrition = _nutrition(dish)
            macro_fit = sum(
                max(0.0, 1 - abs(nutrition[key] - macro_targets[key]) / max(macro_targets[key], 1.0))
                for key in macro_targets
            ) / 3 if target_macros else 0.5
            calorie_fit = max(0.0, 1 - abs(nutrition["calories"] - meal_budget) / max(meal_budget, 1.0))
            local_ranked.append((
                0.50 * macro_fit + 0.25 * calorie_fit + 0.25 * model_scores[dish.id],
                dish,
            ))
        local_ranked.sort(key=lambda pair: (pair[0], pair[1].id), reverse=True)
        candidate_pool = [dish for _, dish in local_ranked[:candidate_limit]]
        expanded: list[list[Dish]] = []
        for partial in beam:
            used = {dish.id for dish in partial}
            current_calories = sum(dish.calories_per_serving for dish in partial)
            for dish in candidate_pool:
                if dish.id in used or current_calories + dish.calories_per_serving > target_calories + 1e-9:
                    continue
                expanded.append([*partial, dish])
        if not expanded:
            raise ValueError("Không tìm thấy tổ hợp món đủ số bữa mà tổng calo không vượt mục tiêu.")

        progress = sum(slot[2] for slot in candidate_slots[:slot_index + 1])
        expected_calories = target_calories * progress
        expected_macros = {
            key: (target_macros or {}).get(key, 0.0) * progress
            for key in ("protein", "carb", "fat")
        }
        def partial_score(plan: list[Dish]) -> float:
            totals = {
                "calories": sum(d.calories_per_serving for d in plan),
                "protein": sum(d.protein_per_serving for d in plan),
                "carb": sum(d.carb_per_serving for d in plan),
                "fat": sum(d.fat_per_serving for d in plan),
            }
            calorie_fit = max(0.0, 1 - abs(totals["calories"] - expected_calories) / max(expected_calories, 1.0))
            macro_fit = sum(
                max(0.0, 1 - abs(totals[key] - expected_macros[key]) / max(expected_macros[key], 1.0))
                for key in expected_macros
            ) / 3 if target_macros else 0.5
            rf_fit = sum(model_scores[d.id] for d in plan) / len(plan)
            variety_fit = len({d.food_group for d in plan}) / len(plan)
            repeat_penalty = sum(_repeat_penalty(d.id, counts) for d in plan) / len(plan)
            return 0.45 * macro_fit + 0.25 * calorie_fit + 0.25 * rf_fit + 0.05 * (variety_fit - repeat_penalty)
        beam = sorted(expanded, key=lambda plan: (partial_score(plan), tuple(d.id for d in plan)), reverse=True)[:beam_width]

    best = max(beam, key=partial_score)
    for index, (meal, course_type, slot_share, _) in enumerate(candidate_slots):
        dish = best[index]
        nutrition = _nutrition(dish)
        model_score = model_scores[dish.id]
        repeat = _repeat_penalty(dish.id, counts)
        meal_budget = target_calories * slot_share
        reason = (
            f"Random Forest: {model_score:.0%} phù hợp mục tiêu {GOAL_LABEL_BY_PROFILE.get(profile.goal, profile.goal)}. "
            f"Khẩu phần {dish.serving_g:.0f} g; {nutrition['calories']:.0f} kcal. "
            f"Ngân sách bữa tham chiếu {meal_budget:.0f} kcal."
        )
        if repeat:
            reason += f" Món có lịch sử gần đây (mức phạt {repeat:.2f})."
        if any(term in dish.name.casefold() for term in favorites):
            reason += " Khớp món yêu thích."
        selected.append({
            "dish_id": dish.id, "dish_name": dish.name, "food_group": dish.food_group,
            "ingredients": dish.ingredients, "instructions": dish.instructions,
            "image_url": dish.image_url, "meal_type": meal, "course_type": course_type,
            "serving_grams": round(dish.serving_g, 1),
            **{key: round(value, 1) for key, value in nutrition.items()},
            "position": len(selected), "recommendation_reason": reason,
        })
    if len(selected) < main_meals + side_meals:
        raise ValueError("Không đủ món phù hợp để tạo đủ số bữa đã chọn.")
    if len(eligible) < 10:
        warnings.append("Dataset sau lọc có ít món khả dụng; độ đa dạng và hạn chế lặp có thể bị giới hạn.")
    return selected, warnings
