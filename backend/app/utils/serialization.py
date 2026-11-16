import json
from ..models import DailyMealPlan, User, UserProfile
from .time import to_local_iso


def profile_values(profile: UserProfile | None) -> dict:
    if profile is None:
        return {}
    return {
        "full_name": profile.full_name,
        "date_of_birth": profile.date_of_birth,
        "height_cm": profile.height_cm,
        "weight_kg": profile.weight_kg,
        "sex_for_calculation": profile.sex_for_calculation,
        "activity_level": profile.activity_level,
        "goal": profile.goal,
        "target_weight_kg": profile.target_weight_kg,
        "allergies": json.loads(profile.allergies_json or "[]"),
        "avoid_ingredients": json.loads(profile.avoid_ingredients_json or "[]"),
        "disliked_dishes": json.loads(profile.disliked_dishes_json or "[]"),
        "favorite_dishes": json.loads(profile.favorite_dishes_json or "[]"),
        "updated_at": to_local_iso(profile.updated_at),
    }


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "created_at": to_local_iso(user.created_at),
        "profile": profile_values(user.profile),
    }


def profile_from_payload(profile: UserProfile, values: dict) -> None:
    scalar_fields = (
        "full_name", "date_of_birth", "height_cm", "weight_kg", "sex_for_calculation",
        "activity_level", "goal", "target_weight_kg",
    )
    for key in scalar_fields:
        if key in values:
            setattr(profile, key, values[key])
    json_fields = {
        "allergies": "allergies_json",
        "avoid_ingredients": "avoid_ingredients_json",
        "disliked_dishes": "disliked_dishes_json",
        "favorite_dishes": "favorite_dishes_json",
    }
    for key, column in json_fields.items():
        if key in values:
            setattr(profile, column, json.dumps(values[key], ensure_ascii=False))


def serialize_plan(plan: DailyMealPlan) -> dict:
    return {
        "id": plan.id,
        "plan_date": plan.plan_date.isoformat(),
        "version": plan.version,
        "bmi": plan.bmi_at_generation,
        "bmr_kcal": plan.bmr_at_generation,
        "tdee_kcal": plan.tdee_at_generation,
        "target_calories": plan.target_calories,
        "total_calories": plan.total_calories,
        "goal": plan.goal_snapshot,
        "algorithm_version": plan.algorithm_version,
        "warnings": json.loads(plan.warnings_json or "[]"),
        "created_at": to_local_iso(plan.created_at),
        "meals": [
            {
                "id": item.id,
                "dish_id": item.dish_id,
                "name": item.dish_name_snapshot,
                "food_group": item.food_group_snapshot,
                "ingredients": item.ingredients_snapshot,
                "instructions": item.instructions_snapshot or (item.dish.instructions if item.dish else None),
                "image_url": item.image_url_snapshot or (item.dish.image_url if item.dish else None),
                "meal_type": item.meal_type,
                "is_cooked": item.is_cooked,
                "consumed_ratio": item.consumed_ratio,
                "serving_grams": item.serving_grams,
                "calories": item.calories,
                "protein": item.protein,
                "carb": item.carb,
                "fat": item.fat,
                "position": item.position,
                "reason": item.recommendation_reason,
            }
            for item in plan.items
        ],
        "nutrition_totals": {
            "protein": round(sum(item.protein for item in plan.items), 1),
            "carb": round(sum(item.carb for item in plan.items), 1),
            "fat": round(sum(item.fat for item in plan.items), 1),
        },
        "consumed_totals": {
            "calories": round(sum(item.calories * item.consumed_ratio for item in plan.items), 1),
            "protein": round(sum(item.protein * item.consumed_ratio for item in plan.items), 1),
            "carb": round(sum(item.carb * item.consumed_ratio for item in plan.items), 1),
            "fat": round(sum(item.fat * item.consumed_ratio for item in plan.items), 1),
        },
    }
