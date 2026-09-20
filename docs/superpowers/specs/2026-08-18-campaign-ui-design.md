# Thiết kế lại giao diện Campaign

## Phạm vi

Chỉ thay đổi lớp trình bày của màn Campaign. Không thay đổi payload, API Meta, quy trình tạo quảng cáo hoặc dữ liệu nháp.

## Bố cục

- Header gọn, giữ điều hướng workspace và hành động chính.
- Cây chiến dịch dùng nền trung tính, dòng chọn có viền xanh và nền xanh nhạt.
- Editor dùng chiều rộng đọc tối ưu; mỗi nhóm thiết lập là một card nhất quán.
- Review panel tách biệt bằng viền, trạng thái dùng màu ngữ nghĩa.

## Component

- Input/select/dropdown cao 42–44px, focus ring rõ.
- Card bo 12px, viền 1px, shadow nhẹ.
- Dropdown tài khoản/Page tìm theo tên hoặc ID, chọn độc lập, hỗ trợ bàn phím.
- Dropdown tuổi dùng danh sách 13–65.

## Kiểm tra

- Light/dark không xuất hiện mảng nền sai màu.
- Không che hoặc cắt dropdown.
- Không có horizontal scroll ở 375px, 768px, 1024px và 1440px.
- Tất cả control dùng được bằng bàn phím.

