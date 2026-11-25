from datetime import datetime, timezone
import json
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..dependencies import current_user
from ..database import get_db
from ..models import NutritionCalculationRecord, User, UserProfile
from ..nutrition import age_on, calculate
from ..schemas import NutritionInput
from ..utils.profiles import profile_for_calculation

router = APIRouter(prefix="/api/v1/nutrition", tags=["Nutrition"])


@router.post("/calculate-preview")
def calculate_preview(payload: NutritionInput):
    """Calculate nutrition from temporary guest input without persisting it."""
    profile = UserProfile(
        height_cm=payload.height_cm, weight_kg=payload.weight_kg,
        date_of_birth=payload.date_of_birth, sex_for_calculation=payload.sex_for_calculation,
        activity_level=payload.activity_level, goal=payload.goal,
    )
    fields = profile_for_calculation(profile)
    today = datetime.now(ZoneInfo(settings.timezone_name)).date()
    age = age_on(fields["date_of_birth"], today)
    result = calculate(age, fields["height_cm"], fields["weight_kg"], fields["sex_for_calculation"], fields["activity_level"], fields["goal"])
    return {"data": {
        "height_cm": fields["height_cm"], "weight_kg": fields["weight_kg"],
        "age_years": age, "sex_for_calculation": fields["sex_for_calculation"],
        "activity_level": fields["activity_level"], "goal": fields["goal"],
        **result, "calculated_at": datetime.now(timezone.utc).isoformat(),
    }}


def _calculate_for_user(user: User, payload: NutritionInput | None = None) -> dict:
    fields = profile_for_calculation(user.profile, payload)
    today = datetime.now(ZoneInfo(settings.timezone_name)).date()
    age = age_on(fields["date_of_birth"], today)
    result = calculate(age, fields["height_cm"], fields["weight_kg"], fields["sex_for_calculation"], fields["activity_level"], fields["goal"])
    return {
        "height_cm": fields["height_cm"], "weight_kg": fields["weight_kg"],
        "age_years": age, "sex_for_calculation": fields["sex_for_calculation"],
        "activity_level": fields["activity_level"], "goal": fields["goal"],
        **result, "calculated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/calculate")
def calculate_nutrition(
    payload: NutritionInput | None = None,
    user: User = Depends(current_user),
):
    return {"data": _calculate_for_user(user, payload)}


@router.post("/history", status_code=201)
def save_calculation(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    result = _calculate_for_user(user)
    record = NutritionCalculationRecord(user_id=user.id, result_json=json.dumps(result, ensure_ascii=False))
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"data": {"id": record.id, **result}}


@router.get("/history")
def calculation_history(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(NutritionCalculationRecord).where(
        NutritionCalculationRecord.user_id == user.id
    ).order_by(desc(NutritionCalculationRecord.calculated_at)).limit(30)).all()
    return {"data": [{"id": row.id, **json.loads(row.result_json)} for row in rows]}
