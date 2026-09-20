# Thiết kế tải đầy đủ Facebook Page cho Meta Campaign Builder

## Mục tiêu

Mở rộng bộ chọn Facebook Page để phản ánh gần nhất danh sách danh tính Page mà Ads Manager cho người dùng chọn, thay vì chỉ dùng `promote_pages` của ad account.

Ứng dụng phải:

- Hợp nhất Page từ ba nhóm nguồn Graph API công khai.
- Không âm thầm bỏ Page khi thiếu quyền Business Portfolio.
- Không gửi access token hoặc Page access token xuống trình duyệt.
- Không thực hiện Meta write trong quá trình tải Page.
- Chỉ cho xuất bản bằng Page mà token hiện tại có tín hiệu quyền quảng cáo.

## Dữ liệu đã xác minh

Kiểm tra read-only với token Meta hiện tại và ad account `act_61724586` cho thấy:

- `promote_pages`: 4 Page.
- `/me/accounts`: 12 Page.
- Hai tập Page không trùng nhau.
- Nhiều tên trong cả hai tập xuất hiện trong dropdown của Ads Manager mà người dùng cung cấp.
- Dropdown Ads Manager còn có Page không thuộc hai tập trên, phù hợp với trường hợp Page đến từ Business Portfolio.
- Token hiện có `pages_show_list`, `pages_manage_ads`, `pages_read_engagement`, `ads_read` và `ads_management`.
- Token chưa có `business_management`; `/me/businesses` hiện trả lỗi `(#100) Missing Permission`.
- Cả edge `/act_61724586/promote_pages` và field lồng `promote_pages.limit(100)` đều trả đúng 4 Page, không có trang tiếp theo. Đây không phải lỗi pagination.

## Phạm vi đã duyệt

### Có trong thay đổi

- Thêm `business_management` vào OAuth scope.
- Hợp nhất Page từ:
  1. `/{ad_account_id}/promote_pages`.
  2. `/me/accounts`.
  3. `/me/businesses`, sau đó lấy `owned_pages` và `client_pages` của từng Business Portfolio.
- Theo pagination đến hết cho mọi connection.
- Gộp trùng theo Page ID.
- Giữ lại nguồn và tín hiệu quyền của từng Page ở server.
- Trả danh sách Page công khai cùng trạng thái khả dụng, không trả token.
- Hiển thị Page trong dropdown có tìm kiếm.
- Page chưa đủ tín hiệu quyền vẫn hiển thị nhưng bị khóa và có lý do.
- Nếu thiếu `business_management`, hiển thị cảnh báo cùng liên kết kết nối Meta lại.
- Dùng cùng catalog Page để kiểm tra quyền cho thư viện mẫu Cuộc trò chuyện và trước khi publish.

### Không có trong thay đổi

- Không gọi endpoint nội bộ của Ads Manager.
- Không bảo đảm hiển thị Page thuộc Facebook profile khác với profile đã OAuth.
- Không tự cấp quyền Page hoặc quyền Business Portfolio.
- Không tự gửi App Review hay tự chuyển Meta App sang Live.
- Không tạo, sửa hoặc xóa Campaign, Ad Set, Ad hay Page trong quá trình discovery.
- Không cho chọn Page chỉ có tên/ID nhưng không có tín hiệu quyền quảng cáo.

## Mô hình catalog Page

Server chuẩn hóa mỗi Page thành:

```js
{
  id: '123456789',
  name: 'Tên Page',
  sources: ['MANAGED', 'PROMOTABLE', 'BUSINESS_OWNED'],
  tasks: ['PROFILE_PLUS_ADVERTISE'],
  canAdvertise: true,
  unavailableReason: null
}
```

`sources` có thể gồm:

- `PROMOTABLE`: được Meta trả từ ad account `promote_pages`.
- `MANAGED`: được trả từ `/me/accounts`.
- `BUSINESS_OWNED`: thuộc `owned_pages` của Business Portfolio.
- `BUSINESS_CLIENT`: thuộc `client_pages` của Business Portfolio.

Browser chỉ nhận `id`, `name`, `sources`, `canAdvertise` và `unavailableReason`. Mọi access token bị loại bỏ tại Meta client/server boundary.

## Quy tắc khả dụng

Page được chọn khi thỏa ít nhất một điều kiện:

1. Có nguồn `PROMOTABLE`.
2. Meta trả task quảng cáo như `ADVERTISE` hoặc `PROFILE_PLUS_ADVERTISE`.
3. Meta trả task quản trị bao hàm quyền quảng cáo như `MANAGE`, `PROFILE_PLUS_MANAGE` hoặc `PROFILE_PLUS_FULL_CONTROL`.

Page không có tín hiệu trên vẫn xuất hiện nhưng bị khóa với lý do: `Meta chưa trả quyền tạo quảng cáo cho Page này`.

Trước khi dùng Page cho template hoặc publish, server tải lại catalog và xác nhận `canAdvertise === true`. Client state không được coi là bằng chứng quyền.

## Luồng discovery

1. Người dùng chọn ad account.
2. Server giải mã user token trong bộ nhớ.
3. Server tải song song `promote_pages` và `/me/accounts`.
4. Server thử tải `/me/businesses`.
5. Nếu có `business_management`, server tải `owned_pages` và `client_pages` của từng Business Portfolio.
6. Nếu Meta trả lỗi thiếu quyền Business, server vẫn trả hai nguồn đầu và đặt `requiresBusinessReconnect=true`.
7. Server gộp trùng theo Page ID, hợp nhất `sources/tasks`, tính `canAdvertise` rồi sắp xếp theo tên.
8. UI render dropdown và thông tin số lượng theo nguồn.

Không fallback sang dữ liệu hard-code và không coi lỗi permission Business là lỗi làm hỏng toàn bộ editor.

## OAuth và kết nối lại

Authorization URL thêm scope `business_management`.

Token hiện tại không tự nhận scope mới. Khi `requiresBusinessReconnect=true`, UI hiển thị:

- Thông báo: `Kết nối lại Meta để tải Page trong Business Portfolio`.
- Liên kết đến `/api/auth/meta/start`.
- Hai nguồn `PROMOTABLE` và `MANAGED` vẫn dùng được trong lúc chưa kết nối lại.

Sau callback OAuth thành công, connection hiện tại được cập nhật và tài nguyên ad account được tải lại.

Nếu Meta không cấp `business_management`, UI tiếp tục hoạt động với catalog một phần và luôn giữ cảnh báo; không lặp redirect tự động.

## Giao diện Page selector

Dropdown Page trong Ad Set gồm:

- Ô tìm kiếm theo tên Page.
- Nhóm **Có thể dùng để quảng cáo**.
- Nhóm **Chưa đủ quyền** với option bị khóa.
- Dòng tóm tắt, ví dụ: `16 Page khả dụng · 8 Page cần quyền`.
- Cảnh báo kết nối lại khi chưa đọc được Business Portfolio.

Khi Page đã chọn biến mất hoặc chuyển thành không khả dụng sau lần tải mới, app giữ tên Page trong draft để người dùng hiểu trạng thái nhưng chặn publish và yêu cầu chọn Page hợp lệ khác.

## Lỗi và khả năng phục hồi

- Lỗi thiếu `business_management`: trả catalog một phần và cảnh báo reconnect.
- Lỗi một Business Portfolio cụ thể: tiếp tục các Business còn lại, trả cảnh báo discovery một phần.
- Lỗi `promote_pages` hoặc `/me/accounts`: trả lỗi tải tài nguyên vì đây là hai nguồn nền tảng.
- Page trùng tên nhưng khác ID vẫn là hai Page riêng.
- Page trùng ID từ nhiều nguồn được gộp và giữ toàn bộ nguồn/quyền.
- Pagination có giới hạn vòng lặp tự nhiên theo `paging.next`; không tự dựng URL tiếp theo.

## Kiểm thử

### Meta client

- OAuth URL có `business_management`.
- Theo hết pagination cho `promote_pages`, `/me/accounts`, `/me/businesses`, `owned_pages` và `client_pages`.
- Gộp Page trùng ID và hợp nhất nguồn/task.
- Đánh dấu Page có task quảng cáo là khả dụng.
- Thiếu `business_management` trả catalog một phần thay vì throw toàn bộ.
- Không trả access token từ Page payload.

### Server

- Resource route trả catalog hợp nhất và metadata reconnect.
- Authorization template chấp nhận Page khả dụng từ mọi nguồn.
- Authorization từ chối Page bị khóa hoặc không tồn tại.
- Session chưa kết nối vẫn trả `401`.

### Browser/UI

- Render Page khả dụng và Page bị khóa thành hai nhóm.
- Hiển thị cảnh báo reconnect khi thiếu quyền Business.
- Page search lọc theo tên mà không mất lựa chọn hiện tại.
- Đổi ad account xóa catalog cũ và tải catalog mới.

### An toàn

- Discovery tests chỉ dùng GET/mock; không có Meta write.
- Publisher vẫn tạo mọi đối tượng ở `PAUSED`.

## Tiêu chí hoàn thành

- Với token hiện tại trước reconnect, dropdown hiển thị hợp nhất 4 Page `PROMOTABLE` và 12 Page `MANAGED`, sau khi gộp trùng.
- Sau khi cấp `business_management` và reconnect, dropdown bổ sung Page `BUSINESS_OWNED` và `BUSINESS_CLIENT` mà Graph API công khai trả về.
- Không Page nào bị mất vì app chỉ đọc `promote_pages` như trước.
- Page không đủ quyền không thể đi tới publish.
- Toàn bộ test hiện có và test mới đều đạt.
