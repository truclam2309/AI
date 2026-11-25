
from pathlib import Path
import shutil

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


# =========================================================
# RAILWAY VOLUME: INITIALIZE SQLITE DATABASE
# =========================================================

# Database trên Railway Volume
VOLUME_DB_PATH = Path("/data/nutriai.db")

# Database gốc nằm tại thư mục backend/nutriai.db
SOURCE_DB_PATH = Path(__file__).resolve().parents[1] / "nutriai.db"

# Chỉ thực hiện sao chép khi sử dụng đúng đường dẫn Railway Volume
RAILWAY_DATABASE_URL = "sqlite:////data/nutriai.db"

if settings.database_url == RAILWAY_DATABASE_URL:

    # Nếu Volume chưa có database thì sao chép database gốc
    if not VOLUME_DB_PATH.exists():

        if not SOURCE_DB_PATH.exists():
            raise FileNotFoundError(
                f"Không tìm thấy database gốc: {SOURCE_DB_PATH}. "
                "Không thể khởi tạo database Railway Volume."
            )

        VOLUME_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

        shutil.copy2(SOURCE_DB_PATH, VOLUME_DB_PATH)

        print(
            f"[DATABASE] Đã sao chép database vào Railway Volume: "
            f"{VOLUME_DB_PATH}"
        )

    else:
        print(
            f"[DATABASE] Đang sử dụng database hiện có trên Volume: "
            f"{VOLUME_DB_PATH}"
        )


# =========================================================
# SQLALCHEMY CONFIGURATION
# =========================================================

class Base(DeclarativeBase):
    pass


connect_args = (
    {"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True
)


# Bật kiểm tra khóa ngoại cho SQLite
if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(
        dbapi_connection,
        _connection_record
    ):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


# Session database
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False
)


# =========================================================
# DATABASE MIGRATION
# =========================================================

def migrate_recipe_columns(database_engine=None) -> None:
    """Add recipe display fields to existing databases without dropping data."""

    database_engine = database_engine or engine

    additions = {
        "dishes": {
            "instructions": "TEXT",
            "image_url": "TEXT",
            "image_file": "VARCHAR(255)",
            "nutrition_label": "VARCHAR(40)",
            "meal_category": "VARCHAR(40)",
        },
        "meal_plan_items": {
            "instructions_snapshot": "TEXT",
            "image_url_snapshot": "TEXT",
            # FALSE is accepted by both SQLite and PostgreSQL; DEFAULT 0 is
            # rejected by PostgreSQL for a BOOLEAN column.
            "is_cooked": "BOOLEAN NOT NULL DEFAULT FALSE",
            "consumed_ratio": "FLOAT NOT NULL DEFAULT 0",
        },
        "user_profiles": {
            "full_name": "VARCHAR(160)",
        },
    }

    inspector = inspect(database_engine)

    with database_engine.begin() as connection:

        existing_tables = set(inspector.get_table_names())

        for table_name, columns in additions.items():

            # Bỏ qua bảng chưa tồn tại
            if table_name not in existing_tables:
                continue

            existing = {
                column["name"]
                for column in inspect(connection).get_columns(table_name)
            }

            for column_name, column_type in columns.items():

                # Chỉ thêm cột nếu chưa tồn tại
                if column_name not in existing:

                    connection.execute(
                        text(
                            f"ALTER TABLE {table_name} "
                            f"ADD COLUMN {column_name} {column_type}"
                        )
                    )


# =========================================================
# DATABASE DEPENDENCY
# =========================================================

def get_db():
    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()
