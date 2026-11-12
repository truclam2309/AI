from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

Goal = Literal["lose_weight", "gain_weight", "gain_muscle", "maintain_weight"]
Sex = Literal["male", "female"]
Activity = Literal["sedentary", "light", "moderate", "active", "very_active"]


class ProfileInput(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    date_of_birth: date | None = None
    height_cm: float | None = Field(default=None, gt=0, le=260)
    weight_kg: float | None = Field(default=None, gt=0, le=500)
    sex_for_calculation: Sex | None = None
    activity_level: Activity | None = None
    goal: Goal | None = None
    target_weight_kg: float | None = Field(default=None, gt=0, le=500)
    allergies: list[str] = Field(default_factory=list, max_length=50)
    avoid_ingredients: list[str] = Field(default_factory=list, max_length=100)
    disliked_dishes: list[str] = Field(default_factory=list, max_length=100)
    favorite_dishes: list[str] = Field(default_factory=list, max_length=100)


class RegisterInput(ProfileInput):
    username: str | None = Field(default=None, min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr | None = None
    password: str = Field(min_length=10, max_length=128)

    @model_validator(mode="after")
    def require_identity(self):
        if self.username is None and self.email is None:
            raise ValueError("Cần cung cấp email hoặc username.")
        return self


class LoginInput(BaseModel):
    username_or_email: str
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str | None
    email: EmailStr | None
    created_at: str
    profile: dict


class NutritionInput(BaseModel):
    height_cm: float | None = Field(default=None, gt=0, le=260)
    weight_kg: float | None = Field(default=None, gt=0, le=500)
    date_of_birth: date | None = None
    sex_for_calculation: Sex | None = None
    activity_level: Activity | None = None
    goal: Goal | None = None


class NutritionHistorySaveInput(BaseModel):
    body_status_input: dict | None = None


class GenerateInput(BaseModel):
    plan_date: date | None = None
    meal_split: dict[str, float] | None = None


class SelectDishInput(BaseModel):
    plan_date: date
    meal_type: Literal["breakfast", "lunch", "dinner"]
    dish_id: str = Field(min_length=1, max_length=80)


class IngredientSearchInput(BaseModel):
    ingredients: list[str] = Field(min_length=1, max_length=40)
    limit: int = Field(default=12, ge=1, le=50)
    max_calories: float | None = Field(default=None, ge=0, le=10000)
    min_protein: float | None = Field(default=None, ge=0, le=1000)
    goal: Goal | None = None

    @field_validator("ingredients")
    @classmethod
    def validate_ingredient_values(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if isinstance(value, str) and value.strip()]
        if not cleaned:
            raise ValueError("Cần nhập ít nhất một nguyên liệu không để trống.")
        return cleaned


class IngredientRecommendation(BaseModel):
    dish_id: str
    name: str
    image_url: str | None
    ingredients: list[str]
    matched_ingredients: list[str]
    missing_ingredients: list[str]
    matched_count: int
    required_count: int
    ingredient_match_ratio: float
    similarity_score: float
    calories: float | None
    protein: float | None
    carb: float | None
    fat: float | None
    serving_grams: float | None
    instructions: str | None
    food_group: str | None
    nutrition_label: str | None
    nutrition_label_note: str | None


class IngredientSearchResponse(BaseModel):
    ingredients: list[str]
    total: int
    results: list[IngredientRecommendation]
    warnings: list[str]

