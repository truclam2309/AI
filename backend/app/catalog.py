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


def read_catalog(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"Không tìm thấy workbook dữ liệu món ăn: {path}")
    df = pd.read_excel(path, sheet_name="dishes")
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Sheet dishes thiếu cột cần thiết: {sorted(missing)}")
    # Optional labels come from the separate processed workbook. The source
    # catalog remains authoritative for dish and nutrition fields.
    labels_by_id: dict[str, str] = {}
    label_path = path.parent / "ket_qua_dan_nhan_AI.xlsx"
    if label_path.exists():
        try:
            labels = pd.read_excel(label_path, sheet_name="ket_qua")
            if {"dish_id", "Nhan_Du_Doan_AI"}.issubset(labels.columns):
                labels_by_id = {
                    str(row["dish_id"]): str(row["Nhan_Du_Doan_AI"]).strip()
                    for _, row in labels.iterrows()
                    if pd.notna(row["dish_id"]) and pd.notna(row["Nhan_Du_Doan_AI"])
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
            "name": str(row["name"]), "food_group": str(row["food_group"]),
            "ingredients": str(row["ingredients"]) if pd.notna(row["ingredients"]) else "",
            "instructions": (
                str(row["instructions"]).strip()
                if "instructions" in df.columns and pd.notna(row["instructions"]) and str(row["instructions"]).strip()
                else None
            ),
            "image_url": (
                str(row["image_url"]).strip()
                if "image_url" in df.columns and pd.notna(row["image_url"]) and str(row["image_url"]).strip()
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
    # Upsert stable dataset identifiers; historical meal items use immutable snapshots.
    for data in rows:
        dish = db.get(Dish, data["id"])
        if dish is None:
            dish = Dish(id=data["id"], **{k: v for k, v in data.items() if k != "id"})
            db.add(dish)
        else:
            for key, value in data.items():
                if key != "id":
                    setattr(dish, key, value)
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
        return bundle, None
    except Exception as exc:  # compatibility depends on exact sklearn/numpy versions
        return None, f"Không nạp được Random Forest ({type(exc).__name__}); tiếp tục không dùng model."


def get_dishes(db: Session) -> list[Dish]:
    return list(db.scalars(select(Dish).order_by(Dish.id)).all())
