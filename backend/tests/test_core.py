from datetime import date

import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import state
from app import main as main_module
from app.routers import meal_plans as meal_plan_router
from app.database import Base, get_db
from app.config import settings
from app.main import _create_plan, app
from app.models import DailyMealPlan, Dish, MealPlanItem, User, UserProfile
from app.nutrition import calculate
from app.recommender import generate_meals
from app.security import hash_password, verify_password
from app.utils.time import local_today


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


def _profile(user_id: int, **kwargs):
    values = dict(date_of_birth=date(1995, 1, 1), height_cm=165,
        weight_kg=60, sex_for_calculation="female", activity_level="light",
        goal="maintain_weight", allergies_json="[]", avoid_ingredients_json="[]",
        disliked_dishes_json="[]", favorite_dishes_json="[]")
    values.update(kwargs)
    return UserProfile(user_id=user_id, **values)


def _dish(dish_id: str, name: str, group: str, ingredients: str = "rice: 100 g"):
    return Dish(id=dish_id, name=name, food_group=group, ingredients=ingredients, serving_g=200,
        calories_per_100g=150, protein_per_100g=8, carb_per_100g=20, fat_per_100g=4,
        calories_per_serving=300, protein_per_serving=16, carb_per_serving=40,
        fat_per_serving=8, data_quality="verified_per_100g")


def test_password_is_hashed_and_verifiable():
    encoded = hash_password("correct horse battery staple")
    assert "correct horse" not in encoded
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong password", encoded)


def test_bmi_bmr_tdee_and_goal_calories():
    result = calculate(30, 165, 60, "female", "light", "maintain_weight")
    assert result["bmi"] == pytest.approx(22.04, abs=.01)
    assert result["bmr_kcal"] == pytest.approx(1320.2)
    assert result["tdee_kcal"] == pytest.approx(1815.34, abs=.1)
    assert result["target_calories"] == result["tdee_kcal"]
    assert result["formula"]["activity_factor"] == 1.375


def test_minors_are_not_given_adult_calorie_plan():
    with pytest.raises(HTTPException) as error:
        calculate(17, 165, 60, "female", "light", "lose_weight")
    assert error.value.status_code == 422


def test_recommender_creates_three_unique_meals_with_real_portion_math(db):
    user = User(username="testuser", email="test@example.com", password_hash="hashed")
    db.add(user)
    db.flush()
    profile = _profile(user.id)
    dishes = [_dish(str(i), f"Dish {i}", f"group-{i}") for i in range(5)]
    db.add_all([profile, *dishes])
    db.commit()

    selected, warnings = generate_meals(db, user.id, profile, dishes, date(2026, 11, 2), 1800)
    assert [item["meal_type"] for item in selected] == ["breakfast", "lunch", "dinner"]
    assert len({item["dish_id"] for item in selected}) == 3
    for item in selected:
        assert item["calories"] == pytest.approx(item["serving_grams"] * 1.5)
        assert item["protein"] == pytest.approx(item["serving_grams"] * .08)


def test_known_avoided_ingredient_is_filtered(db):
    user = User(username="testuser", email="test@example.com", password_hash="hashed")
    db.add(user)
    db.flush()
    profile = _profile(user.id, avoid_ingredients_json='["peanut"]')
    dishes = [_dish("1", "Peanut soup", "soup", "peanut: 20 g"),
              _dish("2", "Meal two", "one"), _dish("3", "Meal three", "two"),
              _dish("4", "Meal four", "three")]
    db.add_all([profile, *dishes])
    db.commit()
    selected, warnings = generate_meals(db, user.id, profile, dishes, date(2026, 11, 2), 1800)
    assert all(item["dish_id"] != "1" for item in selected)
    assert any("không bảo đảm" in warning for warning in warnings)


def test_macro_mismatch_flagged_food_is_not_recommended(db):
    user = User(username="testuser", email="test@example.com", password_hash="hashed")
    db.add(user)
    db.flush()
    profile = _profile(user.id)
    dishes = [_dish("bad", "Flagged meal", "bad"), _dish("2", "Meal two", "one"),
              _dish("3", "Meal three", "two"), _dish("4", "Meal four", "three")]
    dishes[0].kcal_macro_mismatch = 1
    db.add_all([profile, *dishes])
    db.commit()
    selected, warnings = generate_meals(db, user.id, profile, dishes, date(2026, 11, 2), 1800)
    assert all(item["dish_id"] != "bad" for item in selected)
    assert warnings


def test_recent_meal_history_increases_repeat_penalty(db):
    user = User(username="testuser", email="test@example.com", password_hash="hashed")
    db.add(user)
    db.flush()
    profile = _profile(user.id)
    dishes = [_dish(str(i), f"Dish {i}", f"group-{i}") for i in range(5)]
    old_plan = DailyMealPlan(user_id=user.id, plan_date=date(2026, 11, 1), version=1,
        bmi_at_generation=22, bmr_at_generation=1300, tdee_at_generation=1800,
        target_calories=1800, total_calories=300, goal_snapshot="maintain_weight")
    old_plan.items.append(MealPlanItem(dish_id="0", dish_name_snapshot="Dish 0", meal_type="lunch",
        serving_grams=200, calories=300, protein=16, carb=40, fat=8, position=0,
        recommendation_reason="fixture"))
    db.add_all([profile, *dishes, old_plan])
    db.commit()
    selected, _ = generate_meals(db, user.id, profile, dishes, date(2026, 11, 2), 1800)
    # A prior-day dish may still be selected if needed, but its score must reflect the penalty.
    assert all("lịch sử gần đây" in item["recommendation_reason"] for item in selected if item["dish_id"] == "0")


def test_snapshot_and_versions_are_persistable_without_overwrite(db):
    user = User(username="testuser", email="test@example.com", password_hash="hashed")
    db.add(user)
    db.flush()
    for version in (1, 2):
        db.add(DailyMealPlan(user_id=user.id, plan_date=date(2026, 11, 2), version=version,
            bmi_at_generation=22, bmr_at_generation=1300, tdee_at_generation=1800,
            target_calories=1800, total_calories=0, goal_snapshot="maintain_weight"))
    db.commit()
    assert db.query(DailyMealPlan).filter_by(user_id=user.id, plan_date=date(2026, 11, 2)).count() == 2


def test_generate_and_regenerate_preserve_prior_version(db):
    user = User(username="planner", email="planner@example.com", password_hash="hashed")
    db.add(user)
    db.flush()
    profile = _profile(user.id)
    user.profile = profile
    db.add_all([_dish(str(i), f"Dish {i}", f"group-{i}") for i in range(6)])
    db.commit()
    first = _create_plan(db, user, date(2026, 11, 2))
    second = _create_plan(db, user, date(2026, 11, 2), excluded_plan_id=first["id"])
    assert len(first["meals"]) == len(second["meals"]) == 3
    assert second["version"] == 2
    assert db.query(DailyMealPlan).filter_by(user_id=user.id, plan_date=date(2026, 11, 2)).count() == 2


def test_sqlite_file_keeps_data_after_engine_reopen(tmp_path):
    path = tmp_path / "history.sqlite"
    first_engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(first_engine)
    with Session(first_engine) as session:
        session.add(User(username="persistent", email="persist@example.com", password_hash="hashed"))
        session.commit()
    first_engine.dispose()
    second_engine = create_engine(f"sqlite:///{path}")
    with Session(second_engine) as session:
        assert session.query(User).filter_by(username="persistent").count() == 1
    second_engine.dispose()


def test_local_today_uses_configured_vietnam_timezone(monkeypatch):
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    import app.utils.time as time_utils

    instant = datetime(2026, 11, 2, 18, 30, tzinfo=timezone.utc)

    class FrozenDateTime:
        @staticmethod
        def now(tz=None):
            return instant.astimezone(tz or ZoneInfo("UTC"))

    monkeypatch.setattr(time_utils, "datetime", FrozenDateTime)
    assert local_today().isoformat() == "2026-11-03"


def test_startup_loads_database_and_catalog_without_recreating_history(tmp_path, monkeypatch):
    dataset = tmp_path / "mini_catalog.xlsx"
    pd.DataFrame([
        {
            "dish_id": f"test-{i}", "source_code": str(i), "name": f"Test meal {i}",
            "food_group": "test", "ingredients": "rice: 100 g", "serving_g": 100,
            "energy_kcal": 150, "protein_g": 8, "fat_g": 4, "carb_g": 20,
            "energy_kcal_per_100g": 150, "protein_g_per_100g": 8,
            "fat_g_per_100g": 4, "carb_g_per_100g": 20,
            "kcal_macro_mismatch": 0,
        }
        for i in range(3)
    ]).to_excel(dataset, sheet_name="dishes", index=False)
    db_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    session_local = sessionmaker(bind=db_engine, expire_on_commit=False)
    previous = {
        "secret_key": settings.secret_key,
        "dataset_path": settings.dataset_path,
        "model_path": settings.model_path,
        "engine": main_module.engine,
        "SessionLocal": main_module.SessionLocal,
    }
    object.__setattr__(settings, "secret_key", "startup-test-secret")
    object.__setattr__(settings, "dataset_path", dataset)
    object.__setattr__(settings, "model_path", tmp_path / "missing-model.pkl")
    monkeypatch.setattr(main_module, "engine", db_engine)
    monkeypatch.setattr(main_module, "SessionLocal", session_local)
    try:
        with TestClient(main_module.app) as client:
            response = client.get("/health")
            assert response.status_code == 200
            assert response.json()["dataset"]["loaded"] == 3
            assert client.get("/docs").status_code == 200
            schema_response = client.get("/openapi.json")
            assert schema_response.status_code == 200
            assert "/api/v1/meal-plans/generate" in schema_response.json()["paths"]
            assert "/api/v1/recommendations/by-ingredients" in schema_response.json()["paths"]
        # A second startup is an upsert; it must leave persistent records intact.
        with session_local() as session:
            existing = User(username="keep-me", email="keep@example.com", password_hash="hash")
            session.add(existing)
            session.commit()
        main_module.initialize_app()
        with session_local() as session:
            assert session.query(User).filter_by(username="keep-me").count() == 1
    finally:
        object.__setattr__(settings, "secret_key", previous["secret_key"])
        object.__setattr__(settings, "dataset_path", previous["dataset_path"])
        object.__setattr__(settings, "model_path", previous["model_path"])
        db_engine.dispose()


def test_api_uses_vietnam_today_accepts_selected_dates_and_is_idempotent(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def override_db():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(meal_plan_router, "local_today", lambda: date(2026, 11, 3))
    previous_secret = settings.secret_key
    object.__setattr__(settings, "secret_key", "api-test-secret")
    state.model_bundle = None
    state.model_warning = None
    try:
        client = TestClient(app)
        registered = client.post("/api/v1/auth/register", json={
            "username": "date_user", "password": "a-long-password-4",
            "date_of_birth": "1995-01-01", "height_cm": 165, "weight_kg": 60,
            "sex_for_calculation": "female", "activity_level": "light", "goal": "maintain_weight",
        })
        assert registered.status_code == 201
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
        with Session(engine) as session:
            session.add_all([_dish(str(i), f"Dish {i}", f"group-{i}") for i in range(6)])
            session.commit()

        created = client.post("/api/v1/meal-plans/generate", json={}, headers=headers)
        assert created.status_code == 201
        assert created.json()["data"]["plan_date"] == "2026-11-03"
        repeated = client.post("/api/v1/meal-plans/generate", json={}, headers=headers)
        assert repeated.status_code == 200
        assert repeated.json()["created"] is False
        assert repeated.json()["data"]["id"] == created.json()["data"]["id"]

        historic_create = client.post(
            "/api/v1/meal-plans/generate",
            json={"plan_date": "2026-11-02"},
            headers=headers,
        )
        assert historic_create.status_code == 201
        assert historic_create.json()["data"]["plan_date"] == "2026-11-02"
        chosen_day = client.get("/api/v1/meal-plans?date=2026-11-02", headers=headers)
        assert chosen_day.status_code == 200
        assert chosen_day.json()["date"] == "2026-11-02"
        assert len(chosen_day.json()["data"]) == 1
        invalid_day = client.get("/api/v1/meal-plans?date=not-a-date", headers=headers)
        assert invalid_day.status_code == 422
        current_day = client.get("/api/v1/meal-plans", headers=headers)
        assert current_day.status_code == 200
        assert current_day.json()["date"] == "2026-11-03"
        history = client.get("/api/v1/meal-plans/history", headers=headers)
        assert history.status_code == 200 and history.json()["total"] == 2
    finally:
        object.__setattr__(settings, "secret_key", previous_secret)
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_register_login_and_private_history_access():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    def override_db():
        with Session(engine, expire_on_commit=False) as session:
            yield session
    app.dependency_overrides[get_db] = override_db
    previous_secret = settings.secret_key
    object.__setattr__(settings, "secret_key", "test-only-secret-for-unit-tests")
    try:
        client = TestClient(app)
        first = client.post("/api/v1/auth/register", json={
            "username": "first_user", "email": "first@example.com", "password": "a-long-password-1",
        })
        second = client.post("/api/v1/auth/register", json={
            "username": "second_user", "email": "second@example.com", "password": "a-long-password-2",
        })
        username_only = client.post("/api/v1/auth/register", json={
            "username": "third_user", "password": "a-long-password-3",
        })
        assert first.status_code == 201 and second.status_code == 201 and username_only.status_code == 201
        assert "password_hash" not in first.json()["user"]
        token = first.json()["access_token"]
        login = client.post("/api/v1/auth/login", json={
            "username_or_email": "first@example.com", "password": "a-long-password-1",
        })
        assert login.status_code == 200
        first_user_id = first.json()["user"]["id"]
        with Session(engine) as session:
            plan = DailyMealPlan(user_id=first_user_id, plan_date=date(2026, 11, 2), version=1,
                bmi_at_generation=22, bmr_at_generation=1300, tdee_at_generation=1800,
                target_calories=1800, total_calories=0, goal_snapshot="maintain_weight")
            session.add(plan)
            session.commit()
            plan_id = plan.id
        headers = {"Authorization": f"Bearer {second.json()['access_token']}"}
        response = client.get(f"/api/v1/meal-plans/{plan_id}", headers=headers)
        assert response.status_code == 404
        me = client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200 and me.json()["data"]["username"] == "first_user"
    finally:
        object.__setattr__(settings, "secret_key", previous_secret)
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()
