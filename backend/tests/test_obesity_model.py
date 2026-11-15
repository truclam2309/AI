import pickle
from pathlib import Path

import pytest
from sklearn.pipeline import Pipeline

import train_obesity_model as obesity


BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = BACKEND_DIR / "data" / "bộ dữ liệu về thể trạng.csv"


def sample_user_data():
    frame, _ = obesity._read_csv(DATA_PATH)
    return frame.iloc[0][obesity.FEATURE_COLUMNS].to_dict()


def test_dataset_schema_and_values_are_inspected():
    frame, encoding = obesity._read_csv(DATA_PATH)
    summary = obesity._inspect_dataset(frame)
    assert encoding in {"utf-8-sig", "utf-8", "cp1258"}
    assert frame.shape == (2111, 14)
    assert len(obesity.FEATURE_COLUMNS) == 13
    assert summary["duplicate_rows_exact"] == 24
    assert not summary["missing_values_by_column"]


def test_missing_dataset_path_reports_error():
    with pytest.raises(FileNotFoundError):
        obesity._read_csv(DATA_PATH.parent / "does-not-exist.csv")


def test_missing_required_dataset_column_is_rejected():
    frame, _ = obesity._read_csv(DATA_PATH)
    with pytest.raises(ValueError, match="Sai schema"):
        obesity._inspect_dataset(frame.drop(columns=[obesity.FEATURE_COLUMNS[0]]))


def test_missing_prediction_attribute_is_reported():
    model = obesity.load_model()
    values = sample_user_data()
    values.pop(obesity.FEATURE_COLUMNS[0])
    with pytest.raises(ValueError, match="Thiếu trường bắt buộc"):
        obesity._validate_user_data(values, model)


def test_wrong_prediction_type_is_rejected():
    model = obesity.load_model()
    values = sample_user_data()
    values["Tuổi"] = "hai mươi"
    with pytest.raises(TypeError, match="phải là số"):
        obesity._validate_user_data(values, model)


def test_invalid_prediction_value_is_rejected():
    model = obesity.load_model()
    values = sample_user_data()
    values["Tuổi"] = 4
    with pytest.raises(ValueError, match="khoảng"):
        obesity._validate_user_data(values, model)


def test_saved_model_loads_as_pipeline():
    model = obesity.load_model()
    assert isinstance(model, Pipeline)
    assert list(model.classes_) == sorted(model.classes_)


def test_prediction_returns_expected_fields_and_real_class():
    prediction = obesity.predict_body_status(sample_user_data())
    assert prediction["predicted_status"] in obesity.GOAL_SUGGESTIONS
    assert 0 <= prediction["confidence"] <= 1
    assert prediction["bmi"] > 0
    assert prediction["model"] == "Random Forest Classifier"


def test_prediction_probabilities_cover_all_classes_and_sum_to_one():
    model = obesity.load_model()
    prediction = obesity.predict_body_status(sample_user_data())
    assert set(prediction["probabilities"]) == set(model.classes_)
    assert sum(prediction["probabilities"].values()) == pytest.approx(1.0)


def test_pickle_round_trip_preserves_predictions():
    model = obesity.load_model()
    values = sample_user_data()
    row = obesity._validate_user_data(values, model)
    reloaded_path = BACKEND_DIR / "models" / "obesity_status_model.pkl"
    with reloaded_path.open("rb") as file:
        reloaded = pickle.load(file)
    assert model.predict(row).tolist() == reloaded.predict(row).tolist()
    assert model.predict_proba(row).tolist() == reloaded.predict_proba(row).tolist()
