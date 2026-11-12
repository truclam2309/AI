from datetime import date, datetime
from zoneinfo import ZoneInfo

from ..config import settings


def local_today() -> date:
    return datetime.now(ZoneInfo(settings.timezone_name)).date()


def to_local_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    # SQLite returns naive datetimes; the application stores those values in UTC.
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo("UTC"))
    return value.astimezone(ZoneInfo(settings.timezone_name)).isoformat()
