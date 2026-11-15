import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import current_user
from ..models import DailyMealPlan, Dish, MealPlanItem, User
from ..schemas import CookedInput, GenerateInput, SelectDishInput
from ..services.meal_plans import create_meal_plan, replace_meal_with_dish
from ..utils.time import local_today
from ..utils.serialization import serialize_plan

router = APIRouter(prefix="/api/v1/meal-plans", tags=["Meal plans"])


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
