# Đặc tả frontend — Tạo nhanh quảng cáo Messenger

Ngày: 08/09/2026  
Sản phẩm: Launch Control — Meta Campaign Builder  
Trạng thái: Đề xuất để duyệt thiết kế; chưa phải tính năng đã triển khai.

## 1. Mục tiêu trải nghiệm

Sau khi thiết lập một mẫu dùng chung, người dùng tạo quảng cáo mới bằng luồng:

**Thêm ảnh/video → nhập văn bản chính → xem lại → tạo quảng cáo.**

Trong luồng thường ngày, người dùng không phải nhập tên chiến dịch, tên nhóm quảng cáo, tên quảng cáo hoặc đi lần lượt qua các màn thiết lập. Ứng dụng tự điền từ mẫu đã chọn và tự sinh các tên nội bộ.

Điều kiện để đạt trải nghiệm này: phiên Meta đã kết nối và mẫu có đủ tài khoản, Page, ngân sách, đối tượng, tiêu đề, Messenger và seeding. Khi thiếu dữ liệu, giao diện chỉ dẫn tới phần cần bổ sung.

Tiêu chí trải nghiệm chính:

- Không có thao tác đặt tên bắt buộc trong một lượt Tạo nhanh đã có mẫu hợp lệ.
- Chỉ có hai nội dung phải cung cấp mỗi quảng cáo: media và văn bản chính.
- Từ đầu tới cuối, người dùng luôn biết Page nào, mẫu nào và ngân sách nào đang được dùng.
- Chuyển giữa Tạo nhanh và Thiết lập chi tiết không làm mất nội dung đang soạn.

## 2. Phạm vi phiên bản đầu

Tạo nhanh là một chế độ trong workspace Chiến dịch, dùng chung bản nháp và luồng xử lý với Launch Control hiện tại.

| Nội dung | Quyết định cho phiên bản đầu |
| --- | --- |
| Cấu trúc mới | Một chiến dịch → một nhóm quảng cáo → một quảng cáo ban đầu |
| Thêm quảng cáo | Thêm từng quảng cáo vào nhóm đang chọn, kế thừa thiết lập dùng chung |
| Media | Một ảnh hoặc một video cho mỗi quảng cáo |
| Tên ba cấp | Tự sinh; chỉnh riêng trong Thiết lập chi tiết |
| Mẫu thiết lập | Chọn, tạo, sửa và đặt một mẫu làm mặc định cho người dùng đang kết nối |
| Bản nháp cũ | Giữ nguyên cấu trúc; cho soạn từng quảng cáo qua bộ chọn nhóm/quảng cáo |
| Phạm vi một lượt tạo | Toàn bộ chiến dịch đang mở, bao gồm các nhóm và quảng cáo trong chiến dịch đó |
| Thiết lập phức tạp | Mở lại trình chỉnh sửa chi tiết đang có |

Kéo thả nhiều file cùng lúc, dùng một văn bản cho hàng loạt file, AI viết nội dung và tạo nhiều chiến dịch cùng lúc là phần mở rộng sau phiên bản đầu. Chọn nhiều file không được âm thầm hiểu thành carousel hoặc tạo thêm nhóm ngân sách.

## 3. Kiến trúc thông tin và điểm vào

Workspace Chiến dịch có hai lựa chọn: **Tạo nhanh** và **Thiết lập chi tiết**. Đây là hai cách xem cùng bản nháp, không phải hai bản dữ liệu riêng.

- Nút “Tạo chiến dịch” mở Tạo nhanh với mẫu mặc định hợp lệ của người dùng.
- Nếu chưa có mẫu mặc định, hiện bộ chọn mẫu; không tự chọn phần tử đầu tiên trong danh sách.
- Nếu chưa có mẫu nào, hiện lời dẫn “Thiết lập một lần để những lần sau chỉ cần ảnh/video và văn bản”.
- Bản nháp đã mở trước đó luôn được khôi phục trước khi xét mẫu mặc định. Mẫu mặc định chỉ tự áp dụng cho bản nháp mới.
- Tạo nhanh không hiển thị bốn tab bắt buộc Thiết lập / Đối tượng / Nội dung / Cuộc trò chuyện.
- Các mục Tổng quan, Seeding, Lịch sử và Thư viện vẫn sử dụng điều hướng hiện có.

Đường dẫn đề xuất: `/?frontend=launch-control&realResources=1&mode=quick`. Các đường dẫn có `section=setup|audience|content|message` tiếp tục mở đúng phần chi tiết. Không đổi mặc định của đường dẫn đang dùng trước khi triển khai và nghiệm thu.

## 4. Bố cục màn hình Tạo nhanh

### 4.1. Wireframe desktop

```text
┌───────────┬──────────────────────────────────────────────────────────────────┐
│ Điều      │ Tạo nhanh                       Đã lưu nháp   [Kết nối Meta]    │
│ hướng     ├──────────────────────────────────────────────────────────────────┤
│           │ [Mẫu: Dịch vụ A ▾] [Đổi mẫu]           [Thiết lập chi tiết]      │
│           │ Page A · TK …1234 · TP.HCM · Ngân sách 400.000 ₫/ngày           │
│           ├───────────────────────────────────────┬──────────────────────────┤
│           │ [Quảng cáo 1 ▾] [+ Thêm quảng cáo]     │ Xem trước Facebook      │
│           │                                       │                          │
│           │ ┌──────────────┐ ┌───────────────────┐ │ Page đã chọn             │
│           │ │              │ │ Văn bản chính *  │ │ Văn bản đang nhập        │
│           │ │  Ảnh/video * │ │                   │ │                          │
│           │ │              │ │                   │ │       Ảnh/video          │
│           │ │ [Chọn tệp]   │ └───────────────────┘ │                          │
│           │ │              │ Tiêu đề từ mẫu       │ Tiêu đề · Gửi tin nhắn   │
│           │ └──────────────┘ [Sửa tiêu đề]        │                          │
│           ├───────────────────────────────────────┴──────────────────────────┤
│           │ 1 chiến dịch · 1 nhóm · 1 quảng cáo          [Xem lại]          │
└───────────┴──────────────────────────────────────────────────────────────────┘
```

Các tên, địa điểm và số tiền trong wireframe chỉ minh họa bố cục; giao diện lấy giá trị thật từ bản nháp.

### 4.2. Thanh mẫu và tóm tắt

Thanh mẫu nằm trên vùng soạn, luôn thể hiện tên mẫu và trạng thái “Theo mẫu” hoặc “Đã chỉnh riêng”. Dòng bên dưới hiển thị Page, tài khoản quảng cáo với phần ID nhận diện, đối tượng rút gọn và ngân sách hiệu lực.

Ngân sách phải nói rõ cấp áp dụng. Với ngân sách nhóm, hiển thị tổng/ngày của chiến dịch và ngân sách nhóm đang chọn khi có nhiều nhóm; với ngân sách chiến dịch, chỉ tính ngân sách chung một lần. Đơn vị tiền lấy từ tài khoản; chưa tải được thì hiện “Chưa xác định tiền tệ”.

Nhấn vào Page, đối tượng hoặc ngân sách mở đúng phần tương ứng trong Thiết lập chi tiết. Tên đầy đủ vẫn đọc được qua phần mở rộng và bàn phím, kể cả khi dòng tóm tắt bị rút gọn.

### 4.3. Bộ chọn quảng cáo

- Khi có một quảng cáo, chỉ hiện “Quảng cáo 1” và “Thêm quảng cáo”.
- Khi có nhiều quảng cáo, hiện danh sách thumbnail, tên nội bộ và trạng thái nội dung của từng quảng cáo.
- Khi bản nháp cũ có nhiều nhóm, thêm bộ chọn “Nhóm đang sửa”. Không tự gộp nhóm hoặc thay ngân sách.
- “Thêm quảng cáo” tạo media và văn bản trống; lấy bản chụp tiêu đề và Messenger của quảng cáo đang chọn trong nhóm. Nếu chưa có quảng cáo nguồn thì dùng snapshot mẫu của chiến dịch. Hiển thị “Kế thừa thiết lập từ …” với tên quảng cáo hoặc mẫu tương ứng.
- Việc kế thừa không tạo liên kết tự cập nhật giữa hai quảng cáo. Giữ dấu “Đã chỉnh riêng” cho tiêu đề/Messenger nếu quảng cáo nguồn đã chỉnh riêng; các tên của quảng cáo mới vẫn tự sinh.
- Thêm quảng cáo trong cùng nhóm không nhân ngân sách của nhóm đó.
- Chuyển quảng cáo giữ nguyên văn bản, tiến độ upload và vị trí soạn của từng quảng cáo.

### 4.4. Card media

Nhãn: “Ảnh hoặc video”. Hỗ trợ chọn file và kéo thả. Sau khi chọn, hiển thị preview, tên file, loại file, dung lượng, tiến độ upload và hành động “Thay tệp”.

Giới hạn dùng chung với uploader hiện tại: JPG, PNG, WebP, MP4, MOV; tối đa 500 MB/file. Thông báo frontend phải dùng cùng quy tắc với backend, kể cả khi giới hạn thay đổi.

- Chỉ bắt đầu upload khi đã có phiên Meta và tài khoản quảng cáo phù hợp.
- Trước đó vẫn cho nhập văn bản; card media có hướng dẫn tới phần kết nối/chọn mẫu còn thiếu.
- Upload lỗi giữ nguyên văn bản và file nguồn còn trong phiên để thử lại.
- Khi thay media, chỉ thay media đã lưu sau khi file mới upload thành công. Nếu lỗi, preview cũ vẫn còn.
- Nhiều file thả vào ở phiên bản đầu: báo “Mỗi quảng cáo dùng một ảnh hoặc video. Hãy chọn một tệp”, không lấy ngẫu nhiên một file.
- Kết quả upload phải gắn với đúng quảng cáo, tài khoản và lượt upload; kết quả cũ không được ghi đè file vừa thay.

### 4.5. Card nội dung

Nhãn: “Văn bản chính”. Một textarea nhiều dòng, có preview cập nhật theo nội dung nhập. Không tự viết lại, thêm ưu đãi hay thay đổi câu chữ của người dùng.

Ngay bên dưới có dòng “Tiêu đề: … · Theo mẫu” và nút “Sửa tiêu đề”. Tiêu đề là nội dung khách hàng nhìn thấy, khác với tên quảng cáo nội bộ. Phiên bản đầu lấy tiêu đề đã được lưu trong mẫu; không tự cắt câu đầu của văn bản để làm tiêu đề.

Nếu mẫu cũ thiếu tiêu đề, mở trường bổ sung ngay tại đây và cho lưu về mẫu nếu người dùng chọn. Sau khi bổ sung một lần, các lượt mới tiếp tục có trải nghiệm hai trường.

### 4.6. Preview và hành động chính

Preview lấy trực tiếp Page, media, văn bản, tiêu đề và CTA của quảng cáo đang chọn. Có “Xem cuộc trò chuyện” để kiểm tra lời chào và nút Messenger trong phần mở rộng.

Giai đoạn soạn chỉ có một CTA nổi bật: “Xem lại”. Không hiển thị phần trăm hoàn thiện của hàng chục trường ẩn như nhiệm vụ người dùng phải tự điền. Chỉ hiện số quảng cáo sẵn sàng và các lỗi đang cần xử lý.

## 5. Thiết lập mẫu dùng chung một lần

Tên hiển thị trong sản phẩm: **Mẫu tạo nhanh**. Mẫu có thể đại diện cho một dịch vụ/Page thường dùng.

| Nhóm | Thông tin lưu | Cách dùng lần sau |
| --- | --- | --- |
| Nhận diện | Tên mẫu, nhân viên/mã người tạo, tên dịch vụ | Hiển thị mẫu và tự sinh tên chiến dịch |
| Tài nguyên | Tài khoản quảng cáo, Page | Tự chọn đúng tài nguyên còn khả dụng |
| Ngân sách | Cấp ngân sách, số tiền, tiền tệ | Điền cho chiến dịch hoặc nhóm mới |
| Đối tượng | Snapshot thiết lập, tên/ID mẫu nguồn | Điền vị trí, tuổi và các giới hạn đang được hỗ trợ |
| Lịch chạy | Bắt đầu sau khi tạo hoặc quy tắc thời gian tương đối đã chọn | Tính ngày giờ cho lượt mới, không dùng lại mốc cũ |
| Nội dung | Tiêu đề mặc định | Điền vào quảng cáo mới |
| Messenger | Mẫu nguồn và snapshot lời chào, các nút | Điền nội dung hội thoại |
| Seeding | Mẫu nguồn và snapshot cấu hình | Kế thừa theo yêu cầu hiện hành của ứng dụng |
| Tên nội bộ | Quy tắc Campaign / Ad Set / Ad | Sinh tên mà không cần nhập lại |

Editor mẫu có các nhóm thu gọn; tận dụng bộ chọn và trình chỉnh sửa đang có. Có hai cách bắt đầu: “Tạo mẫu mới” hoặc “Lưu thiết lập chiến dịch này thành mẫu”. Không lưu ảnh/video và văn bản quảng cáo vào mẫu dùng chung trong phiên bản đầu.

Hành động kết thúc: “Lưu mẫu và sử dụng”, kèm lựa chọn “Dùng mặc định cho lượt mới” có trạng thái rõ ràng. Mặc định áp dụng cho người dùng đang kết nối và có thể đổi trong bộ chọn mẫu.

Một mẫu chỉ được ghi nhãn “Sẵn sàng tạo nhanh” khi đủ các trường trên và tài nguyên/mẫu liên kết đã kiểm tra thành công. Mẫu chưa đủ vẫn lưu được ở trạng thái “Cần bổ sung”; không giả lập giá trị để biến nó thành hợp lệ.

## 6. Tự sinh tên và bảo toàn chỉnh sửa

### 6.1. Quy tắc tên

Tên nội bộ không nằm trong các trường bắt buộc trên màn Tạo nhanh. Hệ thống vẫn ghi giá trị tên thật vào bản nháp để validation và payload sử dụng.

| Cấp | Quy tắc đề xuất | Ví dụ minh họa |
| --- | --- | --- |
| Campaign | `{nhân_viên}_{dịch_vụ}_Messenger_{mã_Page}_{khu_vực}_{ngày}` | `Đức_Dịch vụ A_Messenger_LGCL_Hồ Chí Minh_08/09/2026` |
| Ad Set | `{nhãn_đối_tượng} · Nhóm {số_thứ_tự}` | `HCM · Nữ 25–45 · Nhóm 01` |
| Ad | `{tên_file_không_đuôi} · {số_thứ_tự}` | `video-dich-vu-a · 01` |

Mẫu Campaign giữ cách phân đoạn bằng dấu `_` mà báo cáo hiện tại dùng: đoạn đầu là nhân viên, phần giữa là dịch vụ, bốn đoạn cuối là mục tiêu/kênh, mã Page, khu vực và ngày. Không tự nối thêm một đoạn `_` thứ bảy ở cuối vì sẽ làm sai cách đọc dịch vụ trong lịch sử.

Các quy tắc cụ thể:

- Nếu mẫu đang có tên cố định hợp lệ, cho dùng tên đó nguyên trạng trước khi người dùng thiết lập quy tắc động.
- Trường nhận diện nhân viên không tự suy đoán từ tên đăng nhập; người dùng xác định một lần trong mẫu.
- Không nhận dấu `_` trong trường nhân viên và bốn trường cố định cuối tên Campaign; editor mẫu hướng dẫn dùng khoảng trắng hoặc dấu `-` để giữ đúng phân đoạn báo cáo. Tên dịch vụ được phép có `_` theo quy tắc đọc báo cáo hiện hành. Không chuẩn hóa lại tên của bản nháp cũ đã có.
- Với tên Ad chưa có file, dùng tên tạm `Quảng cáo 01`, cập nhật từ tên file khi chọn file thành công nếu tên còn ở chế độ tự động.
- Chỉ lấy basename, bỏ phần mở rộng và ký tự điều khiển; không đưa đường dẫn máy tính vào tên gửi đi.
- Không xóa dấu tiếng Việt. Chuẩn hóa khoảng trắng và giới hạn chiều dài theo hợp đồng dữ liệu.
- Ngày dùng múi giờ đã cấu hình; tạo và lưu cùng bản nháp, không đổi mỗi lần render, reload hoặc retry.
- Số thứ tự được giữ ổn định khi xóa/thêm một quảng cáo khác. `clientId` là định danh thao tác; tên không dùng làm khóa chống trùng.
- Tên trùng giữa hai lượt không phải lý do tự nhân chiến dịch hoặc đổi định danh. Có thể phân biệt lượt bằng thời gian tạo trong lịch sử.

### 6.2. Chỉnh tay và chế độ tên

Mỗi trường tên có trạng thái “Tự động” hoặc “Đã chỉnh riêng”. Người dùng sửa trong Thiết lập chi tiết thì chuyển sang chỉnh riêng, không bị mẫu hay file mới ghi đè. “Dùng tên tự động” chỉ đặt lại trường tên tương ứng và hiện trước kết quả.

Với bản nháp cũ, mọi tên không rỗng được coi là chỉnh riêng; tên trống mới được tự bổ sung khi người dùng vào Tạo nhanh. Lịch sử và chiến dịch đã gửi không bị đổi tên.

Đặc tả này thay yêu cầu nhập tên bằng tay đối với chế độ Tạo nhanh; vẫn giữ điều kiện tên không rỗng của validation. Hành vi nhân bản trong chế độ chi tiết tiếp tục theo quy tắc hiện có.

## 7. Đổi mẫu, sửa thiết lập và ưu tiên dữ liệu

Ưu tiên khi khôi phục/hiển thị: **chỉnh sửa riêng trong bản nháp → snapshot đã áp dụng → mẫu mặc định cho bản nháp mới**. Đọc lại thư viện không phải một hành động áp dụng mẫu.

Với bản nháp cũ chưa có metadata nguồn, coi các thiết lập hiện hữu như tài khoản, Page, ngân sách, đối tượng, lịch, tiêu đề và Messenger là “Đã chỉnh riêng”. Chỉ bổ sung trường thực sự thiếu; `false` hoặc mảng rỗng hợp lệ không được coi là dữ liệu bị mất. Người dùng có thể chủ động đặt lại từng nhóm trường theo mẫu trong phần xem trước thay đổi.

“Đổi mẫu” mở bộ chọn có thể tìm kiếm; mỗi lựa chọn hiển thị tên, Page, tài khoản và ngân sách. Sau khi chọn, hiển thị ngay phần tóm tắt thiết lập sẽ đổi và nút “Áp dụng cho chiến dịch này”. Đây là thao tác đổi cấu hình chủ động, không xuất hiện mỗi lần tạo thông thường.

- Luôn giữ văn bản và media đang soạn nếu còn tương thích.
- Mặc định giữ các trường đã chỉnh riêng, bao gồm tên và tiêu đề; nêu rõ các ngoại lệ đó trong tóm tắt. Có lựa chọn đặt lại theo mẫu nếu cần.
- Bản nháp nhiều nhóm: áp dụng thiết lập dùng chung cho cả chiến dịch, chỉ cập nhật các trường còn theo mẫu; liệt kê số nhóm/quảng cáo bị tác động. Không tự xóa hay tạo nhóm.
- Đổi tài khoản có thể làm media hoặc Custom Audience mất tương thích. Trước khi áp dụng phải liệt kê phần cần tải/chọn lại; giữ lại nội dung và tham chiếu cũ để người dùng khôi phục, không âm thầm xóa.
- Mẫu bị xóa hoặc mất quyền: giữ snapshot bản nháp, đánh dấu phần cần kiểm tra/chọn lại; không tự chuyển sang mẫu khác hoặc tài khoản khác.
- Sửa một trường chỉ ảnh hưởng bản nháp hiện tại. “Cập nhật mẫu” là hành động riêng, có thể thấy rõ trường nào được lưu lại.
- Cập nhật mẫu chỉ ảnh hưởng lần áp dụng tiếp theo; không đẩy thay đổi sang các bản nháp khác đang mở.

## 8. Luồng thao tác

### A. Lần đầu chưa có mẫu

1. Mở Tạo nhanh, kết nối Meta nếu cần.
2. Tạo mẫu hoặc lấy thiết lập từ chiến dịch đang có; bổ sung phần còn thiếu.
3. Lưu và chọn mẫu mặc định nếu muốn.
4. Trở về vùng media + văn bản, giữ nguyên nội dung đã nhập trước đó.
5. Thêm media, nhập văn bản, xem lại và tạo.

### B. Những lần sau, mẫu hợp lệ

1. Mở Tạo nhanh: mẫu mặc định và một quảng cáo trống đã sẵn sàng.
2. Chọn ảnh/video, nhập văn bản. Tên ba cấp, tiêu đề và hội thoại đã được điền.
3. Nhấn “Xem lại”.
4. Đọc tóm tắt và nhấn “Tạo N quảng cáo”.

### C. Thêm quảng cáo trong lượt đang soạn

1. Nhấn “Thêm quảng cáo”.
2. Điền media và văn bản cho quảng cáo mới.
3. Dùng bộ chọn để kiểm tra/chỉnh từng quảng cáo; ngân sách tổng chỉ đổi khi cấu hình ngân sách thực sự đổi.

### D. Chỉnh một thiết lập đặc biệt

1. Nhấn thông tin cần đổi hoặc “Thiết lập chi tiết”.
2. Mở đúng phần Campaign, nhóm, quảng cáo hoặc Messenger với trạng thái hiện có.
3. Trở về Tạo nhanh: cùng bản nháp, cùng quảng cáo, các chỉnh sửa được giữ nguyên.

### E. Sau khi tạo

Hiện kết quả lượt tạo đang có, tiến độ và liên kết lịch sử. “Tạo lượt tiếp theo” tạo bản nháp mới với mẫu đang dùng và các trường media/văn bản trống. Không tự sao chép hoặc gửi lại lượt vừa tạo.

## 9. Xem lại và tạo quảng cáo

Màn “Xem lại” thể hiện:

- Tên và phạm vi chiến dịch đang tạo; số nhóm, số quảng cáo.
- Page và tài khoản quảng cáo.
- Ngân sách hiệu lực, cấp ngân sách, tiền tệ và lịch chạy.
- Đối tượng của từng nhóm; preview hoặc danh sách thumbnail của các quảng cáo.
- Tiêu đề, mẫu Messenger và mẫu seeding đang dùng.
- Dòng “Sau khi tạo: Bật” theo trạng thái `ACTIVE` hiện tại của ứng dụng.

Tên ba cấp có trong phần “Chi tiết tên” để xem nhanh, không trở thành bước nhập bắt buộc. CTA soạn là “Xem lại”; CTA gửi thực sự là “Tạo N quảng cáo”. Tận dụng bước xác nhận đang có, tránh xếp hai hộp thoại xác nhận trùng nội dung.

Phạm vi phải thống nhất: kiểm tra, gửi, hiển thị tiến độ, phục hồi run và đánh dấu đã gửi đều chỉ áp dụng cho chiến dịch đang xem lại. Bản nháp chiến dịch khác không được tính vào số quảng cáo, báo lỗi hoặc bị dọn khỏi lưu trữ của lượt này.

Nếu chiến dịch đang mở có nhiều nhóm/quảng cáo từ bản nháp cũ, phải kiểm tra đủ toàn bộ chúng. Lỗi ở quảng cáo khác hiện tên và nút mở đúng quảng cáo đó. Không tự bỏ quảng cáo lỗi khỏi lượt tạo.

Mọi thay đổi sau khi xem lại làm kết quả kiểm tra hết hiệu lực. Trong khi gửi, khóa chỉnh sửa các đối tượng của lượt đó và khóa gửi lặp. Nếu mất kết nối sau khi đã có run, hiển thị “Đang khôi phục trạng thái lượt tạo”; không chuyển thành nút tạo mới cho cùng nội dung.

## 10. Trạng thái và thông báo frontend

| Trạng thái | Hiển thị | Hành động |
| --- | --- | --- |
| Đang tải dữ liệu | Skeleton tại thanh mẫu, giữ nội dung đang soạn | Chờ dữ liệu; khóa áp dụng mẫu/gửi |
| Chưa kết nối Meta | “Kết nối Meta để tải mẫu và tài nguyên của anh” | Kết nối; vẫn giữ phần văn bản |
| Chưa có mẫu | Lời dẫn thiết lập một lần | Tạo mẫu hoặc lấy từ chiến dịch hiện có |
| Mẫu cần bổ sung | “Mẫu này thiếu: …” với danh sách cụ thể | Mở đúng phần thiếu |
| Tài nguyên không còn dùng được | Tên Page/tài khoản và nguyên nhân nếu có | Kết nối lại hoặc chọn tài nguyên khác |
| Thiếu media/văn bản | Gợi ý cạnh trường; báo lỗi khi chọn Xem lại | Đưa focus tới trường thiếu đầu tiên |
| Đang upload | Phần trăm và file đang tải | Cho nhập văn bản; khóa gửi |
| Upload lỗi | Lỗi trong card media | Thử lại hoặc chọn file khác |
| Đã đủ nội dung | “N/N quảng cáo đủ nội dung” | Xem lại để kiểm tra toàn bộ cấu hình |
| Lỗi trường đang ẩn | Tóm tắt lỗi có đường dẫn sửa | Mở drawer/chi tiết và focus đúng trường |
| Không lưu được nháp | “Chưa lưu được trên trình duyệt này” | Giữ nội dung trong phiên; thử lưu lại |
| Đang tạo | Tiến độ lượt tạo và số quảng cáo | Không gửi lại |
| Có quảng cáo thất bại | Kết quả riêng từng quảng cáo, phần đã thành công vẫn rõ | Dùng hành động phục hồi/thử lại hiện có |

Không hiển thị lỗi bắt buộc trong lúc người dùng vừa bắt đầu gõ. Kiểm tra khi rời trường hoặc chọn Xem lại. Các lỗi từ server là nguồn kết luận cuối cùng; lỗi tải validation không được diễn giải thành kiểm tra thành công.

## 11. Quy cách thị giác, responsive và khả năng truy cập

Kế thừa giao diện Launch Control đã được chọn: nền xám sáng, card trắng, xanh dương cho hành động chính, bo góc 12px, icon SVG cùng bộ, font Be Vietnam Pro/Inter. Nguồn token là `launch-concept.css` và adapter hiện tại; không quay lại bộ font hoặc màu của bản giao diện cũ.

| Kích thước | Bố cục |
| --- | --- |
| Từ 1280px | Nav rail hiện có; vùng soạn co giãn + preview khoảng 320px; media và văn bản chia hai cột |
| 821–1279px | Thu preview thành vùng mở theo yêu cầu khi không đủ chiều rộng; ưu tiên văn bản và media |
| 681–820px | Vùng soạn một cột khi cần; bộ chọn cấu trúc trong drawer; tóm tắt mẫu được xuống dòng |
| 320–680px | Media, văn bản, tiêu đề xếp dọc; điều hướng dưới; preview và thiết lập mở toàn chiều rộng |

Vùng nhập chính không nhỏ hơn 16px trên mobile; nhãn và nội dung phụ không nhỏ hơn 12px. Nút thao tác cảm ứng tối thiểu 44×44px. Thanh CTA có thể cố định nếu đã dành đủ khoảng trống cho nội dung và safe area; bàn phím ảo không che trường đang nhập.

Giữ focus khi cập nhật preview và khi đóng drawer. Dropdown hỗ trợ tìm kiếm, mũi tên, Enter và Escape; không bị cắt bởi container cuộn. Nút chỉ có icon phải có nhãn truy cập. Toast lưu nháp/thông báo trạng thái dùng thông báo lịch sự, không giành focus. Drawer/modal khóa focus trong nội dung đang mở và trả về nút gọi khi đóng.

Không dùng màu làm tín hiệu duy nhất. Hỗ trợ light/dark, tăng cỡ chữ và `prefers-reduced-motion`. Kiểm tra ở 375px, tablet, desktop và điện thoại xoay ngang; không có cuộn ngang toàn trang.

## 12. Hợp đồng trạng thái và thành phần frontend

### 12.1. Nguồn dữ liệu

`state.draft` tiếp tục là nguồn bản nháp duy nhất. Tạo nhanh chỉ bổ sung trạng thái hiển thị và metadata về nguồn giá trị; không giữ một bản campaign riêng rồi đồng bộ hai chiều.

| Thành phần đề xuất | Trách nhiệm |
| --- | --- |
| `QuickCreateWorkspace` | Xác định campaign/group/ad đang soạn, điều phối các card |
| `QuickPresetBar` | Chọn mẫu và tóm tắt Page, tài khoản, đối tượng, ngân sách |
| `QuickAdSelector` | Chọn quảng cáo/nhóm, thêm quảng cáo mới |
| `QuickCreativeEditor` | Media + văn bản; tái sử dụng uploader và handler hiện có |
| `QuickSetupDrawer` | Chỉnh thiết lập cần thiết, dẫn sang editor đầy đủ |
| `QuickAdPreview` | Hiển thị dữ liệu thật của quảng cáo đang chọn |
| `QuickReview` | Tóm tắt, kiểm tra và xác nhận phạm vi lượt tạo |
| `QuickPresetEditor` | Tạo/sửa mẫu dùng lại và lựa chọn mặc định |

Metadata cần có: chế độ nhanh/chi tiết, mẫu được áp dụng và phiên bản, các trường chỉnh riêng, chế độ tên từng node, ngày tạo và số thứ tự ổn định, campaign thuộc phạm vi review. Không đưa metadata giao diện vào payload Meta.

Lưu nháp và mẫu mặc định phải theo người dùng đang kết nối. Tải lại khôi phục lựa chọn, nội dung và media có tham chiếu bền vững. File chưa upload chỉ còn trong bộ nhớ thì sau reload phải báo chọn lại; không coi blob URL cũ là media hợp lệ. Khi đổi người dùng, không áp dụng mẫu hoặc bản nháp của người trước.

### 12.2. Phần có thể tái sử dụng và phần phải mở rộng

| Hiện trạng đã kiểm tra | Yêu cầu của thiết kế |
| --- | --- |
| Preset hiện áp dụng tên Campaign/Ad Set, đối tượng, Messenger và seeding | Mở rộng để chứa tài khoản, Page, ngân sách, tiêu đề, lịch và quy tắc tên |
| Schema preset hiện chỉ nhận một tập trường xác định | Cần hợp đồng phiên bản mới và tương thích mẫu cũ; chỉ thêm trường frontend sẽ không đủ để lưu bền vững |
| Tên và headline bắt buộc ở validator hiện tại | Điền giá trị thật trước kiểm tra; không bỏ validation để làm giao diện có vẻ hoàn tất |
| Seeding đang là điều kiện bắt buộc của luồng hiện hành | Mẫu tạo nhanh phải đáp ứng; biến seeding thành tùy chọn là quyết định sản phẩm riêng |
| Hàm đổi tài khoản hiện có thể xóa dữ liệu media trong nhánh | Cần bước đánh giá tương thích và giữ dữ liệu phục hồi trước khi áp dụng từ Tạo nhanh |
| Validation/publish hiện lấy toàn bộ draft | Cần xây phạm vi campaign đang review và truyền cùng phạm vi qua mọi bước |
| `markSubmitted` hiện đánh dấu tất cả campaign trong state | Phải nhận đúng danh sách campaign đã gửi; không loại bản nháp khác khỏi lưu trữ |
| Báo cáo suy ra nhân viên/dịch vụ từ tên Campaign | Tên tự sinh phải tương thích; dùng kiểm thử trích xuất hiện có làm chuẩn |

Đây là đặc tả frontend có các phụ thuộc dữ liệu được chỉ rõ. Khi triển khai, chức năng lưu mẫu hoàn chỉnh và phạm vi tạo cần được nối với các phần xử lý tương ứng trước khi gọi là hoàn tất.

Các nguồn mã đã đối chiếu: `public/launch-preview.js`, `public/workspace.js`, `public/app.js`, `public/state.js`, `public/workspace-progress.js`, `public/draft-storage.js`, `public/activity-history.js`, `src/campaign-preset.js`, `src/draft.js` và `test/activity-history.test.js`.

## 13. Tiêu chí nghiệm thu

1. Người dùng có mẫu hợp lệ tạo được bản nháp đủ trường bằng media + văn bản, không nhập tên hay mở editor ba cấp.
2. Người chưa có mẫu được dẫn qua thiết lập một lần; lần tiếp theo áp dụng đúng mẫu đã chọn mặc định.
3. Mẫu cũ thiếu thông tin được đánh dấu rõ; không tự lấy tài khoản đầu tiên, ngân sách đoán hoặc tiêu đề tự viết.
4. Tên Campaign tự sinh vẫn cho ra đúng nhân viên và dịch vụ trong báo cáo; reload/retry không đổi tên hoặc số thứ tự.
5. Tên/tiêu đề chỉnh tay không bị đổi khi render, đổi media hoặc tải lại mẫu; có hành động dùng lại giá trị tự động.
6. Thêm quảng cáo giữ đúng một nhóm hiện hành và không làm tăng ngân sách nhóm.
7. Chuyển quảng cáo, Tạo nhanh/Chi tiết, đóng drawer và reload giữ đúng bản nháp; draft cũ nhiều nhóm không bị biến đổi cấu trúc.
8. Đổi mẫu giữ media/văn bản tương thích; đổi tài khoản hiển thị các xung đột trước khi áp dụng.
9. Upload lỗi/thay file/chuyển nhóm hoặc đổi tài khoản trong lúc tải không gắn kết quả vào sai quảng cáo; giữ lại nội dung đã nhập.
10. Mẫu hoặc Page mất quyền dẫn đến hướng dẫn sửa đúng chỗ; không tự thay tài nguyên và không mất nội dung.
11. Review cho biết đúng Page, tài khoản, số quảng cáo, ngân sách, lịch và trạng thái sau tạo; sửa dữ liệu làm kết quả review hết hiệu lực.
12. Tạo chiến dịch A trong khi B là nháp chưa hoàn chỉnh chỉ kiểm tra/gửi A; B vẫn còn nguyên sau tạo thành công, lỗi và tải lại trang.
13. Click gửi lặp hoặc gián đoạn kết nối không tạo thêm lượt; phục hồi bám theo run đã có và cơ chế chống gửi trùng hiện hành.
14. Lỗi tại trường ẩn mở đúng phần/đúng quảng cáo, giữ focus và phần nội dung đang soạn.
15. Màn 375px và desktop hiển thị đủ thao tác; dropdown không bị cắt, CTA không che nội dung; dùng được bằng bàn phím, light/dark và reduced motion.

## 14. Thứ tự bàn giao đề xuất

1. Dựng màn Tạo nhanh trên dữ liệu nháp, bộ chọn quảng cáo, preview và chuyển qua lại Chi tiết.
2. Hoàn thiện mẫu dùng chung, quy tắc tên, ưu tiên chỉnh sửa và lưu nháp.
3. Nối review theo campaign, validation, upload, tiến độ, phục hồi và đánh dấu đã gửi đúng phạm vi.
4. Nghiệm thu happy path hai trường cùng các trường hợp trong mục 13; sau đó mới mở rộng chọn nhiều file.

Kết quả cần bàn giao là một màn hình soạn hai trường có dữ liệu thiết lập đầy đủ phía sau, cùng khả năng mở và kiểm tra mọi thiết lập khi cần.
