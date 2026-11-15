"""Train and use NutriAI's Vietnamese body-status classifier.

Run from the backend directory:
    python train_obesity_model.py --data "..\\bộ dữ liệu về thể trạng.csv"

FastAPI can import ``predict_body_status`` after the model has been trained:
    from train_obesity_model import predict_body_status
"""
from __future__ import annotations

import argparse
from functools import lru_cache
import json
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path
from numbers import Real
from typing import Any

import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA = SCRIPT_DIR / "data" / "bộ dữ liệu về thể trạng.csv"
DEFAULT_MODEL = SCRIPT_DIR / "models" / "obesity_status_model.pkl"
DEFAULT_METRICS = SCRIPT_DIR / "training_metrics.json"
DEFAULT_MATRIX = SCRIPT_DIR / "confusion_matrix.png"
TARGET_COLUMN = "Mức cân nặng"

# Exact feature columns present in the supplied CSV: 14 columns total means
# 13 input attributes plus the target. Do not synthesize the two absent items
# implied by the numbering in the request.
FEATURE_COLUMNS = [
    "Giới tính",
    "Tuổi",
    "Chiều cao (m)",
    "Cân nặng (kg)",
    "Tiền sử gia đình thừa cân",
    "Thường ăn đồ nhiều calo",
    "Tần suất ăn rau (1-3)",
    "Số bữa chính mỗi ngày",
    "Ăn vặt giữa các bữa",
    "Hút thuốc",
    "Lượng nước uống mỗi ngày (1-3)",
    "Tần suất vận động (0-3)",
    "Uống rượu bia",
]
NUMERIC_COLUMNS = [
    "Tuổi",
    "Chiều cao (m)",
    "Cân nặng (kg)",
    "Tần suất ăn rau (1-3)",
    "Số bữa chính mỗi ngày",
    "Lượng nước uống mỗi ngày (1-3)",
    "Tần suất vận động (0-3)",
]
CATEGORICAL_COLUMNS = [column for column in FEATURE_COLUMNS if column not in NUMERIC_COLUMNS]
VALID_RANGES = {
    "Tuổi": (10.0, 120.0),
    "Chiều cao (m)": (1.0, 2.5),
    "Cân nặng (kg)": (20.0, 300.0),
    "Tần suất ăn rau (1-3)": (1.0, 3.0),
    "Số bữa chính mỗi ngày": (1.0, 6.0),
    "Lượng nước uống mỗi ngày (1-3)": (1.0, 3.0),
    "Tần suất vận động (0-3)": (0.0, 3.0),
}
GOAL_SUGGESTIONS = {
    "Thiếu cân": "Cân nhắc tăng cân lành mạnh",
    "Bình thường": "Duy trì",
    "Thừa cân độ I": "Cân nhắc giảm cân hoặc duy trì",
    "Thừa cân độ II": "Cân nhắc giảm cân từ từ",
    "Béo phì độ I": "Đánh giá nhu cầu điều chỉnh cân nặng",
    "Béo phì độ II": "Tham khảo chuyên gia dinh dưỡng",
    "Béo phì độ III": "Cần đánh giá chuyên môn trước khi điều chỉnh chế độ ăn",
}


def _resolve_data_path(value: str | Path) -> Path:
    candidate = Path(value).expanduser()
    if candidate.is_absolute():
        return candidate
    options = [Path.cwd() / candidate, SCRIPT_DIR / candidate, SCRIPT_DIR.parent / candidate]
    for option in options:
        if option.is_file():
            return option.resolve()
    return options[0].resolve()


def _read_csv(path: Path) -> tuple[pd.DataFrame, str]:
    if not path.is_file():
        raise FileNotFoundError(f"Không tìm thấy dataset: {path}")
    failures: list[str] = []
    for encoding in ("utf-8-sig", "utf-8", "cp1258"):
        try:
            return pd.read_csv(path, encoding=encoding), encoding
        except UnicodeDecodeError as exc:
            failures.append(f"{encoding}: {exc}")
    raise UnicodeError("Không đọc được CSV bằng encoding tiếng Việt thông dụng: " + "; ".join(failures))


def _inspect_dataset(data: pd.DataFrame) -> dict[str, Any]:
    expected = FEATURE_COLUMNS + [TARGET_COLUMN]
    missing_columns = [column for column in expected if column not in data.columns]
    unexpected_columns = [str(column) for column in data.columns if column not in expected]
    if missing_columns or unexpected_columns:
        raise ValueError(
            f"Sai schema CSV. Thiếu cột: {missing_columns}; cột ngoài schema: {unexpected_columns}. "
            f"Cột thực tế: {data.columns.tolist()}"
        )
    if len(data.columns) != len(expected):
        raise ValueError(f"Cần đúng {len(expected)} cột (13 thuộc tính + nhãn), nhận {len(data.columns)}.")
    data = data[expected].copy()

    # Parse numeric features without changing the source file. Invalid values
    # become missing and are reported; the training Pipeline imputes features.
    for column in NUMERIC_COLUMNS:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    missing_by_column = {str(key): int(value) for key, value in data.isna().sum().items() if value}
    if data[TARGET_COLUMN].isna().any() or data[TARGET_COLUMN].astype(str).str.strip().eq("").any():
        raise ValueError("Cột nhãn có giá trị thiếu/rỗng; không thể huấn luyện có giám sát.")

    range_violations: dict[str, int] = {}
    for column, (minimum, maximum) in VALID_RANGES.items():
        count = int((data[column].notna() & ~data[column].between(minimum, maximum)).sum())
        if count:
            range_violations[column] = count

    iqr_outliers: dict[str, int] = {}
    for column in NUMERIC_COLUMNS:
        values = data[column].dropna()
        if values.empty:
            iqr_outliers[column] = 0
            continue
        q1, q3 = values.quantile([0.25, 0.75])
        iqr = q3 - q1
        iqr_outliers[column] = int(((values < q1 - 1.5 * iqr) | (values > q3 + 1.5 * iqr)).sum())

    return {
        "rows_before_preprocessing": int(len(data)),
        "columns": [str(column) for column in data.columns],
        "feature_columns": FEATURE_COLUMNS,
        "numeric_columns": NUMERIC_COLUMNS,
        "categorical_columns": CATEGORICAL_COLUMNS,
        "dtypes": {str(column): str(dtype) for column, dtype in data.dtypes.items()},
        "missing_values_by_column": missing_by_column,
        "duplicate_rows_exact": int(data.duplicated().sum()),
        "range_violations_by_column": range_violations,
        "iqr_outlier_counts_by_numeric_column": iqr_outliers,
        "label_counts_before_deduplication": {
            str(key): int(value) for key, value in data[TARGET_COLUMN].value_counts().items()
        },
    }


def _build_pipeline() -> Pipeline:
    numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ])
    preprocessing = ColumnTransformer([
        ("numeric", numeric_pipeline, NUMERIC_COLUMNS),
        ("categorical", categorical_pipeline, CATEGORICAL_COLUMNS),
    ])
    classifier = RandomForestClassifier(
        n_estimators=200,
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )
    return Pipeline([("preprocessor", preprocessing), ("classifier", classifier)])


def _save_confusion_matrix(matrix: np.ndarray, labels: list[str], destination: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    destination.parent.mkdir(parents=True, exist_ok=True)
    width = max(9, len(labels) * 1.35)
    fig, axis = plt.subplots(figsize=(width, width * 0.82), constrained_layout=True)
    image = axis.imshow(matrix, interpolation="nearest", cmap="Greens")
    fig.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    axis.set(
        xticks=np.arange(len(labels)), yticks=np.arange(len(labels)),
        xticklabels=labels, yticklabels=labels,
        xlabel="Nhãn dự đoán", ylabel="Nhãn thực tế",
        title="Confusion Matrix — Random Forest (tập test)",
    )
    plt.setp(axis.get_xticklabels(), rotation=35, ha="right", rotation_mode="anchor")
    threshold = matrix.max() / 2 if matrix.size else 0
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            axis.text(column, row, str(matrix[row, column]), ha="center", va="center",
                      color="white" if matrix[row, column] > threshold else "black")
    fig.savefig(destination, dpi=160)
    plt.close(fig)


def train_model(
    data_path: str | Path = DEFAULT_DATA,
    model_path: str | Path = DEFAULT_MODEL,
    metrics_path: str | Path = DEFAULT_METRICS,
    confusion_matrix_path: str | Path = DEFAULT_MATRIX,
) -> dict[str, Any]:
    dataset_path = _resolve_data_path(data_path)
    raw, encoding = _read_csv(dataset_path)
    inspection = _inspect_dataset(raw)
    data = raw[FEATURE_COLUMNS + [TARGET_COLUMN]].copy()
    for column in NUMERIC_COLUMNS:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    # Exact repeated records are removed from training to prevent duplicate
    # observations from leaking across train/test. No other valid rows are dropped.
    data = data.drop_duplicates().reset_index(drop=True)
    inspection["rows_after_duplicate_removal"] = int(len(data))
    inspection["rows_removed_as_exact_duplicates"] = inspection["rows_before_preprocessing"] - len(data)
    inspection["label_counts_after_deduplication"] = {
        str(key): int(value) for key, value in data[TARGET_COLUMN].value_counts().items()
    }
    if inspection["range_violations_by_column"]:
        raise ValueError(f"Giá trị ngoài miền hợp lý cần xem xét, không tự loại dữ liệu: {inspection['range_violations_by_column']}")

    X = data[FEATURE_COLUMNS]
    y = data[TARGET_COLUMN].astype(str).str.strip()
    labels = sorted(y.unique().tolist())
    if len(labels) != 7:
        raise ValueError(f"Dataset cần đủ 7 nhãn thực tế, hiện có {len(labels)}: {labels}")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y,
    )
    pipeline = _build_pipeline()
    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)
    probabilities = pipeline.predict_proba(X_test)
    matrix = confusion_matrix(y_test, y_pred, labels=labels)
    report = classification_report(y_test, y_pred, labels=labels, output_dict=True, zero_division=0)

    model_destination = Path(model_path).resolve()
    metrics_destination = Path(metrics_path).resolve()
    matrix_destination = Path(confusion_matrix_path).resolve()
    model_destination.parent.mkdir(parents=True, exist_ok=True)
    # Keep the fitted Pipeline and inference validation metadata in one pickle.
    pipeline.feature_columns_ = list(FEATURE_COLUMNS)
    pipeline.numeric_columns_ = list(NUMERIC_COLUMNS)
    pipeline.categorical_columns_ = list(CATEGORICAL_COLUMNS)
    pipeline.feature_ranges_ = dict(VALID_RANGES)
    pipeline.feature_categories_ = {
        column: sorted(data[column].dropna().astype(str).unique().tolist())
        for column in CATEGORICAL_COLUMNS
    }
    pipeline.target_column_ = TARGET_COLUMN
    with model_destination.open("wb") as model_file:
        pickle.dump(pipeline, model_file, protocol=pickle.HIGHEST_PROTOCOL)

    with model_destination.open("rb") as model_file:
        reloaded = pickle.load(model_file)
    sample = X_test.iloc[: min(10, len(X_test))]
    predictions_before = pipeline.predict(sample)
    predictions_after = reloaded.predict(sample)
    probabilities_before = pipeline.predict_proba(sample)
    probabilities_after = reloaded.predict_proba(sample)
    reload_check = {
        "sample_count": int(len(sample)),
        "predictions_identical": bool(np.array_equal(predictions_before, predictions_after)),
        "probabilities_identical": bool(np.allclose(probabilities_before, probabilities_after)),
        "probability_sums_close_to_one": bool(np.allclose(probabilities_after.sum(axis=1), 1.0)),
    }
    if not all(reload_check[key] for key in (
        "predictions_identical", "probabilities_identical", "probability_sums_close_to_one"
    )):
        raise RuntimeError(f"Kiểm tra load lại mô hình thất bại: {reload_check}")

    _save_confusion_matrix(matrix, labels, matrix_destination)
    weighted = {
        "precision": float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
        "f1_score": float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
    }
    macro = {
        "precision": float(precision_score(y_test, y_pred, average="macro", zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, average="macro", zero_division=0)),
        "f1_score": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
    }
    metrics = {
        "dataset": str(dataset_path),
        "encoding": encoding,
        "schema_note": "CSV thực tế có 14 cột: 13 input và 1 target; dùng đúng các cột có trong file.",
        "inspection": inspection,
        "split": {
            "train_rows": int(len(X_train)), "test_rows": int(len(X_test)),
            "test_fraction": 0.20, "random_state": 42, "stratified_by": TARGET_COLUMN,
        },
        "model": {
            "name": "Random Forest Classifier",
            "parameters": {"n_estimators": 200, "random_state": 42, "class_weight": "balanced"},
            "scikit_learn_version": sklearn.__version__,
        },
        "labels": labels,
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "weighted_average": weighted,
        "macro_average": macro,
        "classification_report": report,
        "confusion_matrix_labels_order": labels,
        "confusion_matrix": matrix.tolist(),
        "test_mean_probability_sum": float(probabilities.sum(axis=1).mean()),
        "reload_check": reload_check,
        "artifacts": {
            "model": str(model_destination),
            "metrics": str(metrics_destination),
            "confusion_matrix": str(matrix_destination),
        },
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    metrics_destination.parent.mkdir(parents=True, exist_ok=True)
    metrics_destination.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    return metrics


@lru_cache(maxsize=4)
def load_model(model_path: str | Path | None = None) -> Pipeline:
    """Load a trained Pipeline; never triggers training."""
    destination = Path(model_path).resolve() if model_path else DEFAULT_MODEL
    if not destination.is_file():
        raise FileNotFoundError(
            f"Chưa có mô hình tại {destination}. Hãy chạy train_obesity_model.py trước."
        )
    with destination.open("rb") as model_file:
        model = pickle.load(model_file)
    if not isinstance(model, Pipeline):
        raise TypeError("File mô hình không chứa sklearn Pipeline hợp lệ.")
    # Inference handles one profile per request. Avoid creating a worker pool
    # for each call, especially on small Render instances.
    parallel_params = {
        name: 1
        for name, value in model.get_params(deep=True).items()
        if name.endswith("n_jobs") and value == -1
    }
    if parallel_params:
        model.set_params(**parallel_params)
    return model


def _validate_user_data(user_data: dict[str, Any], model: Pipeline) -> pd.DataFrame:
    if not isinstance(user_data, dict):
        raise TypeError("user_data phải là dictionary.")
    missing = [column for column in FEATURE_COLUMNS if column not in user_data or user_data[column] is None or user_data[column] == ""]
    if missing:
        raise ValueError("Thiếu trường bắt buộc: " + ", ".join(missing))
    extra = [key for key in user_data if key not in FEATURE_COLUMNS]
    if extra:
        raise ValueError("Trường không có trong dataset: " + ", ".join(map(str, extra)))

    normalized: dict[str, Any] = {}
    for column in NUMERIC_COLUMNS:
        value = user_data[column]
        if isinstance(value, bool) or not isinstance(value, Real):
            raise TypeError(f"{column} phải là số (int/float), nhận {type(value).__name__}.")
        number = float(value)
        if not np.isfinite(number):
            raise ValueError(f"{column} phải là số hữu hạn.")
        minimum, maximum = model.feature_ranges_[column]
        if not minimum <= number <= maximum:
            raise ValueError(f"{column} phải nằm trong khoảng {minimum}–{maximum}.")
        normalized[column] = number

    for column in CATEGORICAL_COLUMNS:
        value = user_data[column]
        if not isinstance(value, str):
            raise TypeError(f"{column} phải là chuỗi.")
        value = value.strip()
        if value not in model.feature_categories_[column]:
            allowed = ", ".join(model.feature_categories_[column])
            raise ValueError(f"{column} không hợp lệ: {value!r}. Giá trị trong dataset: {allowed}.")
        normalized[column] = value
    return pd.DataFrame([normalized], columns=FEATURE_COLUMNS)


def predict_body_status(user_data: dict[str, Any]) -> dict[str, Any]:
    """Validate one complete dataset-shaped record and return status probabilities + BMI.

    The model's label is a statistical estimate, not a medical diagnosis. The
    suggested goal is advisory only; Nutrition Engine calculations remain separate.
    """
    model = load_model()
    row = _validate_user_data(user_data, model)
    predicted = str(model.predict(row)[0])
    class_probabilities = model.predict_proba(row)[0]
    probabilities = {
        str(label): float(probability)
        for label, probability in zip(model.classes_, class_probabilities)
    }
    height_m = float(user_data["Chiều cao (m)"])
    weight_kg = float(user_data["Cân nặng (kg)"])
    return {
        "predicted_status": predicted,
        "confidence": probabilities[predicted],
        "probabilities": probabilities,
        "bmi": round(weight_kg / (height_m ** 2), 2),
        "suggested_goal": GOAL_SUGGESTIONS.get(predicted, "Tham khảo chuyên gia dinh dưỡng"),
        "model": "Random Forest Classifier",
        "disclaimer": "Kết quả phân loại chỉ để tham khảo, không phải chẩn đoán y khoa.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Huấn luyện mô hình phân loại thể trạng NutriAI.")
    parser.add_argument("--data", default=str(DEFAULT_DATA), help="Đường dẫn CSV tiếng Việt.")
    parser.add_argument("--model", default=str(DEFAULT_MODEL), help="Đường dẫn lưu Pipeline pickle.")
    parser.add_argument("--metrics", default=str(DEFAULT_METRICS), help="Đường dẫn lưu báo cáo JSON.")
    parser.add_argument("--confusion-matrix", default=str(DEFAULT_MATRIX), help="Đường dẫn lưu PNG confusion matrix.")
    args = parser.parse_args(argv)
    try:
        metrics = train_model(args.data, args.model, args.metrics, args.confusion_matrix)
    except Exception as exc:
        print(f"Huấn luyện thất bại: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "dataset": metrics["dataset"],
        "rows_before": metrics["inspection"]["rows_before_preprocessing"],
        "duplicates_removed": metrics["inspection"]["rows_removed_as_exact_duplicates"],
        "rows_after": metrics["inspection"]["rows_after_duplicate_removal"],
        "train_rows": metrics["split"]["train_rows"],
        "test_rows": metrics["split"]["test_rows"],
        "accuracy": metrics["accuracy"],
        "weighted_average": metrics["weighted_average"],
        "macro_average": metrics["macro_average"],
        "classification_report": metrics["classification_report"],
        "artifacts": metrics["artifacts"],
        "reload_check": metrics["reload_check"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
