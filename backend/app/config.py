from __future__ import annotations

import os
import json
from dataclasses import dataclass
from pathlib import Path


def _mapping_env(name: str, default: dict[str, float]) -> dict[str, float]:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = json.loads(raw)
        if isinstance(value, dict) and set(value) == set(default):
            return {key: float(value[key]) for key in default}
    except (TypeError, ValueError):
        pass
    return default

try:
    from dotenv import load_dotenv

    # Load backend-local configuration before creating Settings. Environment
    # variables already supplied by the process retain precedence.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    # Production may inject environment variables directly without dotenv.
    pass


@dataclass(frozen=True)
class Settings:
    secret_key: str = os.getenv("NUTRIAI_SECRET_KEY", "")
    database_url: str = os.getenv("NUTRIAI_DATABASE_URL", "sqlite:///./nutriai.db")
    dataset_path: Path = Path(os.getenv("NUTRIAI_DATASET_PATH", str(Path(__file__).resolve().parents[2] / "bo-du-lieu-mon-an.xlsx"))).resolve()
    model_path: Path = Path(os.getenv("NUTRIAI_MODEL_PATH", str(Path(__file__).resolve().parents[2] / "mo_hinh_dinh_duong.pkl"))).resolve()
    token_ttl_seconds: int = int(os.getenv("NUTRIAI_TOKEN_TTL_SECONDS", "86400"))
    timezone_name: str = os.getenv("NUTRIAI_TIMEZONE", "Asia/Ho_Chi_Minh")
    cors_origins: tuple[str, ...] = tuple(
        origin.strip() for origin in os.getenv("NUTRIAI_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
        if origin.strip()
    )
    calorie_minimum: float = float(os.getenv("NUTRIAI_CALORIE_MINIMUM", "1200"))
    calorie_maximum: float = float(os.getenv("NUTRIAI_CALORIE_MAXIMUM", "4000"))
    activity_factors: dict[str, float] | None = None
    calorie_adjustment: dict[str, float] | None = None
    meal_split: dict[str, float] | None = None
    repeat_penalties: dict[str, float] | None = None
    score_weights: dict[str, float] | None = None
    protein_factors: dict[str, float] | None = None
    activity_protein_bonus: dict[str, float] | None = None
    fat_energy_fraction: float = float(os.getenv("NUTRIAI_FAT_ENERGY_FRACTION", "0.30"))

    def __post_init__(self) -> None:
        object.__setattr__(self, "activity_factors", _mapping_env("NUTRIAI_ACTIVITY_FACTORS", {
            "sedentary": 1.2, "light": 1.375, "moderate": 1.55,
            "active": 1.725, "very_active": 1.9,
        }))
        object.__setattr__(self, "calorie_adjustment", _mapping_env("NUTRIAI_CALORIE_ADJUSTMENT", {
            "lose_weight": -0.10, "gain_weight": 0.10,
            "gain_muscle": 0.05, "maintain_weight": 0.0,
        }))
        object.__setattr__(self, "meal_split", {"breakfast": .25, "lunch": .40, "dinner": .35})
        object.__setattr__(self, "repeat_penalties", {
            "same_day": 1.0, "yesterday": .75, "three_days": .50,
            "seven_days": .25, "thirty_days": .10,
        })
        object.__setattr__(self, "score_weights", {
            "calorie": .35, "goal": .15, "preference": .15, "variety": .15, "macro": .20,
        })
        object.__setattr__(self, "protein_factors", _mapping_env("NUTRIAI_PROTEIN_FACTORS", {
            "lose_weight": 1.6, "maintain_weight": 1.2,
            "gain_weight": 1.4, "gain_muscle": 1.8,
        }))
        object.__setattr__(self, "activity_protein_bonus", _mapping_env("NUTRIAI_ACTIVITY_PROTEIN_BONUS", {
            "sedentary": 0.0, "light": 0.0, "moderate": 0.1,
            "active": 0.2, "very_active": 0.2,
        }))


settings = Settings()
