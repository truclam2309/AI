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

Mặc định API dùng `http://127.0.0.1:8000/api/v1`. Nếu backend chạy nơi khác, sửa `VITE_API_URL` trong `.env.local`. Khởi động backend trước, sau đó mở địa chỉ Vite hiện trong Terminal (thường là `http://localhost:5173`). Backend cần cho phép origin này trong `NUTRIAI_CORS_ORIGINS`.

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
