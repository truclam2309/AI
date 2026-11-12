
from pathlib import Path

import joblib
import pandas as pd

THU_MUC = Path(__file__).resolve().parent
FILE_MO_HINH = THU_MUC / "mo_hinh_dinh_duong.pkl"

# Chỉ nạp file mô hình do chính bạn tạo ra.
goi = joblib.load(FILE_MO_HINH)

model = goi["model"]
features = goi["features"]
ten_nhan = goi["ten_nhan"]

# Ví dụ minh họa: thay bằng số liệu thực tế trên 100 g.
mon_an = pd.DataFrame([{
    "Calo": 150,
    "Protein": 8,
    "Carb": 20,
    "Fat": 4,
}])[features]

du_doan = int(model.predict(mon_an)[0])

print("Đặc trưng đầu vào:")
print(mon_an.to_string(index=False))

print("\nNhãn mô hình dự đoán:", ten_nhan[du_doan])