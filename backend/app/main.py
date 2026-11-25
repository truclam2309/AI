from contextlib import asynccontextmanager

# FastAPI và middleware phục vụ API, CORS cho frontend, cùng static files cho ảnh món.
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Module state giữ trạng thái catalog/model đã nạp trong vòng đời tiến trình.
from . import state
# Đọc/đồng bộ catalog và nạp metadata của Random Forest khi backend khởi động.
from .catalog import get_dishes, load_model_metadata, read_catalog, sync_catalog
# Settings tập trung: đường dẫn dữ liệu/model, secret, CORS và các hệ số dinh dưỡng.
from .config import settings
# SQLAlchemy: metadata tạo bảng, session kết nối DB, engine và migration bổ sung cột.
from .database import Base, SessionLocal, engine, migrate_recipe_columns
# Các router định nghĩa endpoint theo từng nhóm chức năng của API.
from .routers import auth, meal_plans, nutrition, recommendations, system, users, weight_progress
# Bộ tìm món theo nguyên liệu và service tạo/lưu thực đơn.
from .services.ingredient_recommender import IngredientRecommender
from .services.meal_plans import create_meal_plan as _create_plan


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_app()
    yield


app = FastAPI(
    title="NutriAI API",
    version="1.0.0",
    description="Cá nhân hóa dinh dưỡng và lưu lịch sử thực đơn.",
    lifespan=lifespan,
)
image_directory = settings.data_dir / "hinh-anh-lam-net"
if image_directory.is_dir():
    app.mount("/images", StaticFiles(directory=image_directory), name="dish-images")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=r"https://[a-zA-Z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(system.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(nutrition.router)
app.include_router(meal_plans.router)
app.include_router(recommendations.router)
app.include_router(weight_progress.router)


def initialize_app() -> None:
    """Initialize persistent storage and load the catalog/model once per process."""
    if not settings.secret_key:
        raise RuntimeError("Cần đặt NUTRIAI_SECRET_KEY trước khi khởi động.")

    Base.metadata.create_all(bind=engine)
    migrate_recipe_columns(engine)

    if settings.dataset_path.exists():
        catalog_rows = read_catalog(settings.dataset_path)
        with SessionLocal() as db:
            sync_catalog(db, catalog_rows)
            state.ingredient_recommender = IngredientRecommender(get_dishes(db))
        state.catalog_status = {"loaded": len(catalog_rows), "error": None}
    else:
        state.ingredient_recommender = None
        state.catalog_status = {
            "loaded": 0,
            "error": f"Không tìm thấy dataset: {settings.dataset_path}",
        }

    bundle, warning = load_model_metadata(settings.model_path)
    state.model_bundle = bundle
    state.model_status = "loaded" if bundle else "unavailable"
    state.model_warning = warning or (
        "Random Forest được nạp; nhãn huấn luyện được tạo theo quy tắc, "
        "nên mô hình chỉ là tín hiệu xếp hạng phụ, không phải đánh giá chuyên gia."
        if bundle
        else None
    )
