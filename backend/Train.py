# -*- coding: utf-8 -*-
"""Huấn luyện Random Forest và xuất bảng món ăn đã dự đoán nhãn.

Cài thư viện (chạy một lần):
    pip install pandas scikit-learn openpyxl joblib

Chạy từ thư mục chứa file:
    python Train.py

Lưu ý: bo-du-lieu-mon-an.xlsx không có nhãn Muc_Tieu hay các cột Calo,
Protein, Carb, Fat theo tên yêu cầu. Script ánh xạ các cột tương
đương trong sheet dishes và tạo nhãn ban đầu bằng quy tắc dinh dưỡng bên
dưới để có dữ liệu huấn luyện. Đây là nhãn quy tắc, không phải nhãn chuyên gia.
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split


# Tên file đầu vào/đầu ra (đặt cạnh Train.py).
THU_MUC = Path(__file__).resolve().parent
FILE_DU_LIEU = THU_MUC / "bo-du-lieu-mon-an.xlsx"
FILE_KET_QUA = THU_MUC / "ket_qua_dan_nhan_AI.xlsx"
FILE_MO_HINH = THU_MUC / "mo_hinh_dinh_duong.pkl"

# Các giá trị số được dùng thống nhất trong cột Muc_Tieu.
TEN_NHAN = {0: "Giảm cân", 1: "Tăng cân", 2: "Duy trì", 3: "Tăng cơ"}

# Sheet dishes lưu dinh dưỡng trên 100 g theo các tên cột sau.
ANH_XA_COT = {
    "Calo": "energy_kcal_per_100g",
    "Protein": "protein_g_per_100g",
    "Carb": "carb_g_per_100g",
    "Fat": "fat_g_per_100g",
}
FEATURES = ["Calo", "Protein", "Carb", "Fat"]


def tao_nhan_quy_tac(df: pd.DataFrame) -> pd.Series:
    """Tạo nhãn tạm từ kcal và protein trên 100 g; có thể chỉnh ngưỡng này.

    Quy tắc đơn giản: món nhiều năng lượng được gắn Tăng cân; món ít năng
    lượng và có protein tương đối cao được gắn Tăng cơ; món ít năng lượng
    còn lại gắn Giảm cân; các món khác gắn Duy trì.
    """
    kcal = df["Calo"]
    protein = df["Protein"]
    nhan = pd.Series(2, index=df.index, dtype="int64")  # mặc định: Duy trì
    nhan.loc[kcal > 225] = 1
    nhan.loc[(kcal < 120) & (protein >= 10)] = 3
    nhan.loc[(kcal < 120) & (protein < 10)] = 0
    return nhan


def main() -> None:
    # Đọc sheet món ăn từ workbook nguồn.
    if not FILE_DU_LIEU.exists():
        raise FileNotFoundError(f"Không tìm thấy file dữ liệu: {FILE_DU_LIEU}")
    df = pd.read_excel(FILE_DU_LIEU, sheet_name="dishes")
    print(f"Đã đọc {len(df)} món ăn từ {FILE_DU_LIEU.name}.")

    # Ánh xạ tên cột gốc sang các tên tính năng theo yêu cầu.
    thieu = [cot for cot in ANH_XA_COT.values() if cot not in df.columns]
    if thieu:
        raise ValueError(f"Sheet dishes thiếu các cột dinh dưỡng: {thieu}")
    X = df.rename(columns={goc: moi for moi, goc in ANH_XA_COT.items()})
    X = X.reindex(columns=FEATURES)
    # Chuyển dữ liệu về dạng số; giá trị thiếu hoặc không hợp lệ được điền 0.
    for cot in FEATURES:
        X[cot] = pd.to_numeric(X[cot], errors="coerce").fillna(0)

    # Workbook không có nhãn đích, nên tạo nhãn tạm bằng quy tắc phía trên.
    # Nếu sau này dữ liệu có cột Muc_Tieu thật, script sẽ ưu tiên cột đó.
    if "Muc_Tieu" in df.columns:
        y = pd.to_numeric(df["Muc_Tieu"], errors="coerce")
        hop_le = y.isin(TEN_NHAN)
        if not hop_le.all():
            raise ValueError("Cột Muc_Tieu phải chỉ chứa các giá trị 0, 1, 2, 3.")
        y = y.astype("int64")
        print("Dùng nhãn Muc_Tieu có sẵn trong file.")
    else:
        y = tao_nhan_quy_tac(X)
        print("CẢNH BÁO: workbook không có Muc_Tieu; dùng nhãn quy tắc để huấn luyện.")
        print("Accuracy phản ánh mức khớp với nhãn quy tắc, không phải đánh giá chuyên gia.")

    phan_bo = y.value_counts().sort_index()
    print("Phân bố nhãn:", {TEN_NHAN[int(k)]: int(v) for k, v in phan_bo.items()})
    if len(phan_bo) < 2:
        raise ValueError("Cần ít nhất hai loại nhãn khác nhau để huấn luyện mô hình.")

    # Giữ phân bố nhãn gần giống nhau giữa train và test khi khả thi.
    stratify = y if phan_bo.min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=stratify
    )

    # Huấn luyện Random Forest.
    model = RandomForestClassifier(n_estimators=300, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)

    # Báo cáo độ chính xác trên tập kiểm tra.
    y_pred = model.predict(X_test)
    print(f"\nAccuracy trên tập kiểm tra: {accuracy_score(y_test, y_pred):.2%}")
    nhan_co_mat = sorted(set(y_test) | set(y_pred))
    print(classification_report(
        y_test,
        y_pred,
        labels=nhan_co_mat,
        target_names=[TEN_NHAN[int(k)] for k in nhan_co_mat],
        zero_division=0,
    ))

    # Dùng mô hình vừa huấn luyện dự đoán nhãn cho toàn bộ các món ăn.
    ket_qua = df.copy()
    ket_qua["Nhan_Du_Doan_AI"] = pd.Series(model.predict(X), index=df.index).map(TEN_NHAN)
    # Đưa các cột dinh dưỡng về tên thân thiện, giữ nguyên những cột khác.
    ket_qua = ket_qua.rename(columns={goc: moi for moi, goc in ANH_XA_COT.items()})
    ket_qua.to_excel(FILE_KET_QUA, index=False, sheet_name="ket_qua")
    print(f"Đã lưu bảng kết quả: {FILE_KET_QUA.name}")

    # Lưu mô hình cùng thông tin thứ tự tính năng để tái sử dụng.
    joblib.dump({"model": model, "features": FEATURES, "ten_nhan": TEN_NHAN}, FILE_MO_HINH)
    print(f"Đã lưu mô hình: {FILE_MO_HINH.name}")


if __name__ == "__main__":
    main()
