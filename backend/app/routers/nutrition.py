from datetime import datetime, timezone
from functools import lru_cache
import importlib.util
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..dependencies import current_user
from ..database import get_db
from ..models import NutritionCalculationRecord, User
from ..nutrition import age_on, calculate
from ..schemas import NutritionHistorySaveInput, NutritionInput
from ..utils.profiles import profile_for_calculation

router = APIRouter(prefix="/api/v1/nutrition", tags=["Nutrition"])


@lru_cache(maxsize=1)
def _body_status_predictor():
    script_path = Path(__file__).resolve().parents[2] / "train_obesity_model.py"
    spec = importlib.util.spec_from_file_location("nutriai_obesity_training", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Không nạp được module dự đoán thể trạng: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.predict_body_status


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


@router.post("/body-status")
def predict_body_status(payload: dict = Body(...), _user: User = Depends(current_user)):
    """Classify the supplied CSV-shaped profile without changing Nutrition Engine targets."""
    try:
        predictor = _body_status_predictor()
        return {"data": predictor(payload)}
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, f"Mô hình thể trạng chưa sẵn sàng: {exc}") from exc


@router.post("/history", status_code=201)
def save_calculation(
    payload: NutritionHistorySaveInput | None = Body(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    result = _calculate_for_user(user)
    body_status_input = payload.body_status_input if payload else None
    if body_status_input is not None:
        try:
            result["body_status_input"] = body_status_input
            result["body_status"] = _body_status_predictor()(body_status_input)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(503, str(exc)) from exc
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
