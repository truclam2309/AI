from fastapi import HTTPException

from ..models import UserProfile
from ..schemas import NutritionInput


def profile_for_calculation(
    profile: UserProfile | None,
    body: NutritionInput | None = None,
) -> dict:
    if profile is None:
        raise HTTPException(422, "Hãy bổ sung hồ sơ dinh dưỡng trước khi tính.")
    fields = {
        key: getattr(profile, key)
        for key in (
            "height_cm", "weight_kg", "date_of_birth",
            "sex_for_calculation", "activity_level", "goal",
        )
    }
    if body is not None:
        for key in fields:
            value = getattr(body, key)
            if value is not None:
                fields[key] = value
    missing = [key for key, value in fields.items() if value is None]
    if missing:
        raise HTTPException(
            422,
            {"message": "Hồ sơ chưa đủ thông tin để tính.", "missing_fields": missing},
        )
    return fields
