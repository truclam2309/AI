import csv
import io
import json
from datetime import date
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from .. import state
from ..catalog import get_dishes
from ..dependencies import current_user
from ..models import DailyMealPlan, Dish, MealPlanItem, User, UserProfile
from ..nutrition import age_on, calculate
from ..recommender import generate_meals
from ..schemas import ConsumptionInput, CookedInput, GenerateInput, GuestMealPlanPreviewInput, SelectDishInput
from ..services.meal_plans import _manual_dish_item, _validate_manual_dish, create_meal_plan, replace_meal_with_dish
from ..utils.profiles import profile_for_calculation
from ..utils.time import local_today
from ..utils.serialization import serialize_plan

router = APIRouter(prefix="/api/v1/meal-plans", tags=["Meal plans"])


@router.post("/preview")
def preview_for_guest(payload: GuestMealPlanPreviewInput, db: Session = Depends(get_db)):
    """Generate an ephemeral plan from a trial profile without writing any records."""
    profile = UserProfile(
        user_id=0,
        full_name=payload.full_name,
        date_of_birth=payload.date_of_birth,
        height_cm=payload.height_cm,
        weight_kg=payload.weight_kg,
        sex_for_calculation=payload.sex_for_calculation,
        activity_level=payload.activity_level,
        goal=payload.goal,
        target_weight_kg=payload.target_weight_kg,
        allergies_json=json.dumps(payload.allergies, ensure_ascii=False),
        avoid_ingredients_json=json.dumps(payload.avoid_ingredients, ensure_ascii=False),
        disliked_dishes_json=json.dumps(payload.disliked_dishes, ensure_ascii=False),
        favorite_dishes_json=json.dumps(payload.favorite_dishes, ensure_ascii=False),
    )
    fields = profile_for_calculation(profile)
    plan_date = payload.plan_date or local_today()
    age = age_on(fields["date_of_birth"], plan_date)
    nutrition = calculate(
        age, fields["height_cm"], fields["weight_kg"], fields["sex_for_calculation"],
        fields["activity_level"], fields["goal"],
    )
    if nutrition["medical_review_required"]:
        raise HTTPException(422, {
            "message": "Cần chuyên gia đánh giá trước khi tạo thực đơn tự động.",
            "nutrition": nutrition,
        })
    dishes = get_dishes(db)
    if not dishes:
        raise HTTPException(503, "Catalog món ăn chưa được nạp; kiểm tra NUTRIAI_DATASET_PATH.")
    if not state.model_bundle:
        raise HTTPException(503, "Random Forest chưa được nạp; chưa thể tạo thực đơn thử.")
    try:
        selected, warnings = generate_meals(
            db, 0, profile, dishes, plan_date, nutrition["target_calories"], payload.meal_split,
            model_bundle=state.model_bundle,
            target_macros={"protein": nutrition["protein_g"], "carb": nutrition["carb_g"], "fat": nutrition["fat_g"]},
            main_meals=payload.main_meals, side_meals=payload.side_meals,
            excluded_dish_ids=set(payload.excluded_dish_ids),
        )
        if payload.selected_dish_id:
            if not payload.selected_meal_type:
                raise HTTPException(422, "Cần chọn bữa cho món được chọn.")
            selected_dish = db.get(Dish, payload.selected_dish_id)
            if selected_dish is None:
                raise HTTPException(404, "Không tìm thấy món được chọn trong catalog.")
            _validate_manual_dish(selected_dish, profile)
            replacement = _manual_dish_item(selected_dish, payload.selected_meal_type)
            replacement["position"] = next(
                (item["position"] for item in selected if item["meal_type"] == payload.selected_meal_type),
                len(selected),
            )
            if payload.selected_meal_type == "snack":
                selected.append(replacement)
            else:
                selected = [
                    replacement if item["meal_type"] == payload.selected_meal_type else item
                    for item in selected
                ]
            if sum(item["calories"] for item in selected) > nutrition["target_calories"]:
                raise HTTPException(422, "Món được chọn làm tổng calo vượt mục tiêu thử nghiệm.")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    warnings.extend(nutrition["warnings"])
    if state.model_warning:
        warnings.append(state.model_warning)
    total_calories = round(sum(item["calories"] for item in selected), 1)
    totals = {key: round(sum(item[key] for item in selected), 1) for key in ("protein", "carb", "fat")}
    if any(abs(totals[key] - nutrition[f"{key}_g"]) / max(nutrition[f"{key}_g"], 1.0) > 0.15 for key in totals):
        warnings.append("Độ lệch protein/carb/fat vượt 15%; catalog không có tổ hợp gần mục tiêu hơn trong giới hạn calo và nhóm bữa.")
    return {
        "id": 0, "plan_date": plan_date.isoformat(), "version": 0,
        "bmi": nutrition["bmi"], "bmr_kcal": nutrition["bmr_kcal"], "tdee_kcal": nutrition["tdee_kcal"],
        "target_calories": nutrition["target_calories"], "total_calories": total_calories,
        "goal": fields["goal"], "algorithm_version": "nutriai-recommender-1-preview",
        "warnings": warnings, "created_at": datetime.now(timezone.utc).isoformat(),
        "meals": [{
            "dish_id": item["dish_id"], "name": item["dish_name"], "food_group": item["food_group"],
            "ingredients": item["ingredients"], "instructions": item["instructions"], "image_url": item["image_url"],
            "meal_type": item["meal_type"], "is_cooked": False, "consumed_ratio": 0,
            "serving_grams": item["serving_grams"], "calories": item["calories"],
            "protein": item["protein"], "carb": item["carb"], "fat": item["fat"],
            "position": item["position"], "reason": item["recommendation_reason"],
        } for item in selected],
        "nutrition_totals": totals,
        "consumed_totals": {"calories": 0, "protein": 0, "carb": 0, "fat": 0},
    }


@router.put("/items/{item_id}/cooked")
def set_item_cooked(
    item_id: int,
    payload: CookedInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(MealPlanItem).join(DailyMealPlan).where(
            MealPlanItem.id == item_id,
            DailyMealPlan.user_id == user.id,
        )
    )
    if item is None:
        raise HTTPException(404, "Không tìm thấy món trong thực đơn của bạn.")
    item.is_cooked = payload.is_cooked
    db.commit()
    return {"id": item.id, "is_cooked": item.is_cooked}


@router.put("/items/{item_id}/consumption")
def set_item_consumption(
    item_id: int,
    payload: ConsumptionInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(MealPlanItem).join(DailyMealPlan).where(
            MealPlanItem.id == item_id,
            DailyMealPlan.user_id == user.id,
        )
    )
    if item is None:
        raise HTTPException(404, "Không tìm thấy món trong thực đơn của bạn.")
    item.consumed_ratio = payload.consumed_ratio
    db.commit()
    return {"id": item.id, "consumed_ratio": item.consumed_ratio}


@router.post("/select-dish", status_code=201)
def select_dish_for_meal(
    payload: SelectDishInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    dish = db.get(Dish, payload.dish_id)
    if dish is None:
        raise HTTPException(404, "Không tìm thấy món trong catalog.")
    existing = db.scalar(
        select(DailyMealPlan)
        .options(joinedload(DailyMealPlan.items))
        .where(
            DailyMealPlan.user_id == user.id,
            DailyMealPlan.plan_date == payload.plan_date,
        )
        .order_by(DailyMealPlan.version.desc())
        .limit(1)
    )
    if existing is not None:
        result = replace_meal_with_dish(db, user, existing, dish, payload.meal_type)
    else:
        result = create_meal_plan(
            db,
            user,
            payload.plan_date,
            override_dish=dish,
            override_meal_type=payload.meal_type,
            side_meals=1 if payload.meal_type == "snack" else 0,
        )
    return {"data": result, "created": True}


@router.post("/generate", status_code=201)
def generate(
    payload: GenerateInput,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    plan_date = payload.plan_date or local_today()
    existing = db.scalar(
        select(DailyMealPlan)
        .options(joinedload(DailyMealPlan.items))
        .where(DailyMealPlan.user_id == user.id, DailyMealPlan.plan_date == plan_date)
        .order_by(DailyMealPlan.version.desc())
        .limit(1)
    )
    if existing is not None:
        if payload.meal_split is not None or payload.main_meals != 3 or payload.side_meals != 0:
            return {
                "data": create_meal_plan(
                    db, user, plan_date, payload.meal_split,
                    main_meals=payload.main_meals, side_meals=payload.side_meals,
                ),
                "created": True,
            }
        response.status_code = 200
        return {"data": serialize_plan(existing), "created": False}
    return {
        "data": create_meal_plan(db, user, plan_date, payload.meal_split, main_meals=payload.main_meals, side_meals=payload.side_meals),
        "created": True,
    }


@router.get("")
def for_day(
    date_value: date | None = Query(default=None, alias="date"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    selected_date = date_value or local_today()
    plans = db.scalars(
        select(DailyMealPlan)
        .options(joinedload(DailyMealPlan.items))
        .where(DailyMealPlan.user_id == user.id, DailyMealPlan.plan_date == selected_date)
        .order_by(DailyMealPlan.version)
    ).unique().all()
    return {"date": selected_date.isoformat(), "data": [serialize_plan(plan) for plan in plans]}


@router.get("/history")
def history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    query = select(DailyMealPlan).options(joinedload(DailyMealPlan.items)).where(
        DailyMealPlan.user_id == user.id
    )
    total = db.scalar(
        select(func.count()).select_from(DailyMealPlan).where(DailyMealPlan.user_id == user.id)
    ) or 0
    plans = db.scalars(
        query.order_by(desc(DailyMealPlan.plan_date), desc(DailyMealPlan.version))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "data": [serialize_plan(plan) for plan in plans],
    }


@router.get("/export")
def export_history(
    start_date: date,
    end_date: date,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(422, "end_date phải bằng hoặc sau start_date.")
    plans = db.scalars(
        select(DailyMealPlan)
        .options(joinedload(DailyMealPlan.items))
        .where(
            DailyMealPlan.user_id == user.id,
            DailyMealPlan.plan_date >= start_date,
            DailyMealPlan.plan_date <= end_date,
        )
        .order_by(DailyMealPlan.plan_date, DailyMealPlan.version)
    ).unique().all()
    rows = [
        {
            "plan_date": plan.plan_date.isoformat(),
            "version": plan.version,
            "meal_type": item.meal_type,
            "dish_id": item.dish_id,
            "dish_name": item.dish_name_snapshot,
            "serving_grams": item.serving_grams,
            "calories": item.calories,
            "protein": item.protein,
            "carb": item.carb,
            "fat": item.fat,
        }
        for plan in plans
        for item in plan.items
    ]
    if format == "csv":
        output = io.StringIO(newline="")
        columns = [
            "plan_date", "version", "meal_type", "dish_id", "dish_name",
            "serving_grams", "calories", "protein", "carb", "fat",
        ]
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
        return StreamingResponse(
            iter(["\ufeff" + output.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=nutriai_history.csv"},
        )
    try:
        import pandas as pd
    except ImportError as exc:
        raise HTTPException(503, "Cài pandas và openpyxl để xuất XLSX; CSV vẫn khả dụng.") from exc
    output_bytes = io.BytesIO()
    pd.DataFrame(rows).to_excel(output_bytes, index=False)
    output_bytes.seek(0)
    return StreamingResponse(
        output_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=nutriai_history.xlsx"},
    )


@router.get("/{plan_id}")
def detail(
    plan_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    plan = db.scalar(
        select(DailyMealPlan)
        .options(joinedload(DailyMealPlan.items))
        .where(DailyMealPlan.id == plan_id, DailyMealPlan.user_id == user.id)
    )
    if plan is None:
        raise HTTPException(404, "Không tìm thấy phiên bản thực đơn.")
    return {"data": serialize_plan(plan)}


@router.post("/{plan_id}/regenerate", status_code=201)
def regenerate(
    plan_id: int,
    payload: GenerateInput | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    old_plan = db.scalar(
        select(DailyMealPlan).where(
            DailyMealPlan.id == plan_id,
            DailyMealPlan.user_id == user.id,
        )
    )
    if old_plan is None:
        raise HTTPException(404, "Không tìm thấy phiên bản thực đơn.")
    return {
        "data": create_meal_plan(
            db,
            user,
            old_plan.plan_date,
            split=payload.meal_split if payload else None,
            main_meals=payload.main_meals if payload else 3,
            side_meals=payload.side_meals if payload else 0,
        )
    }
