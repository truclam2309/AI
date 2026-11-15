from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import state
from ..database import get_db
from ..dependencies import current_user
from ..models import Dish, User
from ..schemas import CatalogDish, CatalogDishResponse, IngredientSearchInput, IngredientSearchResponse

router = APIRouter(prefix="/api/v1/recommendations", tags=["Recommendations"])

GOAL_LABELS = {
    "gain_weight": "Tăng cân",
    "lose_weight": "Giảm cân",
    "maintain_weight": "Duy trì",
    "gain_muscle": "Tăng cơ",
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
    statement = select(Dish)
    if query.strip():
        pattern = f"%{query.strip()}%"
        statement = statement.where(or_(Dish.name.ilike(pattern), Dish.ingredients.ilike(pattern)))
    if goal:
        label = GOAL_LABELS.get(goal, goal)
        goal_statement = statement.where(Dish.nutrition_label.ilike(f"%{label}%"))
        # Labels are optional metadata and older catalog imports may use
        # different label text. Apply the filter only when it has matches.
        goal_total = db.scalar(select(func.count()).select_from(goal_statement.subquery())) or 0
        if goal_total:
            statement = goal_statement
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
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
