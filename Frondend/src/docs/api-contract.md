# NutriAI frontend ↔ FastAPI contract

Base URL mặc định: `http://127.0.0.1:8000/api/v1`. Ghi đè bằng `VITE_API_URL` trong `.env.local`. Token gửi qua `Authorization: Bearer <access_token>`.

| Method | Path | Nội dung chính |
|---|---|---|
| POST | `/auth/register` | `{username?, email?, password}`; trả `access_token` và `user` |
| POST | `/auth/login` | `{username_or_email, password}`; trả token |
| GET | `/users/me` | Trả `{data: user}`; profile nằm trong user |
| PUT | `/users/me/profile` | Cập nhật hồ sơ; trả `{data: profile}` |
| POST | `/nutrition/calculate` | Tính từ hồ sơ hiện tại hoặc các trường profile gửi trong body; trả BMI, BMR, TDEE, calories, protein/carb/fat và công thức |
| POST | `/nutrition/history` | Lưu phép tính dinh dưỡng từ hồ sơ đã lưu |
| GET | `/nutrition/history` | Trả tối đa 30 phép tính đã lưu gần nhất của người dùng |
| POST | `/recommendations/by-ingredients` | `{ingredients, limit?, max_calories?, min_protein?, goal?}`; trả kết quả cosine, thành phần khớp/còn thiếu và dinh dưỡng theo khẩu phần |
| GET | `/meal-plans?date=YYYY-MM-DD` | Trả `{date, data: [plan versions]}`; từng món có `image_url`, `ingredients`, `instructions`; bỏ ngày để lấy hôm nay |
| POST | `/meal-plans/generate` | `{plan_date}`; trả `{data: plan, created}` cùng ảnh, nguyên liệu và hướng dẫn món |
| POST | `/meal-plans/select-dish` | `{plan_date, meal_type, dish_id}`; tạo phiên bản mới có món được chọn ở đúng bữa, không xóa phiên bản cũ |
| POST | `/meal-plans/{id}/regenerate` | Tạo phiên bản mới, giữ lịch sử cũ; nhận `meal_split?` để dùng tỷ lệ bữa tùy chỉnh |
| GET | `/meal-plans/history?page=1&page_size=20` | Lịch sử của người đang đăng nhập |
| GET | `/meal-plans/{id}` | Chi tiết phiên bản thuộc người dùng |

Backend chưa có `/nutrition/targets`, `/foods`, `/recommendations`, `/meal-plans/entries` hay API phân tích món thủ công. Frontend không gọi các endpoint này; gợi ý món được trả trong kế hoạch 3 bữa.

Swagger/OpenAPI của backend là nguồn contract cuối cùng: `http://127.0.0.1:8000/docs` và `/openapi.json`.
