from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import state
from ..database import get_db
from ..dependencies import current_user
from ..models import Dish, User
from ..schemas import CatalogDish, CatalogDishResponse, IngredientSearchInput, IngredientSearchResponse

router = APIRouter(prefix="/api/v1/recommendations", tags=["Recommendations"])

GOAL_CLASS_IDS = {
    "lose_weight": 0,
    "gain_weight": 1,
    "maintain_weight": 2,
    "gain_muscle": 3,
}


@router.get("/dishes", response_model=CatalogDishResponse)
def list_dishes(
    query: str = Query(default="", max_length=100),
    goal: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    # Hide age-specific toddler dishes from the user-facing catalog and roulette.
    statement = select(Dish).where(Dish.name.not_ilike("%(18 tháng trở lên)%"))
    if query.strip():
        pattern = f"%{query.strip()}%"
        statement = statement.where(or_(Dish.name.ilike(pattern), Dish.ingredients.ilike(pattern)))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    if goal:
        if goal not in GOAL_CLASS_IDS:
            raise HTTPException(422, "Mục tiêu dinh dưỡng không hợp lệ.")
        bundle = state.model_bundle
        if not bundle:
            raise HTTPException(503, "Random Forest chưa được nạp; không thể tính điểm phù hợp mục tiêu.")
        dishes = db.scalars(statement.order_by(Dish.name)).all()
        model = bundle["model"]
        class_ids = [int(value) for value in model.classes_]
        class_id = GOAL_CLASS_IDS[goal]
        if class_id not in class_ids:
            raise HTTPException(503, "Random Forest không có lớp cho mục tiêu đã chọn.")
        valid_dishes = [
            dish for dish in dishes
            if all(value is not None for value in (
                dish.calories_per_100g, dish.protein_per_100g,
                dish.carb_per_100g, dish.fat_per_100g,
            ))
        ]
        scores: dict[str, float] = {}
        if valid_dishes:
            features = [[
                dish.calories_per_100g, dish.protein_per_100g,
                dish.carb_per_100g, dish.fat_per_100g,
            ] for dish in valid_dishes]
            try:
                probabilities = model.predict_proba(features)
            except Exception as exc:
                raise HTTPException(503, f"Không thể tính điểm bằng Random Forest ({type(exc).__name__}).") from exc
            goal_index = class_ids.index(class_id)
            scores = {
                dish.id: round(float(probabilities[index][goal_index]) * 100, 1)
                for index, dish in enumerate(valid_dishes)
            }
        dishes.sort(key=lambda dish: (scores.get(dish.id, -1), dish.name.casefold()), reverse=True)
        page = dishes[offset:offset + limit]
        return {
            "total": total,
            "results": [CatalogDish.from_dish(dish, scores.get(dish.id)) for dish in page],
        }
    dishes = db.scalars(statement.order_by(Dish.name).offset(offset).limit(limit)).all()
    return {"total": total, "results": [CatalogDish.from_dish(dish) for dish in dishes]}


@router.get("/ingredients")
def suggest_ingredients(
    query: str = Query(min_length=1, max_length=100),
    _user: User = Depends(current_user),
):
    recommender = state.ingredient_recommender
    if recommender is None:
        raise HTTPException(503, "Chỉ mục tìm nguyên liệu chưa sẵn sàng; kiểm tra dữ liệu món ăn và khởi động lại backend.")
    return {"suggestions": recommender.suggest_ingredients(query)}


@router.post("/by-ingredients", response_model=IngredientSearchResponse)
def by_ingredients(
    payload: IngredientSearchInput,
    user: User = Depends(current_user),
    _db: Session = Depends(get_db),
):
    recommender = state.ingredient_recommender
    if recommender is None:
        raise HTTPException(503, "Chỉ mục tìm nguyên liệu chưa sẵn sàng; kiểm tra dữ liệu món ăn và khởi động lại backend.")
    goal = payload.goal or (user.profile.goal if user.profile else None)
    return recommender.search(
        payload.ingredients,
        limit=payload.limit,
        max_calories=payload.max_calories,
        min_protein=payload.min_protein,
        goal=goal,
        profile=user.profile,
    )
