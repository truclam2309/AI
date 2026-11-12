"""Runtime metadata initialized by the FastAPI startup hook."""

catalog_status: dict = {"loaded": 0, "error": None}
model_bundle: dict | None = None
model_status = "not_checked"
model_warning: str | None = None
ingredient_recommender = None
