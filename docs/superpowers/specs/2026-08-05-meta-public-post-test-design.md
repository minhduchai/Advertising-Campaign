# Meta Public Post Test Design

## Mục tiêu

Khắc phục trường hợp Meta trả `Code 100 / Subcode 1885183` khi App đang ở trạng thái **Đã hủy đăng**. Ứng dụng bổ sung một chế độ thử nghiệm tạo bài viết công khai trên Facebook Page, sau đó dùng bài viết đó để tạo quảng cáo ở trạng thái `PAUSED`.

Chế độ dark post hiện tại vẫn là mặc định và tiếp tục được khuyên dùng sau khi Meta App chuyển sang Live.

## Phạm vi

- Thêm lựa chọn theo từng quảng cáo:
  - **Bài quảng cáo ẩn**: luồng `object_story_spec` hiện tại.
  - **Bài công khai để thử App Dev**: tạo bài Page công khai rồi dùng `object_story_id`.
- Public Test phiên bản đầu hỗ trợ **ảnh**. Video tiếp tục yêu cầu App Live vì quy trình đăng video và lấy Page story ID cần một luồng xử lý riêng.
- Campaign, Ad Set, Creative và Ad vẫn được tạo ở trạng thái an toàn; Campaign, Ad Set và Ad là `PAUSED`.
- Không tự chuyển mọi quảng cáo sang Public Test. Người dùng phải chủ động chọn vì bài sẽ xuất hiện thật trên Page.

## Quyền Meta

- OAuth bổ sung `pages_manage_posts`.
- Sau khi cập nhật, người dùng phải bấm **Kết nối lại Meta** để cấp token mới.
- Trước khi tạo bất kỳ Campaign nào, server kiểm tra với `/me/accounts` rằng Page:
  - Có Page access token.
  - Có task `CREATE_CONTENT`.
  - Vẫn có quyền quảng cáo theo Page catalog hiện tại.
- Page chỉ có quyền quảng cáo nhưng không có quyền tạo nội dung sẽ không dùng được Public Test; luồng dark post vẫn không thay đổi.

## Luồng tạo Public Test

1. Frontend gửi `publicationMode: "PUBLIC_TEST"` trong quảng cáo.
2. Server preflight toàn bộ draft trước khi tạo Campaign để tránh tạo Campaign/Ad Set mồ côi khi thiếu quyền Page.
3. Với quảng cáo ảnh, server đăng ảnh lên `/{page_id}/photos` bằng Page access token với `published=true` và nội dung chính làm caption.
4. Server lấy `post_id`; nếu Meta chỉ trả Photo ID thì đọc `page_story_id` từ Photo.
5. Server tạo Ad Creative bằng:
   - `object_story_id` của bài công khai.
   - `call_to_action_type: "MESSAGE_PAGE"`.
   - `page_welcome_message` ở cấp Ad Creative.
   - `name` và `title` từ quảng cáo hiện tại.
6. Server tạo Ad ở trạng thái `PAUSED` như hiện nay.

Meta Business SDK hiện công bố `object_story_id`, `call_to_action_type` và `page_welcome_message` là các trường cấp Ad Creative. Public Test dùng các trường này thay vì cố thêm `published=true` vào `object_story_spec`, vì trường đó không tồn tại trong AdCreativeObjectStorySpec.

## Cuộc trò chuyện và tiêu đề

- App vẫn gửi JSON **Cuộc trò chuyện** qua `page_welcome_message` cấp Ad Creative.
- Nếu Meta không cho phép ghép template với một Page post công khai cụ thể, app hiển thị nguyên lỗi Meta và tự dọn bài test vừa tạo.
- Nội dung chính xuất hiện trên bài Page. Tiêu đề là metadata quảng cáo; Meta có thể không hiển thị tiêu đề trên bài organic.
- UI hiển thị cảnh báo này ngay khi bật Public Test.

## Xử lý lỗi và dọn dẹp

- Thiếu `pages_manage_posts`, Page token hoặc `CREATE_CONTENT`: dừng trước khi tạo Campaign.
- Media là video trong Public Test: validation dừng trước khi tạo Campaign và yêu cầu dùng ảnh hoặc chuyển App Live.
- Nếu bài Page đã được tạo nhưng Creative hoặc Ad thất bại, server xóa bài vừa tạo bằng Page token.
- Nếu việc xóa thất bại, nhật ký trả về Page post ID để người dùng xóa thủ công.
- Nếu Ad thành công, bài công khai được giữ nguyên.

## Nhật ký và dữ liệu

- Kết quả quảng cáo lưu thêm `postId` của bài công khai.
- Nhật ký thành công hiển thị `ID bài viết công khai`.
- Nhật ký lỗi dọn dẹp hiển thị cả lỗi gốc của Meta và trạng thái xóa bài.
- Dark post không có `postId` công khai và giữ cách hiển thị hiện tại.

## UX

- Trong phần **Nội dung quảng cáo**, thêm nhóm **Chế độ bài viết**.
- Mặc định chọn **Bài quảng cáo ẩn — dùng khi App Live**.
- Khi chọn **Bài công khai để thử App Dev**, hiển thị cảnh báo màu vàng:
  - Bài sẽ xuất hiện thật trên Facebook Page.
  - Chỉ hỗ trợ ảnh trong phiên bản đầu.
  - Có thể cần kết nối lại Meta để cấp `pages_manage_posts`.
- Sidebar kiểm tra thiết lập phản ánh đúng lỗi video/quyền trước khi người dùng gửi Meta.

## Xác minh

Theo yêu cầu hiện tại, không chạy toàn bộ test suite. Sau triển khai chỉ thực hiện:

- `node --check` cho các file JavaScript thay đổi.
- Khởi động lại server local và kiểm tra `/api/health`.
- Người dùng tự chạy một quảng cáo ảnh Public Test và xác nhận bài Page, Creative và Ad được tạo.

## Ngoài phạm vi

- Tự động phát hành Meta App hoặc hoàn tất Business Verification.
- Public Test cho video.
- Đồng bộ bài viết công khai đã tạo vào thư viện nội dung riêng.
- Tự động chuyển toàn bộ draft sang Public Test.
