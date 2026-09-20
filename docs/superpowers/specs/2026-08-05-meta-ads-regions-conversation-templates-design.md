# Thiết kế nhắm mục tiêu tỉnh/thành và thư viện Cuộc trò chuyện

## Mục tiêu

Nâng cấp ứng dụng Meta Campaign Builder hiện tại để:

- Chọn được toàn bộ tỉnh/thành Việt Nam mà Meta đang hỗ trợ ở loại `region`.
- Chọn nhiều vị trí ở hai nhóm **Bao gồm** và **Loại trừ** trong từng Ad Set.
- Không còn dùng ô nhập mã quốc gia tự do cho nhu cầu chọn tỉnh/thành.
- Cấu hình **Cuộc trò chuyện** trong từng Ad thay vì chỉ hiển thị một preset Messenger bị khóa.
- Lưu nhiều mẫu Cuộc trò chuyện trong ứng dụng theo từng Facebook Page, chọn lại và đặt một mẫu mặc định.
- Dùng cùng một cấu trúc mẫu cho creative ảnh và video.
- Giữ nguyên quy tắc an toàn: mọi Campaign, Ad Set và Ad đều được tạo ở trạng thái `PAUSED`.

## Phạm vi đã duyệt

### Có trong lần nâng cấp

- Phạm vi quốc gia được khóa ở Việt Nam, mã `VN`.
- Người dùng chọn một trong hai chế độ: **Toàn Việt Nam** hoặc **Tỉnh/Thành phố đã chọn**.
- Tìm kiếm vị trí trực tiếp từ Meta Targeting Search với loại `region` và `country_code=VN`.
- Bao gồm nhiều tỉnh/thành.
- Loại trừ nhiều tỉnh/thành.
- Không cho cùng một vị trí xuất hiện đồng thời trong cả Bao gồm và Loại trừ.
- Lưu mẫu Cuộc trò chuyện trong SQLite của ứng dụng, phân tách theo người dùng Meta và Facebook Page.
- Tạo, sửa, nhân bản, xóa và đặt mẫu mặc định.
- Mỗi Ad chọn một mẫu đã lưu hoặc chỉnh một bản sao riêng.
- Trình tạo mẫu gồm lời chào, câu trả lời nhanh, hiển thị số điện thoại doanh nghiệp và hành động của khách hàng.
- Xem trước mẫu ngay trong editor của Ad.
- Publisher gửi `page_welcome_message` trong `object_story_spec` của creative.

### Không có trong lần nâng cấp

- Không hard-code danh sách tỉnh/thành Việt Nam trong source code.
- Không hỗ trợ quốc gia khác Việt Nam.
- Không hỗ trợ quận/huyện, phường/xã, mã bưu chính hoặc ghim bán kính.
- Không đồng bộ mẫu local vào mục **Mẫu đã lưu** gốc của Ads Manager.
- Không dùng Partner App Welcome Message Flow trong lần này.
- Không tự sửa mẫu nếu Meta từ chối một trường.
- Không tự kích hoạt quảng cáo.

## Dữ liệu Meta đã xác minh

Kiểm tra read-only bằng token Meta hiện đang kết nối cho thấy:

- `Thành phố Hồ Chí Minh` được Meta trả về với `key="3984"`, `type="region"`, `country_code="VN"`.
- `Nghệ An` được Meta trả về với `key="3998"`, `type="region"`, `country_code="VN"`.
- Creative Messenger đang tồn tại trong ad account có `page_welcome_message` ở `object_story_spec.video_data.page_welcome_message`.
- Mẫu hiện hành dùng định dạng `VISUAL_EDITOR`, `version=2`, `landing_screen_type="welcome_message"` và `surface="visual_editor_new"`.

Các key địa lý không được coi là hằng số toàn cục. Ứng dụng luôn lưu key Meta trả về tại thời điểm người dùng chọn và luôn dùng Targeting Search để tìm mới.

## Trải nghiệm nhắm mục tiêu vị trí

### Bố cục trong Ad Set

Section **Vị trí** thay ô nhập Quốc gia hiện tại bằng:

1. Trường khóa **Quốc gia: Việt Nam**.
2. Bộ chọn phạm vi **Toàn Việt Nam** hoặc **Tỉnh/Thành phố đã chọn**.
3. Ô tìm kiếm tỉnh/thành khi dùng chế độ Tỉnh/Thành phố.
4. Hai tab hoặc hai cột:
   - **Bao gồm**.
   - **Loại trừ**.
5. Danh sách chip đã chọn ở mỗi phía.

Kết quả tìm kiếm hiển thị tối thiểu:

- Tên tỉnh/thành.
- Nhãn `Tỉnh/Thành phố` thay cho chữ `Bang` khó hiểu trong giao diện tiếng Việt.
- Quốc gia `Việt Nam`.

Tìm kiếm bắt đầu sau khi người dùng nhập tối thiểu hai ký tự, debounce 250 ms và bỏ qua phản hồi cũ nếu có truy vấn mới hơn.

### Quy tắc tương tác

- Chế độ `COUNTRY` gửi toàn Việt Nam và vẫn cho phép loại trừ các tỉnh/thành cụ thể.
- Chế độ `REGIONS` chỉ nhắm các tỉnh/thành nằm trong `includedRegions`.
- Chọn kết quả khi đang ở tab Bao gồm sẽ chuyển sang chế độ `REGIONS` và thêm vị trí vào `includedRegions`.
- Chọn kết quả khi đang ở tab Loại trừ sẽ thêm vị trí vào `excludedRegions`.
- Nếu vị trí đã nằm ở phía đối nghịch, thao tác mới sẽ chuyển vị trí sang phía đang chọn.
- Mỗi key chỉ xuất hiện một lần trong một danh sách.
- Người dùng có thể xóa từng chip.
- Chuyển sang **Toàn Việt Nam** phải xác nhận trước khi xóa danh sách Bao gồm đang chọn; danh sách Loại trừ được giữ lại.
- Ad Set ở chế độ `REGIONS` phải có ít nhất một vị trí Bao gồm.
- Lỗi tìm kiếm Meta không xóa các vị trí đã chọn.
- Khi đổi ad account, kết quả tìm kiếm tạm thời bị xóa nhưng draft vẫn giữ region đã chọn vì region key không phụ thuộc ad account.

### Payload targeting

Draft lưu vị trí theo dạng:

```js
{
  locationMode: 'REGIONS',
  includedRegions: [{
    key: '3984',
    name: 'Thành phố Hồ Chí Minh',
    type: 'region',
    countryCode: 'VN'
  }],
  excludedRegions: [{
    key: '3998',
    name: 'Nghệ An',
    type: 'region',
    countryCode: 'VN'
  }]
}
```

Publisher chỉ tin các trường cần cho payload và tạo:

```js
{
  geo_locations: {
    regions: [{ key: '3984' }]
  },
  excluded_geo_locations: {
    regions: [{ key: '3998' }]
  }
}
```

Khi `locationMode === 'COUNTRY'`, publisher tạo:

```js
{
  geo_locations: {
    countries: ['VN']
  },
  excluded_geo_locations: {
    regions: [{ key: '3998' }]
  }
}
```

`countries` và `regions` không được gửi đồng thời trong `geo_locations`, vì hai nhóm vị trí được Meta hợp theo logic mở rộng và có thể biến lựa chọn một tỉnh thành toàn Việt Nam.

`excluded_geo_locations` chỉ được gửi khi danh sách loại trừ không rỗng.

## Thư viện mẫu Cuộc trò chuyện

### Phạm vi dữ liệu

Mẫu được lưu theo cặp:

- Người dùng Meta đang kết nối.
- Facebook Page.

Một mẫu của Page A không xuất hiện khi Ad đang dùng Page B. Điều này tránh áp dụng nhầm lời chào, số điện thoại doanh nghiệp hoặc URL của một thương hiệu sang Page khác.

### Khả năng quản lý

Trong editor của Ad có section **Cuộc trò chuyện** với:

- Dropdown chọn mẫu đã lưu của Page hiện tại.
- Nút **Tạo mẫu**.
- Nút **Chỉnh sửa**.
- Nút **Nhân bản**.
- Nút **Lưu thành mẫu mới** khi Ad đang dùng bản tùy chỉnh.
- Nút **Đặt làm mặc định**.
- Nút **Xóa mẫu**, có xác nhận và không cho xóa mẫu đang là mặc định nếu chưa chọn mẫu mặc định khác.

Khi một Page chưa có mẫu, ứng dụng tạo một mẫu khởi đầu local với lời chào và ba câu hỏi gợi ý. Mẫu này chưa được gửi Meta cho đến khi người dùng bấm tạo Campaign.

### Mẫu mặc định và snapshot của Ad

- Mỗi Page có tối đa một mẫu mặc định.
- Khi tạo Ad mới, ứng dụng sao chép nội dung mẫu mặc định vào Ad.
- Khi người dùng chọn mẫu khác, ứng dụng sao chép nội dung mẫu đó vào Ad.
- Sau khi sao chép, Ad giữ một snapshot riêng.
- Chỉnh sửa mẫu trong thư viện không âm thầm thay đổi các Ad đã cấu hình.
- UI hiển thị trạng thái `Đã sửa từ mẫu` nếu snapshot của Ad khác mẫu nguồn.

Quy tắc snapshot giúp draft ổn định và tránh thay đổi hàng loạt quảng cáo ngoài ý muốn.

## Trình tạo Cuộc trò chuyện

### Trường dữ liệu

Mỗi template và snapshot của Ad có:

```js
{
  templateId,
  templateName,
  greeting,
  quickReplies: [{
    id,
    title,
    payload
  }],
  showBusinessPhoneNumber,
  businessPhoneNumber,
  customerActions: [{
    id,
    label,
    type: 'QUICK_REPLY' | 'OPEN_URL',
    value
  }]
}
```

### Quy tắc trường

- `templateName`: bắt buộc, tối đa 120 ký tự.
- `greeting`: bắt buộc, tối đa 1.000 ký tự.
- `quickReplies`: từ 1 đến 5 mục.
- Tiêu đề câu trả lời nhanh: bắt buộc và tối đa 80 ký tự trong app; publisher tiếp tục kiểm tra giới hạn Meta trước khi gửi.
- `payload`: được tạo ổn định từ ID local, không dùng trực tiếp nội dung người dùng làm payload.
- `showBusinessPhoneNumber`: boolean, mặc định `false`.
- `businessPhoneNumber`: bắt buộc khi bật hiển thị số điện thoại và phải là số hợp lệ có mã quốc gia, ví dụ `+84...`.
- `customerActions`: tối đa 5 mục.
- `OPEN_URL` yêu cầu URL tuyệt đối `https://`.
- Nhãn hành động bắt buộc và tối đa 20 ký tự.

Nếu Meta thay đổi giới hạn theo API version, server trả lỗi rõ ràng; ứng dụng không cắt chuỗi hoặc bỏ nút âm thầm.

### Xem trước

Preview hiển thị:

- Tên Page.
- Lời chào.
- Danh sách câu trả lời nhanh.
- Số điện thoại doanh nghiệp và hành động gọi nếu được bật.
- Các nút hành động và URL rút gọn để dễ kiểm tra.

Preview là mô phỏng phục vụ kiểm tra nội dung, không cam kết pixel-perfect với Messenger trên mọi thiết bị.

## Mô hình draft sau nâng cấp

Phần liên quan trong draft:

```js
{
  campaigns: [{
    adSets: [{
      pageId,
      locationMode: 'COUNTRY' | 'REGIONS',
      includedRegions,
      excludedRegions,
      ageMin,
      ageMax,
      genders,
      ads: [{
        clientId,
        name,
        primaryText,
        headline,
        mediaId,
        conversation: {
          sourceTemplateId,
          templateName,
          greeting,
          quickReplies,
          showBusinessPhoneNumber,
          businessPhoneNumber,
          customerActions
        }
      }]
    }]
  }]
}
```

Trường `countries=['VN']` cũ được migrate trong bộ tạo draft mới thành `locationMode='COUNTRY'` và `includedRegions=[]`. Draft đang mở trên trình duyệt trước khi nâng cấp không được persist nên không cần migration client lâu dài.

## Lưu trữ SQLite

Thêm bảng:

```sql
CREATE TABLE conversation_templates (
  id TEXT PRIMARY KEY,
  owner_meta_user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  name TEXT NOT NULL,
  template_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX conversation_templates_owner_page
ON conversation_templates (owner_meta_user_id, page_id);
```

Quy tắc database:

- Mọi truy vấn bắt buộc lọc `owner_meta_user_id` từ session; client không được truyền owner ID.
- `page_id` phải nằm trong `promote_pages` của ad account đang chọn trước khi tạo hoặc cập nhật mẫu.
- Đặt mặc định chạy trong transaction: bỏ mặc định cũ rồi đặt mẫu mới.
- `template_json` được parse và validate trước khi lưu.
- Xóa Page khỏi quyền truy cập không tự xóa template; template bị ẩn cho đến khi Page lại xuất hiện trong `promote_pages`.

## API nội bộ

### Tìm vị trí

`GET /api/location-search?adAccountId=...&query=...`

- Yêu cầu session Meta hợp lệ.
- Xác minh ad account thuộc danh sách tài khoản người dùng truy cập được.
- Proxy tới Meta `/search` với `type=adgeolocation`, `location_types=["region"]`, `country_code=VN`.
- Chỉ trả `key`, `name`, `type`, `countryCode`.
- Loại bỏ kết quả không phải `region` hoặc không thuộc `VN`.

### Quản lý template

- `GET /api/conversation-templates?pageId=...&adAccountId=...`
- `POST /api/conversation-templates`
- `PUT /api/conversation-templates/:id`
- `POST /api/conversation-templates/:id/duplicate`
- `POST /api/conversation-templates/:id/default`
- `DELETE /api/conversation-templates/:id`

Mọi route ghi chỉ thay đổi SQLite local. Không route nào tạo hoặc sửa object Meta.

## Serializer Meta

### Location serializer

`buildManualTargeting` chịu trách nhiệm:

- Gửi `countries: ['VN']` khi `locationMode === 'COUNTRY'`.
- Chỉ gửi `regions` từ `includedRegions` khi `locationMode === 'REGIONS'`.
- Không bao giờ gửi đồng thời `countries` và `regions` trong `geo_locations`.
- Gửi `excluded_geo_locations.regions` từ `excludedRegions`.
- Không gửi tên region trong payload tạo Ad Set; chỉ gửi key Meta.

### Conversation serializer

Tạo hàm thuần `buildPageWelcomeMessage(conversation)` trả về cấu trúc `VISUAL_EDITOR` version 2.

Creative ảnh đặt kết quả ở:

```js
object_story_spec.link_data.page_welcome_message
```

Creative video đặt kết quả ở:

```js
object_story_spec.video_data.page_welcome_message
```

Serializer map:

- `greeting` vào message text.
- `quickReplies` vào `message.quick_replies` với `content_type="text"`.
- Hành động URL vào generic template button phù hợp với định dạng Visual Editor.
- Hiển thị số điện thoại doanh nghiệp qua cấu hình phone/customer action của Visual Editor khi được bật.
- Các trường khung giữ đúng mẫu Meta đã xác minh: `type`, `version`, `landing_screen_type`, `media_type`, `surface`, `template_version`.

Phần mapping Visual Editor được cô lập trong một module riêng và có fixture test từ cấu trúc creative read-only đã quan sát. Không rải JSON Meta trực tiếp trong renderer hoặc publisher.

## Validation và lỗi

### Ad Set

Chặn tạo nếu:

- `locationMode` không phải `COUNTRY` hoặc `REGIONS`.
- Chế độ `REGIONS` không có vị trí Bao gồm.
- Có region không thuộc `VN`.
- Có item không phải `region`.
- Region key rỗng.
- Một key xuất hiện ở cả Bao gồm và Loại trừ.

### Ad và template

Chặn tạo nếu:

- Thiếu lời chào.
- Không có câu trả lời nhanh.
- Vượt số lượng hoặc giới hạn ký tự.
- Có hành động URL không dùng HTTPS.
- Có hành động thiếu nhãn hoặc giá trị.
- Bật hiển thị số điện thoại nhưng thiếu số hợp lệ.

### Lỗi Meta

- Giữ nguyên message, code, subcode và fbtrace ID.
- Đánh dấu đúng node Ad Set hoặc Ad thất bại.
- Không tự thử lại bằng cách bỏ location hoặc bỏ phần Cuộc trò chuyện.
- Descendant của node thất bại tiếp tục bị đánh dấu bỏ qua như luồng hiện tại.

## Trạng thái client và luồng dữ liệu

Thêm resource state:

```js
resources: {
  locationResults: [],
  conversationTemplates: []
}
```

Thêm UI state:

```js
ui: {
  locationSelectionSide: 'include' | 'exclude',
  locationQuery,
  searchingLocations,
  editingConversationTemplateId,
  conversationPreviewOpen
}
```

Luồng chính:

1. Người dùng chọn ad account.
2. App tải Page và Custom Audience như hiện tại.
3. Người dùng chọn Page cho Ad Set.
4. App tải template local của Page đó.
5. Nếu Ad chưa có conversation snapshot, app áp dụng template mặc định.
6. Người dùng tìm tỉnh/thành và cấu hình Bao gồm/Loại trừ.
7. Người dùng chọn hoặc chỉnh mẫu Cuộc trò chuyện ở từng Ad.
8. Validation server chạy trước khi nút tạo được mở.
9. Publisher tạo toàn bộ hierarchy ở `PAUSED`.

## Bảo mật và quyền

- Token Meta tiếp tục chỉ tồn tại mã hóa ở server.
- Targeting Search và kiểm tra Page đều chạy server-side.
- Template local không chứa access token.
- URL và text được escape khi render.
- Template API không cho đọc chéo người dùng Meta hoặc chéo Page.
- Chức năng local template không cần thêm quyền messaging ngoài bộ quyền Marketing API hiện tại.
- Nếu sau này đồng bộ Partner Flow sang Meta, đó là dự án riêng vì có thêm quyền, App Review và vòng đời flow.

## Kiểm thử

### Unit test

- Chuẩn hóa kết quả `adgeolocation` thành region Việt Nam.
- Bỏ kết quả sai loại hoặc sai quốc gia.
- Chuyển region giữa Bao gồm và Loại trừ.
- Ngăn region trùng.
- Serialize `geo_locations.regions` và `excluded_geo_locations.regions`.
- Validate thiếu region Bao gồm.
- CRUD template theo owner và Page.
- Chỉ một template mặc định trên mỗi Page.
- Snapshot Ad không đổi khi template nguồn được sửa.
- Serialize `page_welcome_message` cho ảnh và video.
- Validate greeting, quick reply, phone và customer action.

### Route test

- Location search yêu cầu session và ad account hợp lệ.
- Template route không cho truy cập chéo owner/Page.
- Route ghi template không gọi Meta write API.
- Publish bị chặn trước Campaign nếu location hoặc conversation không hợp lệ.

### Browser smoke test

- Tìm `Hồ Chí Minh` và `Nghệ An` trả đúng nhãn Tỉnh/Thành phố.
- Chọn Bao gồm/Loại trừ và chuyển qua lại.
- Tạo mẫu, đặt mặc định, tạo Ad mới và nhận snapshot.
- Chỉnh snapshot không làm thay đổi template nguồn.
- Preview hoạt động ở desktop, tablet và mobile.
- Publish button bị khóa khi còn lỗi.
- Không có horizontal overflow và mọi control chính có vùng bấm tối thiểu 44px.

### Live Meta verification

Không dùng chiến dịch đang chạy để thử. Khi cần xác minh serializer thật:

- Chỉ dùng ad account test hoặc ad account được người dùng chỉ định rõ.
- Yêu cầu xác nhận ngay trước thao tác ghi.
- Tạo object ở `PAUSED`.
- Ghi lại ID và kết quả theo từng node.
- Không tự xóa hoặc sửa object Meta sau khi thử nếu chưa được người dùng đồng ý.

## Tiêu chí hoàn thành

- Người dùng chọn được Hồ Chí Minh, Nghệ An và mọi region Việt Nam Meta trả về.
- **Toàn Việt Nam** map sang `countries=['VN']`; **Tỉnh/Thành phố đã chọn** map sang `regions`, không gửi đồng thời hai loại.
- Bao gồm và Loại trừ map đúng payload, không còn dùng tên tỉnh trong `countries`.
- Mỗi Facebook Page có thư viện mẫu riêng và một mẫu mặc định.
- Ad mới tự nhận snapshot từ mẫu mặc định.
- Creative ảnh và video đều chứa `page_welcome_message` hợp lệ.
- Invalid draft bị chặn trước khi tạo Campaign.
- Toàn bộ test cũ và test mới đều đạt.
- Server local chạy ổn định ở cổng cấu hình hiện tại.
- Không object nào được tạo ở trạng thái `ACTIVE`.
