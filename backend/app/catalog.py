from pathlib import Path

import joblib
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import Dish


REQUIRED_COLUMNS = {
    "dish_id", "source_code", "name", "food_group", "ingredients", "serving_g",
    "energy_kcal_per_100g", "protein_g_per_100g", "carb_g_per_100g", "fat_g_per_100g",
    "energy_kcal", "protein_g", "carb_g", "fat_g", "kcal_macro_mismatch",
}

# Some workbook revisions intentionally omit nutrition-per-serving columns;
# those values can be derived from the authoritative per-100g columns.
DERIVABLE_COLUMNS = {"energy_kcal", "protein_g", "carb_g", "fat_g"}
IDENTITY_COLUMNS = {"dish_id", "source_code", "name", "food_group", "ingredients"}
DERIVED_PER_100G_COLUMNS = {"fat_g_per_100g"}
REQUIRED_SOURCE_COLUMNS = REQUIRED_COLUMNS - DERIVABLE_COLUMNS - DERIVED_PER_100G_COLUMNS - {"kcal_macro_mismatch"}

# Dataset versions may use Vietnamese or legacy aliases for the same fields.
# Normalize headers once at the import boundary so the rest of the API keeps a
# stable internal catalog schema.
COLUMN_ALIASES = {
    "dish_id": ("dish_id", "id", "ma_mon", "mã món", "mã món ăn", "stt"),
    "source_code": ("source_code", "ma_nguon", "mã nguồn", "food_code"),
    "name": ("name", "ten_mon", "tên món", "tên món ăn", "dish_name"),
    "food_group": ("food_group", "nhom_thuc_pham", "nhóm thực phẩm", "nhóm món", "food category"),
    "meal_category": ("meal_category", "meal category", "nhóm bữa", "loại bữa", "phân loại bữa"),
    "ingredients": ("ingredients", "nguyen_lieu", "nguyên liệu", "thành phần"),
    "serving_g": ("serving_g", "khoi_luong_khau_phan_g", "khối lượng khẩu phần (g)", "khối lượng khẩu phần", "khẩu phần (g)"),
    "energy_kcal_per_100g": ("energy_kcal_per_100g", "kcal_per_100g", "kcal/100g", "năng lượng (kcal/100g)", "năng lượng kcal/100g"),
    "protein_g_per_100g": ("protein_g_per_100g", "protein_per_100g", "protein (g/100g)", "đạm (g/100g)"),
    "carb_g_per_100g": ("carb_g_per_100g", "carbohydrate_g_per_100g", "carb (g/100g)", "carbohydrate (g/100g)", "đường bột (g/100g)"),
    "fat_g_per_100g": ("fat_g_per_100g", "lipid_g_per_100g", "fat (g/100g)", "lipid (g/100g)", "chất béo (g/100g)"),
    "energy_kcal": ("energy_kcal", "kcal_per_serving", "năng lượng (kcal)", "năng lượng khẩu phần (kcal)"),
    "protein_g": ("protein_g", "protein_per_serving", "protein (g)", "đạm (g)"),
    "carb_g": ("carb_g", "carb_per_serving", "carbohydrate (g)", "đường bột (g)"),
    "fat_g": ("fat_g", "fat_per_serving", "lipid (g)", "chất béo (g)"),
    "kcal_macro_mismatch": ("kcal_macro_mismatch", "macro_mismatch", "cờ lệch kcal", "kcal lệch đa lượng"),
    "instructions": ("instructions", "cach_lam", "cách làm", "cách chế biến", "hướng dẫn"),
    "image_url": ("image_url", "url_anh", "url ảnh", "ảnh"),
    "image_file": ("image_file", "tep_anh", "tệp ảnh", "tên ảnh"),
}


def _normalize_header(value: object) -> str:
    import re
    import unicodedata

    text = unicodedata.normalize("NFKD", str(value).strip().casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def _normalize_catalog_columns(df: pd.DataFrame) -> pd.DataFrame:
    aliases = {
        _normalize_header(alias): canonical
        for canonical, names in COLUMN_ALIASES.items()
        for alias in names
    }
    rename = {
        column: aliases[_normalize_header(column)]
        for column in df.columns
        if _normalize_header(column) in aliases
    }
    normalized = df.rename(columns=rename)
    # If two source columns map to one canonical field, prefer the first
    # non-empty value on each row instead of silently discarding either.
    if normalized.columns.duplicated().any():
        merged = pd.DataFrame(index=normalized.index)
        for column in dict.fromkeys(normalized.columns):
            matches = normalized.loc[:, normalized.columns == column]
            merged[column] = matches.bfill(axis=1).iloc[:, 0] if matches.shape[1] > 1 else matches.iloc[:, 0]
        normalized = merged
    return normalized


def _read_catalog_sheet(path: Path) -> pd.DataFrame:
    """Find the worksheet that contains the dish catalog, regardless of its title."""
    workbook = pd.ExcelFile(path)
    if "dishes" in workbook.sheet_names:
        return pd.read_excel(workbook, sheet_name="dishes")

    candidates: list[tuple[str, int, set[str], int]] = []
    for sheet_name in workbook.sheet_names:
        # Read a few rows as well as the header: some exported workbooks have a
        # title line above the real header. Trying several offsets lets pandas
        # recognize those sheets without requiring a specific worksheet name.
        for header_row in range(4):
            try:
                frame = pd.read_excel(workbook, sheet_name=sheet_name, header=header_row, nrows=5)
            except (ValueError, IndexError):
                continue
            frame = _normalize_catalog_columns(frame)
            columns = set(frame.columns)
            score = len(columns.intersection(REQUIRED_COLUMNS))
            if IDENTITY_COLUMNS.issubset(columns) and REQUIRED_SOURCE_COLUMNS.issubset(columns) and not frame.empty:
                candidates.append((sheet_name, header_row, columns, score))
                break

    if candidates:
        best_score = max(candidate[3] for candidate in candidates)
        best = [candidate for candidate in candidates if candidate[3] == best_score]
        # A strict winner is safe even when the workbook has unrelated sheets.
        # For tied catalog-like sheets, prefer one with every required field.
        complete = [candidate for candidate in best if REQUIRED_SOURCE_COLUMNS.issubset(candidate[2])]
        selected = complete[0] if len(complete) == 1 else best[0] if len(best) == 1 else None
        if selected:
            return _normalize_catalog_columns(pd.read_excel(workbook, sheet_name=selected[0], header=selected[1]))

    details = ", ".join(
        f"{sheet!r} ({score}/{len(REQUIRED_COLUMNS)} cột bắt buộc)"
        for sheet, _, _, score in candidates
    ) or ", ".join(workbook.sheet_names)
    raise ValueError(
        "Không xác định được sheet dữ liệu món ăn trong workbook. "
        f"Các sheet ứng viên: {details}. "
        "Cần một sheet có cột mã món và tên món, tốt nhất có đủ các cột dinh dưỡng bắt buộc."
    )


def _repair_mojibake(value: str) -> str:
    """Repair text that was UTF-8 bytes decoded as Windows-1252/Latin-1."""
    if not any(marker in value for marker in ("Ã", "Â", "á»", "áº", "ðŸ")):
        return value
    for encoding in ("cp1252", "latin1"):
        try:
            candidate = value.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if candidate.count("�") <= value.count("�") and candidate.count("Ã") + candidate.count("á»") < value.count("Ã") + value.count("á»"):
            return candidate
    return value


def read_catalog(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"Không tìm thấy workbook dữ liệu món ăn: {path}")
    df = _read_catalog_sheet(path)
    missing = REQUIRED_SOURCE_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Sheet dishes thiếu cột cần thiết: {sorted(missing)}")
    # Canonicalize source column order and derive serving nutrition when a
    # newer workbook only stores values per 100 g plus serving_g.
    for per_serving, per_100g in (
        ("energy_kcal", "energy_kcal_per_100g"),
        ("protein_g", "protein_g_per_100g"),
        ("carb_g", "carb_g_per_100g"),
        ("fat_g", "fat_g_per_100g"),
    ):
        if per_serving not in df.columns:
            df[per_serving] = pd.to_numeric(df[per_100g], errors="coerce") * pd.to_numeric(df["serving_g"], errors="coerce") / 100
    if "fat_g_per_100g" not in df.columns:
        serving_g = pd.to_numeric(df["serving_g"], errors="coerce")
        fat_g = pd.to_numeric(df["fat_g"], errors="coerce")
        df["fat_g_per_100g"] = fat_g.div(serving_g.where(serving_g.ne(0))).mul(100)
    if "kcal_macro_mismatch" not in df.columns:
        energy = pd.to_numeric(df["energy_kcal_per_100g"], errors="coerce")
        macro_energy = 4 * pd.to_numeric(df["protein_g_per_100g"], errors="coerce") + 4 * pd.to_numeric(df["carb_g_per_100g"], errors="coerce") + 9 * pd.to_numeric(df["fat_g_per_100g"], errors="coerce")
        df["kcal_macro_mismatch"] = ((energy - macro_energy).abs() > energy.abs() * 0.2).astype(int)
    # Optional labels come from the separate processed workbook. The source
    # catalog remains authoritative for dish and nutrition fields.
    labels_by_id: dict[str, str] = {}
    label_path = path.parent / "ket_qua_dan_nhan_AI.xlsx"
    if label_path.exists():
        try:
            labels = pd.read_excel(label_path, sheet_name="ket_qua")
            label_column = next((
                column for column in ("Nhan_Du_Lieu", "lable", "Nhan_Du_Doan_AI")
                if column in labels.columns
            ), None)
            if "dish_id" in labels.columns and label_column:
                labels_by_id = {
                    str(row["dish_id"]): str(row[label_column]).strip()
                    for _, row in labels.iterrows()
                    if pd.notna(row["dish_id"]) and pd.notna(row[label_column])
                }
        except (ValueError, OSError, ImportError):
            # Labels are supplementary; a malformed optional file must not
            # prevent ingredient search from using the primary catalog.
            labels_by_id = {}
    result = []
    for _, row in df.iterrows():
        def number(key):
            value = pd.to_numeric(row[key], errors="coerce")
            return None if pd.isna(value) else float(value)
        result.append({
            "id": str(row["dish_id"]), "source_code": str(row["source_code"]),
            "name": _repair_mojibake(str(row["name"])), "food_group": _repair_mojibake(str(row["food_group"])),
            "meal_category": (
                _repair_mojibake(str(row["meal_category"])).strip()
                if "meal_category" in df.columns and pd.notna(row["meal_category"]) and str(row["meal_category"]).strip()
                else None
            ),
            "ingredients": str(row["ingredients"]) if pd.notna(row["ingredients"]) else "",
            "instructions": (
                str(row["instructions"]).strip()
                if "instructions" in df.columns and pd.notna(row["instructions"]) and str(row["instructions"]).strip()
                else None
            ),
            "image_url": (
                str(row["image_url"]).strip()
                if "image_url" in df.columns and pd.notna(row["image_url"]) and str(row["image_url"]).strip()
                else f"/images/{str(row['dish_id']).strip()}.jpg"
                if (settings.data_dir / "hinh-anh-lam-net" / f"{str(row['dish_id']).strip()}.jpg").is_file()
                else None
            ),
            "image_file": (
                str(row["image_file"]).strip()
                if "image_file" in df.columns and pd.notna(row["image_file"]) and str(row["image_file"]).strip()
                else None
            ),
            "nutrition_label": labels_by_id.get(str(row["dish_id"])),
            "serving_g": number("serving_g"),
            "calories_per_100g": number("energy_kcal_per_100g"),
            "protein_per_100g": number("protein_g_per_100g"),
            "carb_per_100g": number("carb_g_per_100g"),
            "fat_per_100g": number("fat_g_per_100g"),
            "calories_per_serving": number("energy_kcal"),
            "protein_per_serving": number("protein_g"),
            "carb_per_serving": number("carb_g"),
            "fat_per_serving": number("fat_g"),
            "kcal_macro_mismatch": int(number("kcal_macro_mismatch") or 0),
            "data_quality": "macro_mismatch_flagged" if number("kcal_macro_mismatch") else "verified_per_100g",
        })
    return result


def sync_catalog(db: Session, rows: list[dict]) -> int:
    # The workbook is authoritative. Upsert its dishes and remove rows left
    # behind by older dataset versions so recommendations only use current data.
    existing_by_id = {dish.id: dish for dish in db.scalars(select(Dish)).all()}
    current_ids = {data["id"] for data in rows}
    for data in rows:
        dish = existing_by_id.get(data["id"])
        if dish is None:
            dish = Dish(id=data["id"], **{k: v for k, v in data.items() if k != "id"})
            db.add(dish)
        else:
            for key, value in data.items():
                if key != "id":
                    setattr(dish, key, value)
    for stale_id in existing_by_id.keys() - current_ids:
        db.delete(existing_by_id[stale_id])
    db.commit()
    return len(rows)


def load_model_metadata(path: Path) -> tuple[dict | None, str | None]:
    if not path.exists():
        return None, "Random Forest không có tại đường dẫn cấu hình; hệ thống tiếp tục bằng thuật toán xếp hạng dinh dưỡng."
    try:
        bundle = joblib.load(path)
        if not isinstance(bundle, dict) or "model" not in bundle:
            return None, "Artifact Random Forest không có cấu trúc {model, features}; bỏ qua model."
        features = bundle.get("features")
        if features != ["Calo", "Protein", "Carb", "Fat"]:
            return None, f"Artifact Random Forest không tương thích tính năng: {features!r}; bỏ qua model."
        model = bundle["model"]
        single_thread_params = {
            name: 1
            for name, value in model.get_params(deep=True).items()
            if name.endswith("n_jobs") and value == -1
        }
        if single_thread_params:
            model.set_params(**single_thread_params)
        return bundle, None
    except Exception as exc:  # compatibility depends on exact sklearn/numpy versions
        return None, f"Không nạp được Random Forest ({type(exc).__name__}); tiếp tục không dùng model."


def get_dishes(db: Session) -> list[Dish]:
    return list(db.scalars(select(Dish).order_by(Dish.id)).all())
