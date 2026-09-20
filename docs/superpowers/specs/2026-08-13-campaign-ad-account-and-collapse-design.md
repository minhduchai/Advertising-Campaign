# Tài khoản quảng cáo, Page và nút thu phóng theo từng chiến dịch

## Mục tiêu

Cho phép mỗi chiến dịch trong cùng một bản nháp sử dụng một tài khoản quảng cáo và một Facebook Page riêng, đồng thời tách thao tác chọn chiến dịch khỏi thao tác thu hoặc mở cây nội dung.

## Trải nghiệm sử dụng

- Bấm vào dòng chiến dịch chỉ chọn chiến dịch để chỉnh sửa, không làm thay đổi trạng thái thu hoặc mở.
- Mỗi chiến dịch có một nút mũi tên riêng để thu hoặc mở các nhóm quảng cáo và quảng cáo bên trong.
- Bỏ ô chọn tài khoản quảng cáo chung trên thanh đầu trang.
- Trong phần chỉnh sửa chiến dịch có hai ô bắt buộc: `Tài khoản quảng cáo` và `Facebook Page`.
- Toàn bộ nhóm quảng cáo và quảng cáo trong chiến dịch tự dùng Page đã chọn ở cấp chiến dịch; bỏ ô chọn Page khỏi nhóm quảng cáo.
- Chiến dịch mới kế thừa tài khoản quảng cáo và Page của chiến dịch đang chọn. Nếu chưa có lựa chọn, ứng dụng dùng tài khoản đầu tiên có thể truy cập và tự chọn Page khi tài khoản chỉ có đúng một Page khả dụng.
- Khi đổi tài khoản quảng cáo của một chiến dịch, ứng dụng xóa Page và các đối tượng tùy chỉnh chỉ trong chiến dịch đó, sau đó tải tài nguyên của tài khoản mới.
- Việc thay đổi một chiến dịch không làm mất thiết lập của các chiến dịch khác.

## Mô hình dữ liệu phía trình duyệt

- Chuyển `adAccountId` từ cấp bản nháp xuống từng chiến dịch.
- Chuyển `pageId` từ từng nhóm quảng cáo lên từng chiến dịch.
- Lưu bộ nhớ đệm Page, thông tin nguồn Page, đối tượng tùy chỉnh, kết quả nhắm mục tiêu và mẫu cuộc trò chuyện theo từng tài khoản quảng cáo.
- Khi đang chỉnh sửa chiến dịch, nhóm quảng cáo hoặc quảng cáo, ứng dụng xác định tài khoản và Page qua chiến dịch cha.
- Mẫu cuộc trò chuyện được phân biệt theo cả tài khoản quảng cáo và Page để không dùng nhầm dữ liệu giữa các chiến dịch.

## API và quy trình tạo trên Meta

- Kiểm tra `campaign.adAccountId` và `campaign.pageId` cho từng chiến dịch.
- Trong một lượt tạo, tải và kiểm tra danh sách Page một lần cho mỗi tài khoản quảng cáo khác nhau.
- Trước khi ghi bất kỳ dữ liệu nào lên Meta, xác nhận Page của từng chiến dịch có thể quảng cáo qua đúng tài khoản đã chọn.
- Tạo chiến dịch, nhóm quảng cáo, nội dung và quảng cáo bằng tài khoản quảng cáo của chiến dịch đó.
- Nhóm quảng cáo và nội dung quảng cáo luôn dùng Page của chiến dịch cha.
- Không dùng chung nội dung quảng cáo giữa hai tài khoản quảng cáo hoặc hai Page khác nhau.
- Lịch sử hoạt động lưu tài khoản quảng cáo và Page tại từng chiến dịch. Trường tài khoản cấp lượt tạo cũ chỉ được giữ khi tất cả chiến dịch dùng cùng một tài khoản.

## Xử lý lỗi

- Thiếu hoặc không truy cập được tài khoản quảng cáo/Page sẽ chặn lượt tạo và báo lỗi đúng tại chiến dịch tương ứng.
- Page không thuộc danh sách có thể quảng cáo của tài khoản sẽ bị từ chối trước khi tạo bất kỳ đối tượng Meta nào.
- Lỗi tải tài nguyên chỉ ảnh hưởng bộ nhớ đệm của tài khoản đang thao tác, không xóa dữ liệu của chiến dịch khác.
- Khi đổi tài khoản, ứng dụng không giữ lại Page hoặc đối tượng tùy chỉnh không còn hợp lệ.

## Kiểm thử

- Kiểm thử trạng thái xác nhận bấm dòng chỉ chọn, còn nút mũi tên mới thu hoặc mở.
- Kiểm thử giao diện có nút thu/phóng riêng và hai ô tài khoản quảng cáo/Page trong trình chỉnh sửa chiến dịch.
- Kiểm thử việc đổi tài khoản chỉ xóa dữ liệu phụ thuộc trong đúng chiến dịch.
- Kiểm thử xác thực và publisher với nhiều chiến dịch dùng các tài khoản và Page khác nhau.
- Kiểm thử API nhóm việc kiểm tra Page theo từng tài khoản quảng cáo.
- Kiểm thử lịch sử lưu đúng tài khoản quảng cáo và Page của từng chiến dịch.
