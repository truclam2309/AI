# -*- coding: utf-8 -*-
"""Train the meal-goal Random Forest used by the backend.

Run ``python Train.py`` to inspect the grouped split without writing files, or
``python Train.py --train`` to retrain the model and export audited labels.

Goal labels come from the nutrition-band table in the project report. The
model learns those labels from per-100 g calories, protein, carbohydrate, fat.
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import GroupShuffleSplit


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT_DIR / "du-lieu-train.xlsx"
MODEL_FILE = ROOT_DIR / "backend" / "models" / "mo_hinh_dinh_duong.pkl"
RESULT_FILE = ROOT_DIR / "backend" / "data" / "ket_qua_dan_nhan_AI.xlsx"
SHEET_NAME = "dishes"

# Keep IDs stable: backend/app/recommender.py maps profile goals to 0..3.
LABELS = {0: "Giảm cân", 1: "Tăng cân", 2: "Duy trì", 3: "Tăng cơ"}
FEATURE_COLUMNS = ["Calo", "Protein", "Carb", "Fat"]
SOURCE_COLUMNS = {
    "Calo": "energy_kcal_per_100g",
    "Protein": "protein_g_per_100g",
    "Carb": "carb_g_per_100g",
    "Fat": "fat_g_per_100g",
}
BAND_COLUMNS = {
    "Calo": "nang_luong",
    "Protein": "protein",
    "Carb": "carb",
    "Fat": "chat_beo",
}


def _normalize_band(value: object) -> str:
    """Normalize the workbook's five band labels without losing meaning."""
    if pd.isna(value):
        return ""
    value = re.sub(r"\s+", " ", str(value).strip().casefold())
    return value


def _goal_from_bands(row: pd.Series) -> int:
    """Choose the report goal whose acceptable bands best match this dish."""
    calorie, protein, carb, fat = (_normalize_band(row[BAND_COLUMNS[name]]) for name in FEATURE_COLUMNS)
    # Cao–rất cao accepts either of the workbook's top two levels.
    targets = {
        0: ({"rất thấp", "thấp", "trung bình"}, {"cao", "rất cao"},
            {"rất thấp", "thấp", "trung bình"}, {"rất thấp", "thấp", "trung bình"}),
        1: ({"cao", "rất cao"}, {"trung bình", "cao"},
            {"cao", "rất cao"}, {"trung bình", "cao"}),
        3: ({"trung bình", "cao"}, {"cao", "rất cao"},
            {"trung bình", "cao"}, {"trung bình"}),
        2: ({"trung bình"}, {"trung bình", "cao"},
            {"trung bình"}, {"rất thấp", "thấp", "trung bình"}),
    }
    actual = (calorie, protein, carb, fat)
    scores = {label: sum(value in allowed for value, allowed in zip(actual, ranges)) for label, ranges in targets.items()}
    levels = {"rất thấp": 0, "thấp": 1, "trung bình": 2, "cao": 3, "rất cao": 4}
    def distance(value: str, allowed: set[str]) -> int:
        return min(abs(levels[value] - levels[target]) for target in allowed)
    distances = {label: sum(distance(value, allowed) for value, allowed in zip(actual, ranges)) for label, ranges in targets.items()}
    return min(targets, key=lambda label: (-scores[label], distances[label], label))


def load_data() -> tuple[pd.DataFrame, pd.Series, pd.Series, pd.DataFrame]:
    if not DATA_FILE.is_file():
        raise FileNotFoundError(f"Không tìm thấy dữ liệu: {DATA_FILE}")
    workbook = pd.ExcelFile(DATA_FILE)
    if SHEET_NAME not in workbook.sheet_names:
        raise ValueError(f"Workbook thiếu sheet {SHEET_NAME!r}.")
    data = pd.read_excel(workbook, sheet_name=SHEET_NAME)
    required = {"dish_id", "name", *SOURCE_COLUMNS.values(), *BAND_COLUMNS.values()}
    missing = sorted(required - set(data.columns))
    if missing:
        raise ValueError(f"Sheet {SHEET_NAME!r} thiếu cột: {missing}")
    if data["dish_id"].isna().any() or data["dish_id"].astype(str).str.strip().eq("").any():
        raise ValueError("Có món thiếu dish_id.")
    if data["dish_id"].astype(str).duplicated().any():
        raise ValueError("dish_id bị trùng.")

    X = data.rename(columns={source: feature for feature, source in SOURCE_COLUMNS.items()})[FEATURE_COLUMNS].copy()
    for column in FEATURE_COLUMNS:
        X[column] = pd.to_numeric(X[column], errors="coerce")
    if X.isna().any().any() or (X < 0).any().any():
        raise ValueError("Các cột Calo/Protein/Carb/Fat phải có số không âm và không bị thiếu.")
    for column in BAND_COLUMNS.values():
        normalized = data[column].map(_normalize_band)
        invalid = sorted(set(normalized) - {"rất thấp", "thấp", "trung bình", "cao", "rất cao"})
        if normalized.eq("").any() or invalid:
            raise ValueError(f"Mức dinh dưỡng không hợp lệ ở {column}: {invalid}")

    y = data.apply(_goal_from_bands, axis=1).astype("int64")
    groups = data["name"].map(lambda value: re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value)).casefold()).strip())
    if groups.eq("").any():
        raise ValueError("Có món thiếu tên, không thể chia tập theo nhóm tên món.")
    if y.nunique() < len(LABELS):
        raise ValueError(f"Quy tắc bảng tạo thiếu lớp mục tiêu: {y.map(LABELS).value_counts().to_dict()}")
    return X, y, groups, data


def grouped_split(X: pd.DataFrame, y: pd.Series, groups: pd.Series) -> tuple[list[int], list[int]]:
    splitter = GroupShuffleSplit(n_splits=60, test_size=0.2, random_state=42)
    all_labels = set(y.unique())
    for train_idx, test_idx in splitter.split(X, y, groups):
        if set(y.iloc[train_idx]) == all_labels and set(y.iloc[test_idx]) == all_labels:
            return train_idx.tolist(), test_idx.tolist()
    raise ValueError("Không thể chia train/test theo tên món mà vẫn có đủ bốn lớp ở cả hai tập.")


def train_model(X: pd.DataFrame, y: pd.Series, data: pd.DataFrame, train_idx: list[int], test_idx: list[int]) -> None:
    params = dict(n_estimators=300, random_state=42, n_jobs=1, class_weight="balanced_subsample")
    evaluation_model = RandomForestClassifier(**params)
    evaluation_model.fit(X.iloc[train_idx], y.iloc[train_idx])
    predictions = evaluation_model.predict(X.iloc[test_idx])
    print(f"Accuracy (test, chia theo tên món): {accuracy_score(y.iloc[test_idx], predictions):.2%}")
    print(classification_report(
        y.iloc[test_idx], predictions, labels=list(LABELS),
        target_names=[LABELS[label] for label in LABELS], zero_division=0,
    ))
    print("Chỉ số đo mức khớp với nhãn tạo theo bảng quy tắc trong báo cáo.")

    final_model = RandomForestClassifier(**params).fit(X, y)
    result = data.copy()
    result["Nhan_Muc_Tieu_Theo_Bang"] = y.map(LABELS)
    result["Nhan_Du_Doan_AI"] = pd.Series(final_model.predict(X), index=data.index).map(LABELS)
    RESULT_FILE.parent.mkdir(parents=True, exist_ok=True)
    result.to_excel(RESULT_FILE, index=False, sheet_name="ket_qua")
    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": final_model,
        "features": FEATURE_COLUMNS,
        "ten_nhan": LABELS,
        "source_workbook": DATA_FILE.name,
        "target_strategy": "report_nutrition_band_distance_v2",
    }, MODEL_FILE)
    print(f"Đã lưu model: {MODEL_FILE}")
    print(f"Đã lưu kết quả nhãn: {RESULT_FILE}")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Huấn luyện Random Forest phân nhóm mục tiêu món ăn.")
    parser.add_argument("--train", action="store_true", help="Huấn luyện và ghi model/kết quả.")
    args = parser.parse_args()
    X, y, groups, data = load_data()
    train_idx, test_idx = grouped_split(X, y, groups)
    print(f"Dữ liệu: {DATA_FILE} [{SHEET_NAME}]")
    print(f"Số món: {len(data)}; số tên món: {groups.nunique()}; đặc trưng: {', '.join(FEATURE_COLUMNS)}")
    print("Phân bố nhãn:", y.map(LABELS).value_counts().to_dict())
    print(f"Chia theo tên món: train={len(train_idx)}, test={len(test_idx)}")
    if args.train:
        train_model(X, y, data, train_idx, test_idx)
    else:
        print("Chế độ xem trước; chạy với --train để ghi model và kết quả.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
