import json
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import state
from ..catalog import get_dishes
from ..models import DailyMealPlan, Dish, MealPlanItem, User
from ..nutrition import age_on, calculate
from ..recommender import generate_meals
from .ingredient_recommender import dish_is_avoided
from ..utils.profiles import profile_for_calculation
from ..utils.serialization import serialize_plan


def create_meal_plan(
    db: Session,
    user: User,
    plan_date: date,
    split: dict | None = None,
    excluded_plan_id: int | None = None,
    override_dish: Dish | None = None,
    override_meal_type: str | None = None,
    main_meals: int = 3,
    side_meals: int = 0,
) -> dict:
    # Kept for caller compatibility; all same-day versions now contribute to
    # the variety penalty and no longer need to be special-cased.
    profile = user.profile
    if profile is None:
        raise HTTPException(422, "Hãy hoàn thiện hồ sơ dinh dưỡng trước khi tạo thực đơn.")
    fields = profile_for_calculation(profile)
    age = age_on(fields["date_of_birth"], plan_date)
    nutrition = calculate(
        age,
        fields["height_cm"],
        fields["weight_kg"],
        fields["sex_for_calculation"],
        fields["activity_level"],
        fields["goal"],
    )
    if nutrition["medical_review_required"]:
        raise HTTPException(
            422,
            {
                "message": "Cần chuyên gia đánh giá trước khi tạo thực đơn tự động.",
                "nutrition": nutrition,
            },
        )

    dishes = get_dishes(db)
    if not dishes:
        raise HTTPException(503, "Catalog món ăn chưa được nạp; kiểm tra NUTRIAI_DATASET_PATH.")
    try:
        selected, warnings = generate_meals(
            db,
            user.id,
            profile,
            dishes,
            plan_date,
            nutrition["target_calories"],
            split,
            model_bundle=state.model_bundle,
            target_macros={
                "protein": nutrition["protein_g"],
                "carb": nutrition["carb_g"],
                "fat": nutrition["fat_g"],
            },
            main_meals=main_meals,
            side_meals=side_meals,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    if override_dish is not None:
        if override_meal_type not in {"breakfast", "lunch", "dinner"}:
            raise HTTPException(422, "Bữa ăn được chọn không hợp lệ.")
        _validate_manual_dish(override_dish, profile)
        replacement = _manual_dish_item(override_dish, override_meal_type)
        selected = [
            replacement if item["meal_type"] == override_meal_type else item
            for item in selected
        ]

    warnings.extend(nutrition["warnings"])
    if state.model_warning:
        warnings.append(state.model_warning)
    version = (
        db.scalar(
            select(func.max(DailyMealPlan.version)).where(
                DailyMealPlan.user_id == user.id,
                DailyMealPlan.plan_date == plan_date,
            )
        )
        or 0
    ) + 1
    total_calories = round(sum(item["calories"] for item in selected), 1)
    if abs(total_calories - nutrition["target_calories"]) / max(nutrition["target_calories"], 1) > 0.15:
        warnings.append(
            "Tổng calo thực đơn lệch hơn 15% so với mục tiêu; giới hạn khẩu phần và lựa chọn trong dataset không cho phép khớp sát hơn."
        )

    plan = DailyMealPlan(
        user_id=user.id,
        plan_date=plan_date,
        version=version,
        bmi_at_generation=nutrition["bmi"],
        bmr_at_generation=nutrition["bmr_kcal"],
        tdee_at_generation=nutrition["tdee_kcal"],
        target_calories=nutrition["target_calories"],
        total_calories=total_calories,
        goal_snapshot=fields["goal"],
        warnings_json=json.dumps(warnings, ensure_ascii=False),
    )
    for item in selected:
        plan.items.append(
            MealPlanItem(
                dish_id=item["dish_id"],
                dish_name_snapshot=item["dish_name"],
                food_group_snapshot=item["food_group"],
                ingredients_snapshot=item["ingredients"],
                instructions_snapshot=item["instructions"],
                image_url_snapshot=item["image_url"],
                meal_type=item["meal_type"],
                serving_grams=item["serving_grams"],
                calories=item["calories"],
                protein=item["protein"],
                carb=item["carb"],
                fat=item["fat"],
                position=item["position"],
                recommendation_reason=item["recommendation_reason"],
            )
        )
    try:
        db.add(plan)
        db.commit()
        db.refresh(plan)
    except Exception:
        db.rollback()
        raise
    return serialize_plan(plan)


def replace_meal_with_dish(
    db: Session,
    user: User,
    old_plan: DailyMealPlan,
    dish: Dish,
    meal_type: str,
) -> dict:
    """Create a new immutable version with one meal replaced by a catalog dish."""
    if meal_type not in {"breakfast", "lunch", "dinner"}:
        raise HTTPException(422, "Bữa ăn được chọn không hợp lệ.")
    _validate_manual_dish(dish, user.profile)
    replacement = _manual_dish_item(dish, meal_type)
    prior_slot = next((item for item in old_plan.items if item.meal_type == meal_type), None)
    replacement["position"] = prior_slot.position if prior_slot else max((item.position for item in old_plan.items), default=-1) + 1

    warnings = json.loads(old_plan.warnings_json or "[]")
    warnings.append("Một món được người dùng chọn và thay vào thực đơn; phiên bản trước vẫn được giữ trong lịch sử.")
    total_calories = round(
        sum(item.calories for item in old_plan.items if item.meal_type != meal_type)
        + replacement["calories"],
        1,
    )
    if abs(total_calories - old_plan.target_calories) / max(old_plan.target_calories, 1) > 0.15:
        warnings.append("Tổng calo sau khi thay món lệch hơn 15% so với mục tiêu ngày.")
    version = (
        db.scalar(select(func.max(DailyMealPlan.version)).where(
            DailyMealPlan.user_id == user.id,
            DailyMealPlan.plan_date == old_plan.plan_date,
        )) or 0
    ) + 1
    new_plan = DailyMealPlan(
        user_id=user.id,
        plan_date=old_plan.plan_date,
        version=version,
        bmi_at_generation=old_plan.bmi_at_generation,
        bmr_at_generation=old_plan.bmr_at_generation,
        tdee_at_generation=old_plan.tdee_at_generation,
        target_calories=old_plan.target_calories,
        total_calories=total_calories,
        goal_snapshot=old_plan.goal_snapshot,
        algorithm_version="nutriai-recommender-1+manual",
        warnings_json=json.dumps(warnings, ensure_ascii=False),
    )
    for item in old_plan.items:
        if item.meal_type == meal_type:
            continue
        new_plan.items.append(MealPlanItem(
            dish_id=item.dish_id,
            dish_name_snapshot=item.dish_name_snapshot,
            food_group_snapshot=item.food_group_snapshot,
            ingredients_snapshot=item.ingredients_snapshot,
            instructions_snapshot=item.instructions_snapshot,
            image_url_snapshot=item.image_url_snapshot,
            meal_type=item.meal_type,
            serving_grams=item.serving_grams,
            calories=item.calories,
            protein=item.protein,
            carb=item.carb,
            fat=item.fat,
            position=item.position,
            recommendation_reason=item.recommendation_reason,
        ))
    new_plan.items.append(MealPlanItem(
        dish_id=replacement["dish_id"],
        dish_name_snapshot=replacement["dish_name"],
        food_group_snapshot=replacement["food_group"],
        ingredients_snapshot=replacement["ingredients"],
        instructions_snapshot=replacement["instructions"],
        image_url_snapshot=replacement["image_url"],
        meal_type=meal_type,
        serving_grams=replacement["serving_grams"],
        calories=replacement["calories"],
        protein=replacement["protein"],
        carb=replacement["carb"],
        fat=replacement["fat"],
        position=replacement["position"],
        recommendation_reason=replacement["recommendation_reason"],
    ))
    try:
        db.add(new_plan)
        db.commit()
        db.refresh(new_plan)
    except Exception:
        db.rollback()
        raise
    return serialize_plan(new_plan)


def _validate_manual_dish(dish: Dish, profile) -> None:
    if not dish.ingredients or not dish.ingredients.strip():
        raise HTTPException(422, "Món chưa có danh sách nguyên liệu để xác minh lựa chọn.")
    required = (
        dish.serving_g,
        dish.calories_per_serving,
        dish.protein_per_serving,
        dish.carb_per_serving,
        dish.fat_per_serving,
    )
    if any(value is None for value in required) or dish.serving_g <= 0:
        raise HTTPException(422, "Món thiếu dữ liệu khẩu phần hoặc dinh dưỡng để lưu vào thực đơn.")
    if dish.kcal_macro_mismatch or (dish.calories_per_100g is not None and (dish.calories_per_100g < 0 or dish.calories_per_100g > 900)):
        raise HTTPException(422, "Món có dữ liệu năng lượng bất thường và không thể đưa vào thực đơn.")
    if dish_is_avoided(dish, profile):
        raise HTTPException(422, "Món có nguyên liệu trùng với danh sách dị ứng hoặc cần tránh trong hồ sơ.")


def _manual_dish_item(dish: Dish, meal_type: str) -> dict:
    grams = dish.serving_g
    return {
        "dish_id": dish.id,
        "dish_name": dish.name,
        "food_group": dish.food_group,
        "ingredients": dish.ingredients,
        "instructions": dish.instructions,
        "image_url": dish.image_url,
        "meal_type": meal_type,
        "serving_grams": round(grams, 1),
        "calories": round(dish.calories_per_serving, 1),
        "protein": round(dish.protein_per_serving, 1),
        "carb": round(dish.carb_per_serving, 1),
        "fat": round(dish.fat_per_serving, 1),
        "position": 0,
        "recommendation_reason": "Người dùng chọn món từ kết quả tìm theo nguyên liệu; dinh dưỡng được tính từ dữ liệu trên 100 g theo khẩu phần catalog.",
    }
