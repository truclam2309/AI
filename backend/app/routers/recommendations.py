from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import state
from ..database import get_db
from ..dependencies import current_user
from ..models import User
from ..schemas import IngredientSearchInput, IngredientSearchResponse

router = APIRouter(prefix="/api/v1/recommendations", tags=["Recommendations"])


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
