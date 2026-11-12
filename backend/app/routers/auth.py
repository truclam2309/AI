from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, UserProfile
from ..schemas import LoginInput, RegisterInput
from ..security import create_access_token, hash_password, verify_password
from ..utils.serialization import profile_from_payload, public_user

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@router.post("/register", status_code=201)
def register(payload: RegisterInput, db: Session = Depends(get_db)):
    email = str(payload.email).lower() if payload.email else None
    identity_filters = []
    if payload.username:
        identity_filters.append(func.lower(User.username) == payload.username.lower())
    if email:
        identity_filters.append(func.lower(User.email) == email)
    if db.scalar(select(User).where(or_(*identity_filters))):
        raise HTTPException(409, "Email hoặc username đã được đăng ký.")

    profile_values = payload.model_dump(exclude={"username", "email", "password"})
    username = payload.username.lower() if payload.username else None
    user = User(username=username, email=email, password_hash=hash_password(payload.password))
    profile = UserProfile(user=user)
    profile_from_payload(profile, profile_values)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email hoặc username đã được đăng ký.")
    db.refresh(user)
    return {
        "user": public_user(user),
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
    }


@router.post("/login")
def login(payload: LoginInput, db: Session = Depends(get_db)):
    identity = payload.username_or_email.strip().lower()
    user = db.scalar(
        select(User).where(
            or_(func.lower(User.username) == identity, func.lower(User.email) == identity)
        )
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Tên đăng nhập/email hoặc mật khẩu không đúng.")
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}
