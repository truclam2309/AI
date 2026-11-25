from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import current_user
from ..models import User, WeightLog
from ..schemas import WeightLogInput
from ..utils.time import local_today

router = APIRouter(prefix="/api/v1/weight-progress", tags=["Weight progress"])


def _serialize(log: WeightLog) -> dict:
    return {
        "id": log.id,
        "measured_on": log.measured_on.isoformat(),
        "weight_kg": log.weight_kg,
        "note": log.note,
        "created_at": log.created_at.isoformat(),
    }


@router.get("")
def list_weight_logs(
    limit: int = Query(default=365, ge=1, le=1000),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(WeightLog)
        .where(WeightLog.user_id == user.id)
        .order_by(WeightLog.measured_on.desc())
        .limit(limit)
    ).all()
    return {"data": [_serialize(row) for row in reversed(rows)]}


@router.post("", status_code=201)
def save_weight_log(
    payload: WeightLogInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if payload.measured_on > local_today():
        raise HTTPException(422, "Ngày ghi không thể ở tương lai.")
    log = db.scalar(
        select(WeightLog).where(
            WeightLog.user_id == user.id,
            WeightLog.measured_on == payload.measured_on,
        )
    )
    if log is None:
        log = WeightLog(user_id=user.id, measured_on=payload.measured_on)
        db.add(log)
    log.weight_kg = payload.weight_kg
    log.note = payload.note.strip() if payload.note and payload.note.strip() else None
    try:
        db.commit()
        db.refresh(log)
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, "Không thể lưu lần ghi cân nặng.") from exc
    return {"data": _serialize(log)}
