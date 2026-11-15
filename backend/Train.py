# -*- coding: utf-8 -*-
"""Train the dish-goal classifier from du-lieu-train.xlsx.

Preview the input, labels, and grouped train/test split (no files are changed):
    python Train.py

Train and write the model/catalog labels used by the backend:
    python Train.py --train

The workbook contains nutrition-band labels, not the four meal goals. This
script derives goal labels from the rubric below, then trains Random Forest on
the numeric per-100 g nutrition features. Metrics measure agreement with this
explicit rule system, not clinical or expert judgments.
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
DATA_DIR = ROOT_DIR / "backend" / "data"
MODEL_DIR = ROOT_DIR / "backend" / "models"
FILE_DU_LIEU = ROOT_DIR / "du-lieu-train.xlsx"
FILE_KET_QUA = DATA_DIR / "ket_qua_dan_nhan_AI.xlsx"
FILE_MO_HINH = MODEL_DIR / "mo_hinh_dinh_duong.pkl"
SHEET_NAME = "dishes"
RULE_SHEET = "quy_tac_gan_nhan"
NUTRIENT_BANDS = {
    "energy_kcal_per_100g": "nang_luong",
    "protein_g_per_100g": "protein",
    "carb_g_per_100g": "carb",
    "fat_g_per_100g": "chat_beo",
}

# Preserve the numeric class IDs expected by backend/app/recommender.py.
TEN_NHAN = {0: "Giảm cân", 1: "Tăng cân", 2: "Duy trì", 3: "Tăng cơ"}
MA_NHAN = {name: code for code, name in TEN_NHAN.items()}
ANH_XA_COT = {
    "Calo": "energy_kcal_per_100g",
    "Protein": "protein_g_per_100g",
    "Carb": "carb_g_per_100g",
    "Fat": "fat_g_per_100g",
}
FEATURES = ["Calo", "Protein", "Carb", "Fat"]

# Compatibility scores operationalize the qualitative rubric in the image.
# Each row is a goal, and each nutrient maps Low/Medium/High bands to [0, 1].
# The highest weighted compatibility becomes the derived training target.
COMPATIBILITY = {
    0: {  # Giảm cân: energy low, protein high, carb/fat moderate
        "nang_luong": {"thấp": 1.0, "trung bình": 0.45, "cao": 0.0},
        "protein": {"thấp": 0.0, "trung bình": 0.5, "cao": 1.0},
        "carb": {"thấp": 0.6, "trung bình": 1.0, "cao": 0.2},
        "chat_beo": {"thấp": 0.55, "trung bình": 1.0, "cao": 0.55},
    },
    1: {  # Tăng cân: energy higher, protein adequate, carbs enough-to-high
        "nang_luong": {"thấp": 0.0, "trung bình": 0.6, "cao": 1.0},
        "protein": {"thấp": 0.0, "trung bình": 1.0, "cao": 0.85},
        "carb": {"thấp": 0.0, "trung bình": 0.7, "cao": 1.0},
        "chat_beo": {"thấp": 0.5, "trung bình": 1.0, "cao": 0.85},
    },
    2: {  # Duy trì: energy/protein/carb/fat near suitable/adequate levels
        "nang_luong": {"thấp": 0.4, "trung bình": 1.0, "cao": 0.4},
        "protein": {"thấp": 0.35, "trung bình": 1.0, "cao": 0.85},
        "carb": {"thấp": 0.6, "trung bình": 1.0, "cao": 0.55},
        "chat_beo": {"thấp": 0.55, "trung bình": 1.0, "cao": 0.55},
    },
    3: {  # Tăng cơ: energy adequate, protein high, carbs adequate, fat moderate
        "nang_luong": {"thấp": 0.0, "trung bình": 1.0, "cao": 0.8},
        "protein": {"thấp": 0.0, "trung bình": 0.5, "cao": 1.0},
        "carb": {"thấp": 0.0, "trung bình": 1.0, "cao": 0.85},
        "chat_beo": {"thấp": 0.55, "trung bình": 1.0, "cao": 0.55},
    },
}
COMPATIBILITY_WEIGHTS = {
    0: {"nang_luong": 0.30, "protein": 0.30, "carb": 0.25, "chat_beo": 0.15},
    1: {"nang_luong": 0.30, "protein": 0.20, "carb": 0.35, "chat_beo": 0.15},
    2: {"nang_luong": 0.25, "protein": 0.25, "carb": 0.25, "chat_beo": 0.25},
    3: {"nang_luong": 0.20, "protein": 0.35, "carb": 0.25, "chat_beo": 0.20},
}


def _name_group(value: object) -> str:
    """Normalize dish names so duplicate names stay in one data split."""
    text = unicodedata.normalize("NFKC", str(value)).casefold()
    return re.sub(r"\s+", " ", text).strip()


def _derive_goal_labels(df: pd.DataFrame) -> pd.Series:
    required = set(NUTRIENT_BANDS.values())
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"Sheet dishes thiếu cột mức dinh dưỡng để áp dụng quy tắc: {missing}")
    bands = pd.DataFrame(index=df.index)
    for column in required:
        bands[column] = df[column].astype("string").str.strip().str.casefold()
    allowed = {"thấp", "trung bình", "cao"}
    invalid = {column: sorted(set(bands[column].dropna()) - allowed) for column in required}
    invalid = {column: values for column, values in invalid.items() if values}
    if bands.isna().any().any() or invalid:
        raise ValueError(f"Thiếu hoặc sai mức Thấp/Trung bình/Cao trong workbook: {invalid}")

    scores = {}
    for class_id, dimensions in COMPATIBILITY.items():
        weighted = pd.Series(0.0, index=df.index)
        for band_column in NUTRIENT_BANDS.values():
            weighted += bands[band_column].map(dimensions[band_column]) * COMPATIBILITY_WEIGHTS[class_id][band_column]
        scores[class_id] = weighted
    score_frame = pd.DataFrame(scores)
    # Stable tie break follows the class order above.
    return score_frame.idxmax(axis=1).astype("int64")


def load_training_data() -> tuple[pd.DataFrame, pd.Series, pd.Series, pd.DataFrame]:
    if not FILE_DU_LIEU.is_file():
        raise FileNotFoundError(f"Không tìm thấy workbook train: {FILE_DU_LIEU}")

    workbook = pd.ExcelFile(FILE_DU_LIEU)
    if SHEET_NAME not in workbook.sheet_names:
        raise ValueError(f"Workbook cần có sheet {SHEET_NAME!r}; hiện có: {workbook.sheet_names}")
    df = pd.read_excel(workbook, sheet_name=SHEET_NAME)

    required = {"dish_id", "name", *ANH_XA_COT.values(), *NUTRIENT_BANDS.values()}
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"Sheet {SHEET_NAME!r} thiếu cột bắt buộc: {missing}")
    if df["dish_id"].isna().any() or df["dish_id"].astype(str).str.strip().eq("").any():
        raise ValueError("Có món thiếu dish_id; cần mã món ổn định để xuất nhãn.")
    if df["dish_id"].astype(str).duplicated().any():
        raise ValueError("dish_id bị trùng; cần xử lý mã món trước khi train.")

    X = df.rename(columns={source: feature for feature, source in ANH_XA_COT.items()})[FEATURES].copy()
    for column in FEATURES:
        X[column] = pd.to_numeric(X[column], errors="coerce")
    if X.isna().any().any():
        missing_counts = X.isna().sum()
        raise ValueError(f"Có giá trị dinh dưỡng thiếu/không phải số: {missing_counts[missing_counts > 0].to_dict()}")
    if (X < 0).any().any():
        raise ValueError("Dữ liệu dinh dưỡng có giá trị âm; cần kiểm tra workbook trước khi train.")

    y = _derive_goal_labels(df)
    groups = df["name"].map(_name_group)
    if groups.eq("").any():
        raise ValueError("Có món thiếu tên; không thể chia tập chống trùng theo tên món.")
    return X, y, groups, df


def make_grouped_split(X: pd.DataFrame, y: pd.Series, groups: pd.Series) -> tuple[list[int], list[int]]:
    splitter = GroupShuffleSplit(n_splits=30, test_size=0.2, random_state=42)
    all_labels = set(y.unique())
    best_split: tuple[list[int], list[int]] | None = None
    best_coverage = -1
    for train_idx, test_idx in splitter.split(X, y, groups):
        train_labels = set(y.iloc[train_idx].unique())
        test_labels = set(y.iloc[test_idx].unique())
        coverage = len(train_labels & all_labels) + len(test_labels & all_labels)
        if coverage > best_coverage:
            best_split = (train_idx.tolist(), test_idx.tolist())
            best_coverage = coverage
        if train_labels == all_labels and test_labels == all_labels:
            return train_idx.tolist(), test_idx.tolist()

    assert best_split is not None
    train_idx, test_idx = best_split
    if set(y.iloc[train_idx].unique()) != all_labels or set(y.iloc[test_idx].unique()) != all_labels:
        raise ValueError("Không thể giữ đủ các lớp trong train và test khi gom các món trùng tên.")
    return train_idx, test_idx


def preview(*, preview_only: bool = True) -> tuple[pd.DataFrame, pd.Series, pd.Series, pd.DataFrame, list[int], list[int]]:
    X, y, groups, df = load_training_data()
    train_idx, test_idx = make_grouped_split(X, y, groups)
    print(f"Nguồn: {FILE_DU_LIEU} [{SHEET_NAME}]")
    print(f"Số món: {len(df)} | mã món duy nhất: {df['dish_id'].nunique()} | tên món duy nhất: {groups.nunique()}")
    print(f"Nhãn đích: suy ra từ {RULE_SHEET}, theo mức năng lượng/protein/carb/chất béo và rubric trong Train.py")
    print("Quy tắc rubric: giảm cân ưu tiên năng lượng thấp + protein cao + carb/chất béo vừa; tăng cân ưu tiên năng lượng/carb cao; tăng cơ ưu tiên protein cao và năng lượng/carb đủ; duy trì ưu tiên các mức phù hợp/đủ.")
    print("Đặc trưng: " + ", ".join(FEATURES) + " (đơn vị trên 100 g)")
    print("Phân bố nhãn toàn bộ:", {TEN_NHAN[int(k)]: int(v) for k, v in y.value_counts().sort_index().items()})
    print(f"Chia theo tên món: train={len(train_idx)}, test={len(test_idx)}; không trùng tên giữa hai tập.")
    print("Train:", {TEN_NHAN[int(k)]: int(v) for k, v in y.iloc[train_idx].value_counts().sort_index().items()})
    print("Test:", {TEN_NHAN[int(k)]: int(v) for k, v in y.iloc[test_idx].value_counts().sort_index().items()})
    if preview_only:
        print("Chế độ xem trước: chưa ghi model hoặc file nhãn. Dùng --train để huấn luyện và ghi kết quả.")
    return X, y, groups, df, train_idx, test_idx


def train(X: pd.DataFrame, y: pd.Series, df: pd.DataFrame, train_idx: list[int], test_idx: list[int]) -> None:
    model = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        n_jobs=1,
        class_weight="balanced_subsample",
    )
    model.fit(X.iloc[train_idx], y.iloc[train_idx])
    predictions = model.predict(X.iloc[test_idx])
    print(f"\nAccuracy trên test theo tên món: {accuracy_score(y.iloc[test_idx], predictions):.2%}")
    print(classification_report(
        y.iloc[test_idx], predictions,
        labels=sorted(TEN_NHAN),
        target_names=[TEN_NHAN[key] for key in sorted(TEN_NHAN)],
        zero_division=0,
    ))
    print("Chỉ số này đo mức khớp với nhãn quy tắc trong workbook, không chứng minh hiệu quả dinh dưỡng.")

    # Refit on all labeled dishes after grouped evaluation, then export the
    # original workbook labels and model predictions separately for auditing.
    final_model = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        n_jobs=1,
        class_weight="balanced_subsample",
    )
    final_model.fit(X, y)
    results = df.copy()
    results["Nhan_Du_Lieu"] = y.map(TEN_NHAN)
    results["Diem_theo_quy_tac"] = y.map(TEN_NHAN)
    results["Nhan_Du_Doan_AI"] = pd.Series(final_model.predict(X), index=df.index).map(TEN_NHAN)
    results.to_excel(FILE_KET_QUA, index=False, sheet_name="ket_qua")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": final_model,
        "features": FEATURES,
        "ten_nhan": TEN_NHAN,
        "source_workbook": FILE_DU_LIEU.name,
        "target_strategy": "weighted_nutrition_rubric_v1",
    }, FILE_MO_HINH)
    print(f"Đã lưu nhãn và dự đoán: {FILE_KET_QUA}")
    print(f"Đã lưu model tương thích backend: {FILE_MO_HINH}")


def main() -> None:
    # Avoid Windows' legacy console code page crashing on Vietnamese labels.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description="Train/preview mô hình phân nhóm mục tiêu món ăn.")
    parser.add_argument("--train", action="store_true", help="Huấn luyện và ghi model cùng file nhãn đầu ra.")
    args = parser.parse_args()
    X, y, _, df, train_idx, test_idx = preview(preview_only=not args.train)
    if args.train:
        train(X, y, df, train_idx, test_idx)


if __name__ == "__main__":
    main()
