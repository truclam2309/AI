from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import current_user
from ..models import User, UserProfile
from ..schemas import ProfileInput
from ..utils.serialization import profile_from_payload, profile_values, public_user

router = APIRouter(prefix="/api/v1/users", tags=["Users"])


@router.get("/me")
def get_me(user: User = Depends(current_user)):
    return {"data": public_user(user)}


@router.put("/me/profile")
def update_profile(
    payload: ProfileInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    profile = user.profile
    if profile is None:
        profile = UserProfile(user_id=user.id)
        db.add(profile)
    profile_from_payload(profile, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(profile)
    return {"data": profile_values(profile)}
