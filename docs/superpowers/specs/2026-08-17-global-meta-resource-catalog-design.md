# Thiết kế catalog tài khoản quảng cáo và Page dùng chung

## Mục tiêu

- Chỉ tải toàn bộ tài khoản quảng cáo và Facebook Page một lần sau khi kết nối Meta.
- Cho phép chọn tài khoản quảng cáo và Page độc lập trong từng chiến dịch.
- Luôn cho phép mở lại hai ô để đổi lựa chọn.
- Không gọi lại toàn bộ Page catalog mỗi lần đổi tài khoản.
- Chặn tạo quảng cáo nếu cặp tài khoản–Page không có quyền quảng cáo.

## Kiến trúc dữ liệu

Tài nguyên dùng chung trong phiên gồm `adAccounts`, `pages` và thông tin khám phá Page. Tài nguyên phụ thuộc tài khoản gồm Custom Audience, Saved Audience và kết quả tìm kiếm targeting. Page không còn nằm riêng trong `accountResourcesById`.

Endpoint `/api/resources` trả hồ sơ Meta, quyền, toàn bộ tài khoản quảng cáo và toàn bộ Page dùng chung. Endpoint `/api/ad-account-resources` chỉ tải Custom Audience, Saved Audience và danh sách Page có thể quảng bá của tài khoản để tạo tập ID tương thích.

## Luồng giao diện

Sau OAuth, ứng dụng tải catalog dùng chung một lần. Ô tài khoản và ô Page đều bật độc lập, hỗ trợ tìm kiếm, không tự động khóa sau khi chọn và không xóa lẫn nhau khi thay đổi.

Khi chọn tài khoản, ứng dụng chỉ tải tài nguyên phụ thuộc tài khoản nếu chưa có cache. Khi chọn Page, ứng dụng chỉ cập nhật `pageId`. Việc đổi tài khoản không xóa Page; việc đổi Page không thay đổi tài khoản.

## Kiểm tra tương thích

Mỗi tài khoản lưu tập `promotablePageIds`. Khi cả tài khoản và Page đã được chọn, hệ thống kiểm tra Page có trong tập này. Nếu không tương thích, bảng Kiểm tra hiển thị lỗi rõ ràng và nút tạo Ads bị khóa.

Nếu Meta chưa trả được tập tương thích do lỗi quota, ứng dụng giữ catalog dùng chung và báo chưa thể xác minh thay vì xóa lựa chọn.

## Hạn chế request

- Catalog Page dùng chung chỉ gọi trong `/api/resources` sau kết nối hoặc tải lại trang.
- Không quét `/me/accounts`, `/me/businesses`, `owned_pages` và `client_pages` khi đổi tài khoản.
- Mỗi tài khoản chỉ gọi `promote_pages`, Custom Audience và Saved Audience một lần trong phiên.
- Các lần chọn lại dùng cache hiện có.

## Kiểm thử

- Catalog dùng chung được trả từ resource discovery.
- Hai combobox luôn bật khi đã kết nối và có thể thay đổi nhiều lần.
- Đổi tài khoản không xóa Page, đổi Page không thay đổi tài khoản.
- Chọn lại tài khoản đã tải không gọi API lần nữa.
- Cặp tài khoản–Page không tương thích tạo lỗi validation và khóa xuất bản.
- Lỗi quota giữ nguyên catalog và lựa chọn hiện tại.
