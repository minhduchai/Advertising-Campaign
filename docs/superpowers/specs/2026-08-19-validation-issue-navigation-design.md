# Điều hướng từ cảnh báo đến trường cần sửa

## Mục tiêu

Khi bảng **Kiểm tra thiết lập** hiển thị “Cần xử lý trước khi tạo”, người dùng có thể bấm trực tiếp vào từng lỗi để đến đúng trường cần sửa trong chiến dịch, nhóm quảng cáo hoặc quảng cáo.

## Hành vi

1. Mỗi dòng lỗi là một nút điều hướng độc lập.
2. Khi bấm, ứng dụng chọn đúng node tương ứng trong cây chiến dịch.
3. Ứng dụng mở các section đang thu gọn cần thiết.
4. Trường lỗi được cuộn mượt vào vùng nhìn thấy, ưu tiên căn giữa màn hình.
5. Trường hoặc card liên quan được tô viền đỏ và nền đỏ nhạt trong khoảng 3 giây.
6. Nếu đích là ô nhập có thể focus, ứng dụng đặt con trỏ vào ô đó sau khi cuộn.
7. Nếu không tìm thấy trường cụ thể, ứng dụng vẫn chuyển tới đúng node và tô sáng card gần nhất.

## Ánh xạ lỗi

- Validation giữ nguyên `path` hiện tại, ví dụ `campaigns.0.adSets.0.ads.0.headline`.
- `describeIssuePath` bổ sung `path`, `fieldPath` và thông tin node cho từng dòng lỗi.
- Các trường trong workspace dùng thuộc tính ổn định `data-validation-path` hoặc `data-validation-field` để làm đích điều hướng.
- Trường hợp nhiều lỗi cùng trỏ tới một card, mỗi dòng vẫn điều hướng riêng nhưng có thể dùng chung card dự phòng.

## Tương tác và giao diện

- Dòng lỗi có hover, focus-visible và biểu tượng mũi tên để thể hiện khả năng bấm.
- Trạng thái tô sáng dùng class tạm thời, không thay đổi dữ liệu form.
- Tôn trọng `prefers-reduced-motion`: không cuộn mượt hoặc animation kéo dài khi người dùng giảm chuyển động.
- Không làm trang nhảy lên đầu và không đóng bảng kiểm tra.

## Xử lý lỗi

- Nếu node đã bị xóa hoặc path không còn hợp lệ, hiển thị toast: “Không tìm thấy trường cần sửa. Hãy kiểm tra lại đối tượng.”
- Lỗi chung như `server` chỉ hiển thị thông báo, không cố điều hướng.

## Kiểm thử

- Bấm lỗi cấp chiến dịch, nhóm quảng cáo và quảng cáo chọn đúng node.
- Bấm lỗi tên, tài khoản, Page, ngân sách, vị trí, nội dung, media, cuộc trò chuyện và seeding cuộn đúng đích.
- Trường được focus và tô sáng; highlight tự hết.
- Không đổi vị trí cuộn ngoài thao tác điều hướng chủ động.
- Lỗi không có đích không gây crash và có toast dự phòng.
