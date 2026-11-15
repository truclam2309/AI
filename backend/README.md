## Chạy local hoặc deploy Render

Local: chạy `uvicorn app.main:app --reload` (chỉ dùng reload khi phát triển). Tại thư mục gốc repo có `render.yaml` để cấu hình Render. Cung cấp `NUTRIAI_SECRET_KEY`, URL PostgreSQL cho `NUTRIAI_DATABASE_URL`, và origin Vercel cho `NUTRIAI_CORS_ORIGINS`; URL `postgresql://` và `postgres://` được tự đổi sang driver psycopg 3. Không dùng SQLite trên Render vì filesystem web service là tạm thời. Sau deploy kiểm tra `/health` và `/docs`.

## Chạy trên Windows PowerShell

```powershell
cd "D:\Nhóm 3\backend"
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
# NUTRIAI_SECRET_KEY có thể được đặt trong backend\.env hoặc biến môi trường.
# Dataset mặc định: backend/data/bo-du-lieu-mon-an.xlsx và backend/data/bộ dữ liệu về thể trạng.csv.
# Tùy chọn: timezone mặc định Asia/Ho_Chi_Minh; giới hạn calo chỉ phát cảnh báo, không ép số liệu.
$env:NUTRIAI_TIMEZONE = "Asia/Ho_Chi_Minh"
$env:NUTRIAI_CALORIE_MINIMUM = "1200"
$env:NUTRIAI_CALORIE_MAXIMUM = "4000"
uvicorn app.main:app --reload
```

Huấn luyện mô hình thể trạng bằng CSV gốc ở thư mục trên backend:

```powershell
python train_obesity_model.py
```

Script loại các dòng trùng hoàn toàn khỏi tập huấn luyện, chia train/test phân tầng 80/20, lưu pipeline ở `models/obesity_status_model.pkl`, metric ở `training_metrics.json` và confusion matrix ở `confusion_matrix.png`. CSV thực tế có 14 cột tổng cộng: 13 input và `Mức cân nặng`; script dùng đúng cột thực tế, không tự thêm input thiếu trong danh sách mô tả. Sau khi train, có thể import `predict_body_status` từ `train_obesity_model.py`; hàm kiểm tra đủ trường và miền giá trị, trả xác suất từng lớp cùng BMI tham khảo. Endpoint `POST /api/v1/nutrition/body-status` gọi hàm này; frontend gửi đủ thông tin cơ thể và thói quen. Nhãn ML và gợi ý mục tiêu chỉ là tham khảo; Nutrition Engine vẫn là phần tính calo và đa lượng riêng.

Mở `http://127.0.0.1:8000/docs`. SQLite được tạo tại `backend/nutriai.db` (có thể đổi `NUTRIAI_DATABASE_URL`). Không xóa database khi khởi động.

## Cấu trúc mã nguồn

- `app/main.py`: tạo ứng dụng FastAPI, gắn middleware/router và khởi tạo database/catalog/model.
- `app/routers/`: endpoint chia theo `auth`, `users`, `nutrition`, `meal_plans` và `system`.
- `app/services/meal_plans.py`: tính toán, chọn món và lưu phiên bản thực đơn.
- `app/utils/`: dependency xác thực, xử lý profile, serialize response và timezone.
- `app/models.py`, `app/schemas.py`: schema database và dữ liệu request.
- `app/catalog.py`, `app/recommender.py`, `app/nutrition.py`, `app/security.py`: nạp dữ liệu, gợi ý món, tính nhu cầu và bảo mật.

## API v1

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`
- `GET /api/v1/users/me`, `PUT /api/v1/users/me/profile`
- `POST /api/v1/nutrition/calculate`
- `POST /api/v1/nutrition/body-status` (phân loại bằng pipeline thể trạng đã train)
- `POST /api/v1/nutrition/history` (lưu phép tính hiện tại của hồ sơ)
- `GET /api/v1/nutrition/history` (30 kết quả gần nhất của tài khoản)
- `POST /api/v1/recommendations/by-ingredients`
- `POST /api/v1/meal-plans/generate`
- `POST /api/v1/meal-plans/select-dish`
- `GET /api/v1/meal-plans?date=YYYY-MM-DD` (bỏ `date` để xem hôm nay theo `Asia/Ho_Chi_Minh`)
- `GET /api/v1/meal-plans/history?page=1&page_size=20`
- `GET /api/v1/meal-plans/{plan_id}`
- `POST /api/v1/meal-plans/{plan_id}/regenerate`
- `GET /api/v1/meal-plans/export?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&format=csv|xlsx`

Đăng ký bằng email hoặc username (cần ít nhất một) cùng mật khẩu; đăng nhập bằng username/email và mật khẩu. Dùng `Authorize` trong `/docs` với bearer token.

Gọi lại `POST /meal-plans/generate` cho ngày đã có kế hoạch sẽ trả phiên bản mới nhất hiện có (`200`, `created: false`). Dùng endpoint `/meal-plans/{plan_id}/regenerate` khi muốn chủ động tạo phiên bản mới; lịch sử cũ được giữ nguyên.

`POST /api/v1/meal-plans/select-dish` nhận `{plan_date, meal_type, dish_id}`. Endpoint tạo một phiên bản mới, thay món của bữa được chọn và giữ các bữa còn lại; nếu ngày đó chưa có thực đơn, backend tạo thực đơn nền rồi thay món trước khi lưu. Món được kiểm tra lại trong catalog, hồ sơ dị ứng/nguyên liệu tránh và tính đầy đủ dinh dưỡng. Phiên bản cũ không bị ghi đè.

## Tính toán và giới hạn

Mifflin–St Jeor tính BMR; TDEE = BMR × hệ số vận động. Mức điều chỉnh mặc định là giảm cân −10%, tăng cân +10%, tăng cơ +5% và duy trì 0% TDEE. Protein dùng hệ số theo mục tiêu (giảm cân 1.6, duy trì 1.2, tăng cân 1.4, tăng cơ 1.8 g/kg) cộng hệ số vận động (0–0.2 g/kg), sau đó giới hạn ở 15–25% năng lượng; Fat mặc định 30% năng lượng (cấu hình trong 20–35%); Carb nhận phần năng lượng còn lại. Quy đổi 4/4/9 kcal cho mỗi gram và trả công thức cùng tỷ trọng trong API. Có thể cấu hình `NUTRIAI_ACTIVITY_FACTORS`, `NUTRIAI_CALORIE_ADJUSTMENT`, `NUTRIAI_PROTEIN_FACTORS` và `NUTRIAI_ACTIVITY_PROTEIN_BONUS` bằng JSON object với đủ các khóa như trong `app/config.py`; `NUTRIAI_FAT_ENERGY_FRACTION` nhận giá trị thập phân. Bộ xếp hạng thực đơn dùng mục tiêu gram Protein/Carb/Fat của hồ sơ, chia theo tỷ lệ từng bữa cùng với độ khớp calo, mục tiêu, đa dạng và lịch sử món. Đây là ước tính cho người trưởng thành; công thức BMR bắt nguồn từ Mifflin–St Jeor, còn phân bổ đa lượng là cấu hình tham khảo và cần chuyên gia xem xét trong trường hợp sức khỏe đặc biệt. Có giới hạn calo tối thiểu/tối đa và cảnh báo nếu đề xuất nằm ngoài ngưỡng; backend không âm thầm ép giá trị. Người dưới 18 tuổi không được tạo kế hoạch tự động. BMI chỉ là sàng lọc.

Mỗi lần lưu qua Nutrition Engine được ghi vào `nutrition_calculation_records`, theo tài khoản và có bản chụp đầy đủ kết quả để xem lịch sử kể cả khi hồ sơ thay đổi.

Dataset đã được kiểm tra: sheet `dishes`, dinh dưỡng trên 100 g, `serving_g` và dinh dưỡng khẩu phần. Cờ `kcal_macro_mismatch` đánh dấu kcal lệch trên 20% so với 4×đạm + 9×béo + 4×carb; các món có cờ này được loại khỏi gợi ý. Backend tính khẩu phần theo số liệu trên 100 g và giữ định lượng gốc làm mức tham khảo. Dị ứng được lọc dựa trên chuỗi nguyên liệu có trong dataset; điều này không bảo đảm an toàn do thiếu dữ liệu nhiễm chéo/đầy đủ thành phần.

### Tìm món theo nguyên liệu

`POST /api/v1/recommendations/by-ingredients` yêu cầu Bearer token và nhận `ingredients` (1–40 chuỗi), `limit` (1–50), `max_calories` (theo khẩu phần), `min_protein` và `goal`. Catalog TF-IDF được tạo một lần khi backend khởi động; khởi động lại backend để nạp lại workbook sau khi dữ liệu đổi. Nguồn chính là `bo-du-lieu-mon-an.xlsx`, sheet `dishes`; CSV và workbook gán nhãn trùng món không được nhập lại. File `ket_qua_dan_nhan_AI.xlsx`, nếu có và khớp `dish_id`, chỉ bổ sung nhãn dự đoán AI.

Nguyên liệu được tách theo dấu `|`, `;` và dòng mới; số lượng kiểu `: 20 g` bị bỏ khỏi tên. Bộ alias chỉ gộp một số đồng nghĩa rõ ràng, các chuỗi khác được so khớp nguyên văn sau khi chuẩn hóa dấu và chữ hoa/thường. TF-IDF biểu diễn từng nguyên liệu thành một token cụm (ví dụ `thit_bo`) và cosine similarity xếp hạng cùng tỷ lệ thành phần khớp. Trọng số mặc định là cosine `0.50`, tỷ lệ khớp `0.40`, nhãn phù hợp mục tiêu `0.10`; đây là trọng số xếp hạng có thể điều chỉnh trong service, không phải độ chính xác. Tất cả thành phần được tính là nguyên liệu bắt buộc vì workbook chưa tách gia vị/nguyên liệu chính. Dị ứng trong hồ sơ được loại theo các thành phần nhận diện được, nhưng dữ liệu không bảo đảm an toàn dị ứng.

Random Forest hiện có được kiểm tra khi khởi động, nếu tương thích sẽ dùng nhãn phân loại làm tín hiệu xếp hạng phụ. Nó không tính calorie cá nhân và không được xem là chuyên gia. Model có thể không nạp được nếu phiên bản scikit-learn tạo pickle khác với phiên bản môi trường.

## Kiểm thử

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Các unit test dùng SQLite tạm và dữ liệu món ăn giả, không cần workbook thật.


