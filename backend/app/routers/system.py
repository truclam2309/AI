from fastapi import APIRouter

from .. import state

router = APIRouter(tags=["System"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "dataset": state.catalog_status,
        "random_forest": state.model_status,
        "model_warning": state.model_warning,
        "ingredient_search": "loaded" if state.ingredient_recommender is not None else "unavailable",
    }
