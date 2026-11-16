from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True, future=True)
if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


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
            "is_cooked": "BOOLEAN NOT NULL DEFAULT 0",
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
            # create_all normally creates these tables first, but keep migrations
            # safe for databases where a feature table has not been created yet.
            if table_name not in existing_tables:
                continue
            existing = {column["name"] for column in inspect(connection).get_columns(table_name)}
            for column_name, column_type in columns.items():
                if column_name not in existing:
                    connection.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    ))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
