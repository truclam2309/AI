# NutriAI Frontend

Frontend React + TypeScript + Vite, kết nối backend FastAPI tại `/api/v1`.

## Chạy local trên Windows

1. Mở PowerShell ở thư mục `Frondend`.
2. Cài dependencies và cấu hình API:

```powershell
cd "D:\Nhóm 3\Frondend"
npm install
Copy-Item .env.example .env.local
npm run dev
```

Local: sao chép `.env.example` thành `Frondend/.env.local`, khởi động backend từ thư mục `backend`, rồi chạy `npm run dev`. Để thử website local với backend online, đặt `VITE_API_URL` thành URL Render. Khi không đặt `VITE_API_URL`, Vite proxy `/api/*` và `/images/*` tới `http://127.0.0.1:8000`; có thể đổi đích bằng `VITE_DEV_API_ORIGIN`. Khởi động lại Vite sau khi sửa biến môi trường.

Online: deploy backend FastAPI trên Render từ Blueprint `render.yaml` ở thư mục gốc; tên service `ai-9kpu` khớp với URL `https://ai-9kpu.onrender.com` mà frontend hiện dùng mặc định. Render hỏi `NUTRIAI_DATABASE_URL` (dùng PostgreSQL; URL dạng `postgresql://...` được hỗ trợ) và `NUTRIAI_CORS_ORIGINS` (origin Vercel, không thêm dấu `/`). Không dùng SQLite trên Render vì filesystem web service là tạm thời. Trong Vercel, đặt Root Directory `Frondend`, framework Vite, Build Command `npm run build`, Output Directory `dist`, và biến `VITE_API_URL=https://ai-9kpu.onrender.com/api/v1` (mẫu ở `.env.production.example`), sau đó redeploy. `vercel.json` cấu hình SPA deep links.

Sau khi deploy, từ PowerShell ở thư mục `backend`, chạy `./check-production.ps1`. Script kiểm tra `/health` và xác nhận OpenAPI tại đúng domain có hai trường `main_meals` và `side_meals`.

Render Free tự dừng sau 15 phút không có truy cập; lượt đầu kế tiếp có thể mất khoảng một phút để thức dậy. Chọn instance luôn chạy nếu cần phản hồi nhanh ổn định. Vercel frontend vẫn được phân phối qua CDN.

Kiểm tra sau deploy: mở `/health` và `/docs` trên backend. Route `GET /api/v1/recommendations/dishes` phải xuất hiện trong OpenAPI; nếu không, Render chưa chạy đúng backend/commit hoặc Root Directory sai. Route menu yêu cầu Bearer token.

## Kiểm tra giao diện

- `npm run build`: kiểm tra TypeScript và tạo bản build trong `dist/`.
- `npm run dev`: chạy môi trường phát triển.

Frontend sử dụng API có thật của backend: đăng ký/đăng nhập, hồ sơ, tính BMI/BMR/TDEE, tạo thực đơn, xem phiên bản và lịch sử theo ngày. Backend hiện không có API tìm món riêng hoặc sửa/xóa từng món đã lưu; giao diện không giả lập các thao tác đó.

## Các luồng chính

- `Đăng nhập`: email hoặc username; token lưu trong local storage.
- `Hồ sơ`: ngày sinh, chỉ số cơ thể, giới tính công thức, vận động, mục tiêu và danh sách cần tránh/yêu thích.
- `Thực đơn`: chọn ngày, tạo kế hoạch; gọi lại tạo sẽ giữ phiên bản hiện tại, nút tạo phiên bản mới gọi API regenerate.
- Trong thực đơn, ảnh món lấy từ catalog; bấm tên món để xem nguyên liệu và cách chế biến nếu dataset có dữ liệu.
- `Gợi ý món`: nhập nguyên liệu hiện có, tùy chọn lọc calo/protein/mục tiêu; kết quả được xếp hạng bằng TF-IDF + cosine. Chọn ngày và bữa rồi bấm “Chọn cho bữa” để lưu món thành phiên bản thực đơn mới, giữ nguyên lịch sử cũ.
- `Phân tích`: hiển thị kết quả `/nutrition/calculate`; BMI và mức calo chỉ là ước tính tham khảo.
