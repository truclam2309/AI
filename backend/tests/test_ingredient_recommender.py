from datetime import date

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import main as main_module, state
from app.config import settings
from app.database import Base, get_db
from app.catalog import read_catalog
from app.models import Dish, User, UserProfile
from app.security import create_access_token
from app.services.ingredient_recommender import (
    IngredientRecommender,
    normalize_ingredient,
    parse_ingredients,
)


def _dish(dish_id, name, ingredients, *, calories=300, protein=20, label=None):
    return Dish(
        id=dish_id,
        name=name,
        ingredients=ingredients,
        serving_g=200,
        calories_per_serving=calories,
        protein_per_serving=protein,
        carb_per_serving=30,
        fat_per_serving=10,
        calories_per_100g=calories / 2 if calories is not None else None,
        protein_per_100g=protein / 2 if protein is not None else None,
        carb_per_100g=15,
        fat_per_100g=5,
        nutrition_label=label,
    )


def test_normalizer_handles_case_accents_spacing_and_explicit_synonyms():
    assert normalize_ingredient("  THỊT   LỢN ") == normalize_ingredient("thịt heo")
    assert normalize_ingredient("Cà Chua") == "cà chua"
    assert normalize_ingredient("dầu ăn") != normalize_ingredient("đậu ăn")
    assert normalize_ingredient("thịt bò") != normalize_ingredient("thịt heo")
    parsed = parse_ingredients("Đậu phụ (đậu hũ): 100 g | Dưa chuột/ Dưa leo: 20 g")
    assert len(parsed) == 2
    assert "đậu phụ" in parsed[0].match_keys
    assert normalize_ingredient("dưa leo") in parsed[1].match_keys


def test_tfidf_search_reports_matches_missing_and_ranks_better_overlap_first():
    dishes = [
        _dish("a", "Bò hành", "Thịt bò: 100 g | Hành tây: 20 g | Dầu ăn: 5 g"),
        _dish("b", "Bò cà chua", "Thịt bò: 100 g | Cà chua: 30 g | Hành tây: 20 g | Muối: 1 g"),
        _dish("c", "Cá kho", "Cá basa: 100 g | Nước mắm: 5 g"),
    ]
    result = IngredientRecommender(dishes).search(["THỊT BÒ", "hành tây", "thịt bò"])
    assert result["results"][0]["dish_id"] == "a"
    first = result["results"][0]
    assert first["matched_count"] == 2
    assert first["required_count"] == 3
    assert first["ingredient_match_ratio"] == pytest.approx(2 / 3, abs=0.0001)
    assert first["matched_ingredients"] == ["Thịt bò", "Hành tây"]
    assert first["missing_ingredients"] == ["Dầu ăn"]
    assert first["similarity_score"] > 0


def test_unknown_ingredient_does_not_return_zero_similarity_dishes():
    recommender = IngredientRecommender([_dish("a", "Bò hành", "Thịt bò: 100 g | Hành tây: 20 g")])
    assert recommender.search(["nguyên liệu không tồn tại"])["results"] == []


def test_catalog_reports_missing_file_and_missing_ingredient_column(tmp_path):
    with pytest.raises(FileNotFoundError):
        read_catalog(tmp_path / "missing.xlsx")
    malformed = tmp_path / "malformed.xlsx"
    import pandas as pd
    pd.DataFrame([{"dish_id": "x", "name": "Món thử"}]).to_excel(malformed, sheet_name="dishes", index=False)
    with pytest.raises(ValueError, match="thiếu cột cần thiết"):
        read_catalog(malformed)


def test_filters_use_real_per_serving_nutrition_and_keep_missing_values_null():
    dishes = [
        _dish("a", "Protein cao", "Trứng gà: 2 quả", calories=400, protein=30),
        _dish("b", "Ít calo", "Trứng cút: 3 quả", calories=200, protein=8),
        _dish("c", "Dữ liệu thiếu", "Trứng vịt: 1 quả", calories=None, protein=None),
    ]
    recommender = IngredientRecommender(dishes)
    result = recommender.search(["trứng gà"], max_calories=350)
    assert result["results"] == []
    result = recommender.search(["trứng gà"], min_protein=35)
    assert result["results"] == []
    result = recommender.search(["trứng gà"])
    assert result["results"][0]["calories"] == 400
    assert result["results"][0]["protein"] == 30
    missing = recommender.search(["trứng vịt"], max_calories=1000, min_protein=0)
    assert missing["results"] == []
    unfiltered_missing = recommender.search(["trứng vịt"])
    assert unfiltered_missing["results"][0]["calories"] is None
    assert unfiltered_missing["results"][0]["protein"] is None


def test_allergies_from_profile_are_filtered_and_inputs_are_not_assumed_available():
    dishes = [
        _dish("safe", "Bò xào", "Thịt bò: 100 g | Hành tây: 20 g"),
        _dish("unsafe", "Bánh lạc", "Lạc hạt: 20 g | Đường: 5 g"),
    ]
    profile = UserProfile(user_id=1, allergies_json='["peanut"]', avoid_ingredients_json="[]")
    result = IngredientRecommender(dishes).search(["thịt bò", "cà chua"], profile=profile)
    assert all(row["dish_id"] != "unsafe" for row in result["results"])
    safe = result["results"][0]
    assert safe["missing_ingredients"] == ["Hành tây"]


def test_recommendations_api_allows_guests_and_returns_typed_payload(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    profile = UserProfile(user_id=1, allergies_json="[]", avoid_ingredients_json="[]")
    dishes = [_dish("api-1", "Bò hành", "Thịt bò: 100 g | Hành tây: 20 g | Dầu ăn: 5 g")]
    recommender = IngredientRecommender(dishes)
    previous_secret = settings.secret_key
    previous_recommender = state.ingredient_recommender
    object.__setattr__(settings, "secret_key", "ingredient-api-test-secret")
    state.ingredient_recommender = recommender

    def override_db():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app = main_module.app
    app.dependency_overrides[get_db] = override_db
    try:
        with Session(engine) as session:
            user = User(id=1, username="ingredient-user", password_hash="hashed", profile=profile)
            session.add(user)
            session.commit()
        client = TestClient(app)
        guest = client.post("/api/v1/recommendations/by-ingredients", json={"ingredients": ["thịt bò"]})
        assert guest.status_code == 200
        assert guest.json()["total"] == 1
        trial_filter = client.post("/api/v1/recommendations/by-ingredients", json={
            "ingredients": ["thịt bò"], "avoid_ingredients": ["thịt bò"],
        })
        assert trial_filter.status_code == 200
        assert trial_filter.json()["total"] == 0
        token = create_access_token(1)
        headers = {"Authorization": f"Bearer {token}"}
        invalid = client.post("/api/v1/recommendations/by-ingredients", json={"ingredients": [" "]}, headers=headers)
        assert invalid.status_code == 422
        empty = client.post("/api/v1/recommendations/by-ingredients", json={"ingredients": []}, headers=headers)
        assert empty.status_code == 422
        response = client.post("/api/v1/recommendations/by-ingredients", json={"ingredients": ["Thịt bò"]}, headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["results"][0]["missing_ingredients"] == ["Hành tây", "Dầu ăn"]
    finally:
        object.__setattr__(settings, "secret_key", previous_secret)
        state.ingredient_recommender = previous_recommender
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_selecting_recommended_dish_saves_new_meal_plan_version(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    previous_secret = settings.secret_key
    previous_model = state.model_bundle
    previous_warning = state.model_warning
    object.__setattr__(settings, "secret_key", "select-dish-api-test-secret")
    state.model_bundle = None
    state.model_warning = None

    def override_db():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app = main_module.app
    app.dependency_overrides[get_db] = override_db
    try:
        with Session(engine) as session:
            user = User(username="meal-choice", password_hash="hashed")
            user.profile = UserProfile(
                date_of_birth=date(1995, 1, 1),
                height_cm=165, weight_kg=60, sex_for_calculation="female",
                activity_level="light", goal="maintain_weight",
                allergies_json='["peanut"]', avoid_ingredients_json="[]",
                disliked_dishes_json="[]", favorite_dishes_json="[]",
            )
            session.add(user)
            session.add_all([
                _dish(f"base-{index}", f"Món nền {index}", f"Thịt bò: 80 g | Gạo tẻ: 100 g")
                for index in range(5)
            ])
            chosen = _dish("chosen", "Món do người dùng chọn", "Thịt bò: 100 g | Hành tây: 20 g")
            unsafe = _dish("unsafe-choice", "Món có đậu phộng", "Đậu phộng: 20 g | Đường: 5 g")
            session.add_all([chosen, unsafe])
            session.commit()
            user_id = user.id
        token = create_access_token(user_id)
        headers = {"Authorization": f"Bearer {token}"}
        client = TestClient(app)
        payload = {"plan_date": "2026-11-03", "meal_type": "breakfast", "dish_id": "chosen"}
        first = client.post("/api/v1/meal-plans/select-dish", json=payload, headers=headers)
        assert first.status_code == 201, first.text
        first_plan = first.json()["data"]
        assert first_plan["version"] == 1
        assert len(first_plan["meals"]) == 3
        assert next(item for item in first_plan["meals"] if item["meal_type"] == "breakfast")["dish_id"] == "chosen"

        second = client.post(
            "/api/v1/meal-plans/select-dish",
            json={**payload, "meal_type": "dinner", "dish_id": "base-4"},
            headers=headers,
        )
        assert second.status_code == 201, second.text
        second_plan = second.json()["data"]
        assert second_plan["version"] == 2
        assert next(item for item in second_plan["meals"] if item["meal_type"] == "breakfast")["dish_id"] == "chosen"
        assert next(item for item in second_plan["meals"] if item["meal_type"] == "dinner")["dish_id"] == "base-4"
        history = client.get("/api/v1/meal-plans?date=2026-11-03", headers=headers)
        assert history.status_code == 200
        assert len(history.json()["data"]) == 2
        assert history.json()["data"][0]["version"] == 1
        rejected = client.post(
            "/api/v1/meal-plans/select-dish",
            json={**payload, "dish_id": "unsafe-choice"},
            headers=headers,
        )
        assert rejected.status_code == 422
        still_two_versions = client.get("/api/v1/meal-plans?date=2026-11-03", headers=headers)
        assert len(still_two_versions.json()["data"]) == 2
    finally:
        object.__setattr__(settings, "secret_key", previous_secret)
        state.model_bundle = previous_model
        state.model_warning = previous_warning
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()
