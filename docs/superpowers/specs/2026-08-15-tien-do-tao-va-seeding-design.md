# Tiến độ tổng tạo quảng cáo và seeding

## Mục tiêu

Cải thiện panel **Kiểm tra** để theo dõi toàn bộ lượt tạo bằng một vòng tròn tiến độ chung, đồng thời hiển thị phần trăm riêng của từng chiến dịch.

## Phương án đã chọn

Một vòng tròn tổng duy nhất cho toàn bộ lượt chạy. Bên dưới là danh sách chiến dịch với thanh tiến độ nhỏ. Phương án này gọn hơn hai vòng tạo Ads/seeding riêng và dễ theo dõi khi chạy nhiều chiến dịch.

## Cách tính

Mỗi đối tượng Meta cần tạo là một bước: Campaign, Ad Set và Ad. Mỗi Post ID cần seeding là một bước riêng; các Ads dùng chung Post ID chỉ tính một lần.

Tiến độ tổng bằng số bước hoàn tất chia tổng số bước. Bước tạo Meta thành công hoặc thất bại đều được xem là đã xử lý; bước bị bỏ qua chỉ được xem là đã xử lý khi lượt tạo đã kết thúc. Seeding chỉ hoàn tất khi Post ID đạt trạng thái thành công, thất bại, cần kiểm tra hoặc đã hủy.

Mỗi chiến dịch áp dụng cùng công thức nhưng chỉ tính các đối tượng và Post ID thuộc chiến dịch đó.

## Giao diện

Panel **Kiểm tra** hiển thị:

- Vòng tiến độ SVG tổng, số phần trăm ở giữa.
- Nhãn trạng thái: Đang tạo, Đang seeding, Hoàn thành, Hoàn thành có lỗi hoặc Cần kiểm tra.
- Tóm tắt số bước đã xử lý trên tổng số bước.
- Danh sách từng chiến dịch gồm tên, phần trăm, thanh tiến độ và trạng thái hiện tại.
- Khi đạt 100%, vòng đổi xanh và xuất hiện dấu kiểm nhẹ; không dùng hiệu ứng glow mạnh liên tục.

Thiết kế tham khảo `C:\Users\Dominic Demin\Downloads\progress-circle.html` nhưng thu nhỏ, đồng bộ dark theme và hỗ trợ `prefers-reduced-motion`.

## Dữ liệu

Mở rộng module `run-progress.js` để tạo progress model tổng và theo campaign từ snapshot draft, nodes tạo Meta và `run.seeding.jobs`. Không tạo dữ liệu mới trong database và không gọi thêm API.

## Xử lý lỗi

Nếu chưa có dữ liệu seeding, tiến độ chỉ tính phần tạo Meta. Nếu Post ID chưa xuất hiện, bước seeding của chiến dịch ở trạng thái chờ. Dữ liệu cũ thiếu campaign mapping hiển thị trong nhóm “Không xác định” mà không làm lỗi panel.

## Kiểm tra

Kiểm tra nhiều campaign, Post ID dùng chung, tạo Ads thất bại, seeding đang chờ/thành công/thất bại, dữ liệu cũ và chế độ giảm chuyển động.
