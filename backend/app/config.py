from __future__ import annotations

import os
import json
from dataclasses import dataclass
from pathlib import Path


def _mapping_env(name: str, default: dict[str, float]) -> dict[str, float]:
    """Đọc bảng hệ số dạng JSON từ biến môi trường.

    Chỉ nhận cấu hình có đủ bộ khóa như bảng mặc định; JSON sai định dạng
    hoặc thiếu/thừa khóa sẽ dùng giá trị mặc định để tránh bảng hệ số không nhất quán.
    """
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

    # Nạp backend/.env trước khi tạo Settings. Biến môi trường đã được hệ điều
    # hành hoặc nền tảng triển khai (ví dụ Render) đặt sẵn sẽ được ưu tiên.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    # Môi trường production có thể truyền biến trực tiếp và không cần python-dotenv.
    pass


def _database_url() -> str:
    """Lấy URL database và chuẩn hóa URL PostgreSQL cho SQLAlchemy + psycopg 3."""
    url = os.getenv("NUTRIAI_DATABASE_URL", "sqlite:///./nutriai.db")
    # Render/Postgres commonly supplies a URL without an explicit SQLAlchemy
    # driver. Use psycopg 3 when a PostgreSQL URL is configured.
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


@dataclass(frozen=True)
class Settings:
    """Cấu hình backend tập trung, được đọc một lần khi module được import.

    Có thể ghi đè các giá trị bằng biến môi trường NUTRIAI_*. Khi thay đổi
    backend/.env, cần khởi động lại tiến trình để tạo lại đối tượng settings.
    frozen=True giúp các giá trị cấu hình không bị sửa nhầm trong lúc chạy.
    """

    # Khóa ký access token. Bắt buộc phải đặt khi khởi động backend production;
    # không dùng chung với biến VITE_* vì biến frontend được công khai cho trình duyệt.
    secret_key: str = os.getenv("NUTRIAI_SECRET_KEY", "")

    # URL lưu trữ user, hồ sơ và lịch sử thực đơn. Mặc định dùng SQLite local.
    database_url: str = _database_url()

    # Thư mục dữ liệu, workbook catalog và artifact Random Forest.
    data_dir: Path = Path(os.getenv("NUTRIAI_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))).resolve()
    dataset_path: Path = Path(os.getenv("NUTRIAI_DATASET_PATH", str(data_dir / "bo-du-lieu-mon-an.xlsx"))).resolve()
    model_path: Path = Path(os.getenv("NUTRIAI_MODEL_PATH", str(Path(__file__).resolve().parents[1] / "models" / "mo_hinh_dinh_duong.pkl"))).resolve()

    # Thời hạn access token tính bằng giây; mặc định 24 giờ.
    token_ttl_seconds: int = int(os.getenv("NUTRIAI_TOKEN_TTL_SECONDS", "86400"))

    # Múi giờ dùng khi xác định ngày hiện tại và ghi thời gian.
    timezone_name: str = os.getenv("NUTRIAI_TIMEZONE", "Asia/Ho_Chi_Minh")

    # Các origin frontend được phép gọi API qua CORS; nhiều origin phân cách bằng dấu phẩy.
    cors_origins: tuple[str, ...] = tuple(
        origin.strip() for origin in os.getenv(
            "NUTRIAI_CORS_ORIGINS",
            "http://localhost:5173,http://localhost:3000,https://ai-vdyx-bug5a3aud-mis-3032.vercel.app",
        ).split(",")
        if origin.strip()
    )

    # Ngưỡng kiểm tra mục tiêu calo đề xuất trong ngày.
    calorie_minimum: float = float(os.getenv("NUTRIAI_CALORIE_MINIMUM", "1200"))
    calorie_maximum: float = float(os.getenv("NUTRIAI_CALORIE_MAXIMUM", "4000"))

    # Các bảng hệ số được khởi tạo trong __post_init__; khai báo Optional để
    # dataclass tạo được instance trước khi gán các giá trị mặc định.
    activity_factors: dict[str, float] | None = None
    calorie_adjustment: dict[str, float] | None = None
    meal_split: dict[str, float] | None = None
    repeat_penalties: dict[str, float] | None = None
    score_weights: dict[str, float] | None = None
    protein_factors: dict[str, float] | None = None
    activity_protein_bonus: dict[str, float] | None = None
    fat_energy_fraction: float = float(os.getenv("NUTRIAI_FAT_ENERGY_FRACTION", "0.30"))

    def __post_init__(self) -> None:
        """Tạo các bảng hệ số mặc định và nạp bản ghi đè hợp lệ từ môi trường."""
        # Hệ số vận động dùng để tính TDEE từ BMR.
        object.__setattr__(self, "activity_factors", _mapping_env("NUTRIAI_ACTIVITY_FACTORS", {
            "sedentary": 1.2, "light": 1.375, "moderate": 1.55,
            "active": 1.725, "very_active": 1.9,
        }))
        # Mức điều chỉnh TDEE tùy mục tiêu cân nặng/cơ bắp.
        object.__setattr__(self, "calorie_adjustment", _mapping_env("NUTRIAI_CALORIE_ADJUSTMENT", {
            "lose_weight": -0.10, "gain_weight": 0.10,
            "gain_muscle": 0.05, "maintain_weight": 0.0,
        }))
        # Tỷ lệ calo ngày mặc định cho ba bữa chính; tổng bằng 1 (100%).
        object.__setattr__(self, "meal_split", {"breakfast": .25, "lunch": .40, "dinner": .35})
        # Mức phạt món đã xuất hiện trong lịch sử, giảm dần theo thời gian.
        object.__setattr__(self, "repeat_penalties", {
            "same_day": 1.0, "yesterday": .75, "three_days": .50,
            "seven_days": .25, "thirty_days": .10,
        })
        # Trọng số các tín hiệu xếp hạng món trong thuật toán thực đơn.
        object.__setattr__(self, "score_weights", {
            "calorie": .35, "goal": .15, "preference": .15, "variety": .15, "macro": .20,
        })
        # Lượng protein tham khảo theo kg cân nặng và mục tiêu.
        object.__setattr__(self, "protein_factors", _mapping_env("NUTRIAI_PROTEIN_FACTORS", {
            "lose_weight": 1.6, "maintain_weight": 1.2,
            "gain_weight": 1.4, "gain_muscle": 1.8,
        }))
        # Phần protein cộng thêm theo mức vận động.
        object.__setattr__(self, "activity_protein_bonus", _mapping_env("NUTRIAI_ACTIVITY_PROTEIN_BONUS", {
            "sedentary": 0.0, "light": 0.0, "moderate": 0.1,
            "active": 0.2, "very_active": 0.2,
        }))


settings = Settings()
