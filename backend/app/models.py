from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, foreign, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str | None] = mapped_column(String(80), unique=True, index=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    profile: Mapped["UserProfile | None"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")


class UserProfile(Base):
    __tablename__ = "user_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    full_name: Mapped[str | None] = mapped_column(String(160))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    height_cm: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    sex_for_calculation: Mapped[str | None] = mapped_column(String(16))
    activity_level: Mapped[str | None] = mapped_column(String(24))
    goal: Mapped[str | None] = mapped_column(String(24))
    target_weight_kg: Mapped[float | None] = mapped_column(Float)
    allergies_json: Mapped[str] = mapped_column(Text, default="[]")
    avoid_ingredients_json: Mapped[str] = mapped_column(Text, default="[]")
    disliked_dishes_json: Mapped[str] = mapped_column(Text, default="[]")
    favorite_dishes_json: Mapped[str] = mapped_column(Text, default="[]")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    user: Mapped[User] = relationship(back_populates="profile")


class Dish(Base):
    __tablename__ = "dishes"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    source_code: Mapped[str | None] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(300), index=True)
    food_group: Mapped[str | None] = mapped_column(String(120))
    meal_category: Mapped[str | None] = mapped_column(String(40))
    ingredients: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    image_file: Mapped[str | None] = mapped_column(String(255))
    nutrition_label: Mapped[str | None] = mapped_column(String(40))
    serving_g: Mapped[float | None] = mapped_column(Float)
    calories_per_100g: Mapped[float | None] = mapped_column(Float)
    protein_per_100g: Mapped[float | None] = mapped_column(Float)
    carb_per_100g: Mapped[float | None] = mapped_column(Float)
    fat_per_100g: Mapped[float | None] = mapped_column(Float)
    calories_per_serving: Mapped[float | None] = mapped_column(Float)
    protein_per_serving: Mapped[float | None] = mapped_column(Float)
    carb_per_serving: Mapped[float | None] = mapped_column(Float)
    fat_per_serving: Mapped[float | None] = mapped_column(Float)
    kcal_macro_mismatch: Mapped[int] = mapped_column(Integer, default=0)
    data_quality: Mapped[str] = mapped_column(String(40), default="verified_per_100g")


class DailyMealPlan(Base):
    __tablename__ = "daily_meal_plans"
    __table_args__ = (UniqueConstraint("user_id", "plan_date", "version", name="uq_user_day_version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan_date: Mapped[date] = mapped_column(Date, index=True)
    version: Mapped[int] = mapped_column(Integer)
    bmi_at_generation: Mapped[float] = mapped_column(Float)
    bmr_at_generation: Mapped[float] = mapped_column(Float)
    tdee_at_generation: Mapped[float] = mapped_column(Float)
    target_calories: Mapped[float] = mapped_column(Float)
    total_calories: Mapped[float] = mapped_column(Float)
    goal_snapshot: Mapped[str] = mapped_column(String(24))
    algorithm_version: Mapped[str] = mapped_column(String(40), default="nutriai-recommender-1")
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    items: Mapped[list["MealPlanItem"]] = relationship(back_populates="plan", cascade="all, delete-orphan", order_by="MealPlanItem.position")


class MealPlanItem(Base):
    __tablename__ = "meal_plan_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    meal_plan_id: Mapped[int] = mapped_column(ForeignKey("daily_meal_plans.id", ondelete="CASCADE"), index=True)
    dish_id: Mapped[str] = mapped_column(String(80))
    dish_name_snapshot: Mapped[str] = mapped_column(String(300))
    food_group_snapshot: Mapped[str | None] = mapped_column(String(120))
    ingredients_snapshot: Mapped[str | None] = mapped_column(Text)
    instructions_snapshot: Mapped[str | None] = mapped_column(Text)
    image_url_snapshot: Mapped[str | None] = mapped_column(Text)
    meal_type: Mapped[str] = mapped_column(String(20))
    is_cooked: Mapped[bool] = mapped_column(default=False)
    serving_grams: Mapped[float] = mapped_column(Float)
    calories: Mapped[float] = mapped_column(Float)
    protein: Mapped[float] = mapped_column(Float)
    carb: Mapped[float] = mapped_column(Float)
    fat: Mapped[float] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer)
    recommendation_reason: Mapped[str] = mapped_column(Text)
    plan: Mapped[DailyMealPlan] = relationship(back_populates="items")
    dish: Mapped["Dish | None"] = relationship(
        primaryjoin="foreign(MealPlanItem.dish_id) == Dish.id",
        viewonly=True,
        uselist=False,
    )


class NutritionCalculationRecord(Base):
    __tablename__ = "nutrition_calculation_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    result_json: Mapped[str] = mapped_column(Text)
