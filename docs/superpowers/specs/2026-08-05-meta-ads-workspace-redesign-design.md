# Thiết kế Workspace Meta Ads và Targeting thủ công

## Mục tiêu

Nâng cấp ứng dụng local hiện tại thành một workspace tạo quảng cáo có cấu trúc gần Meta Ads Manager, nhưng chỉ giữ các chức năng cần cho luồng quảng cáo **Cuộc trò chuyện trên Messenger**.

Người dùng phải có thể:

- Kết nối Meta và chọn tài khoản quảng cáo.
- Tạo nhiều Campaign; mỗi Campaign có nhiều Ad Set; mỗi Ad Set có nhiều Ad.
- Chọn chiến lược ngân sách ở cấp Campaign hoặc cấp Ad Set.
- Chọn Facebook Page riêng cho từng Ad Set từ các Page mà tài khoản quảng cáo được phép quảng bá.
- Chọn targeting thủ công gồm vị trí, tuổi, giới tính, Custom Audience bao gồm/loại trừ và nhắm mục tiêu chi tiết.
- Kiểm tra toàn bộ cấu hình trước khi gửi Meta.
- Tạo mọi đối tượng ở trạng thái `PAUSED`.

Ứng dụng không được tự kích hoạt quảng cáo và không tự đổi cấu hình targeting mà người dùng đã chọn.

## Phạm vi đã chốt

### Có trong lần nâng cấp

- Workspace ba cột.
- Messenger là vị trí chuyển đổi duy nhất.
- `OUTCOME_ENGAGEMENT` là objective duy nhất.
- `CONVERSATIONS` là optimization goal duy nhất, nhưng phải hiển thị rõ trong UI.
- Ngân sách theo ngày.
- Hai chiến lược ngân sách: Campaign Budget và Ad Set Budget.
- Facebook Page theo từng Ad Set.
- Advantage+ Audience tắt.
- Targeting vị trí, tuổi, giới tính.
- Custom Audience bao gồm và loại trừ.
- Tìm kiếm nhắm mục tiêu chi tiết theo sở thích, hành vi và nhân khẩu học khi Meta trả về loại dữ liệu tương ứng.
- Lịch bắt đầu và kết thúc tùy chọn ở Ad Set.
- Inline validation, bảng kiểm tra trước khi tạo và nhật ký theo từng node.

### Không có trong lần nâng cấp

- Instagram Direct hoặc WhatsApp.
- Lifetime budget.
- Campaign objective khác `OUTCOME_ENGAGEMENT`.
- Optimization goal khác `CONVERSATIONS`.
- Bật object sang `ACTIVE`.
- Chỉnh sửa hoặc xóa object đã tạo trên Meta.
- Insights, báo cáo, thanh toán hoặc tự động tối ưu ngân sách sau khi tạo.

## Bố cục giao diện

### Thanh trên cùng

Thanh trên cùng luôn hiển thị:

- Trạng thái kết nối Meta.
- Tài khoản quảng cáo đang chọn.
- Số lỗi chặn tạo.
- Nút **Kiểm tra & tạo ở PAUSED**.

Facebook Page không phải lựa chọn toàn cục. Page được chọn trong từng Ad Set vì các Ad Set có thể quảng bá Page khác nhau.

### Cột trái: cây đối tượng

Cột trái hiển thị cây:

`Campaign -> Ad Set -> Ad`.

Mỗi node có tên, trạng thái validation và thao tác thêm/xóa. Chọn node sẽ mở đúng trình chỉnh sửa ở cột giữa. Cây giữ nguyên vị trí cuộn và selection sau mỗi lần chỉnh sửa để người dùng không bị mất ngữ cảnh.

### Cột giữa: trình chỉnh sửa

Cột giữa có ba tab theo cấp đối tượng: **Chiến dịch**, **Nhóm quảng cáo**, **Quảng cáo**. Tab phù hợp với node đang chọn được kích hoạt tự động.

Các trường được chia thành section có thể thu gọn:

- Campaign: thông tin chung, hạng mục đặc biệt, chiến lược ngân sách.
- Ad Set: chuyển đổi và hiệu quả, ngân sách, lịch, đối tượng tùy chỉnh, nhắm mục tiêu chi tiết.
- Ad: nội dung, media và xem trước.

Validation xuất hiện cạnh trường lỗi khi blur hoặc khi người dùng bấm kiểm tra. Trường bị vô hiệu hóa phải có helper text giải thích lý do.

### Cột phải: kiểm tra thiết lập

Cột phải luôn hiển thị:

- Tóm tắt ngân sách đang nằm ở cấp nào.
- Page và quyền quảng bá của Ad Set đang chọn.
- Trạng thái Advantage+ Audience.
- Số Custom Audience bao gồm/loại trừ.
- Các lỗi chặn tạo và cảnh báo không chặn.
- Nút tạo ở trạng thái `PAUSED`.

Nút tạo bị khóa nếu còn lỗi chặn. Cảnh báo về quy mô đối tượng không tự sửa targeting và không chặn tạo trừ khi Meta yêu cầu trường bắt buộc.

### Responsive

- Từ `1200px`: hiển thị đủ ba cột.
- Từ `768px` đến `1199px`: cột kiểm tra chuyển thành drawer.
- Dưới `768px`: cây đối tượng chuyển thành drawer; editor dùng một cột; thanh hành động bám đáy.
- Mọi control tương tác có vùng bấm tối thiểu 44px, focus ring rõ và không phụ thuộc hover.

## Mô hình dữ liệu draft

```js
{
  adAccountId,
  campaigns: [{
    clientId,
    name,
    specialAdCategory,
    budgetStrategy: 'CAMPAIGN' | 'AD_SET',
    dailyBudget,
    adSets: [{
      clientId,
      name,
      pageId,
      conversionLocation: 'MESSAGING_APPS',
      destinationType: 'MESSENGER',
      optimizationGoal: 'CONVERSATIONS',
      dailyBudget,
      startTime,
      endTime,
      countries,
      ageMin,
      ageMax,
      genders,
      advantageAudienceEnabled: false,
      includedCustomAudienceIds,
      excludedCustomAudienceIds,
      detailedTargeting: [{
        id,
        name,
        targetingField
      }],
      ads: [{
        clientId,
        name,
        primaryText,
        headline,
        mediaId
      }]
    }]
  }]
}
```

`pageId` được chuyển từ cấp draft toàn cục xuống từng Ad Set. Publisher phải lấy Page của Ad Set hiện tại khi tạo `promoted_object` và Creative.

Các mảng Custom Audience chỉ lưu ID trong draft. Tên, subtype và trạng thái chỉ dùng để hiển thị từ resource cache; server không tin dữ liệu mô tả do client gửi.

## Quy tắc ngân sách

### Ngân sách chiến dịch

Khi `budgetStrategy === 'CAMPAIGN'`:

- `campaign.dailyBudget` là bắt buộc và phải lớn hơn 0.
- Campaign payload gửi `daily_budget` và `bid_strategy=LOWEST_COST_WITHOUT_CAP`.
- Ad Set không gửi `daily_budget` hoặc `bid_strategy`.
- Trường ngân sách tại tất cả Ad Set thuộc Campaign bị khóa trong UI.
- `is_adset_budget_sharing_enabled` không được dùng để thay cho Campaign Budget.

### Ngân sách nhóm quảng cáo

Khi `budgetStrategy === 'AD_SET'`:

- Campaign không gửi `daily_budget`.
- Campaign bắt buộc gửi `is_adset_budget_sharing_enabled=false`.
- Mỗi Ad Set bắt buộc gửi `daily_budget` và `bid_strategy=LOWEST_COST_WITHOUT_CAP`.
- Không được phép publish nếu bất kỳ Ad Set nào thiếu ngân sách hợp lệ.

Hai nhánh payload phải được test độc lập để ngăn hồi quy lỗi Meta `Code 100 / Subcode 4834011`.

## Tài nguyên Meta và quyền Page

### Tải Page theo tài khoản quảng cáo

Sau khi chọn ad account, server tải Page qua ad account bằng trường `promote_pages`, thay vì chỉ dùng `/me/accounts`.

Luồng resource:

1. OAuth hoàn tất và server tải danh sách ad account.
2. Client chọn `adAccountId`.
3. Client gọi endpoint resource theo ad account.
4. Server gọi Meta để lấy `promote_pages` và Custom Audience của ad account.
5. Client dùng danh sách Page này trong từng Ad Set.

Không yêu cầu người dùng có quyền Admin toàn phần trên Page. Tuy nhiên token phải có quyền quảng cáo phù hợp trên ad account và Page phải là business asset mà ad account được phép quảng bá. Nếu Page không xuất hiện trong `promote_pages`, ứng dụng không cho nhập ID thủ công để vượt quyền.

### OAuth và quyền ứng dụng

Giữ các quyền hiện tại:

- `ads_read`
- `ads_management`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`

Nếu Meta trả lỗi quyền hoặc App Review, UI hiển thị quyền bị thiếu và yêu cầu kết nối lại sau khi quyền được bổ sung. Ứng dụng không tuyên bố rằng Page admin là bắt buộc.

## Chuyển đổi và hiệu quả

Trong lần nâng cấp này, các trường được hiển thị nhưng khóa vào cấu hình đã duyệt:

- Vị trí chuyển đổi: `Ứng dụng nhắn tin`.
- Điểm đến: `Messenger`.
- Objective Campaign: `OUTCOME_ENGAGEMENT`.
- Optimization goal Ad Set: `CONVERSATIONS`.
- Billing event: `IMPRESSIONS`.
- CTA: `MESSAGE_PAGE` với `app_destination=MESSENGER`.

UI không hiển thị lựa chọn Instagram hoặc WhatsApp. Việc hiển thị rõ các trường cố định giúp người dùng hiểu payload thay vì ẩn preset trong code.

## Targeting thủ công

### Advantage+ Audience

`advantageAudienceEnabled` luôn là `false` trong phạm vi này. UI hiển thị trạng thái tắt và không cho bật. Payload targeting gửi `targeting_automation: { advantage_audience: 0 }`. Nếu API version đang cấu hình từ chối trường này hoặc Meta không cho phép tắt đối với ad account/hạng mục cụ thể, server trả lỗi có cấu trúc và không âm thầm bật lại.

### Vị trí, tuổi và giới tính

- Vị trí yêu cầu ít nhất một quốc gia.
- Tuổi nằm trong giới hạn Meta cho hạng mục đang chọn và `ageMin <= ageMax`.
- Giới tính dùng `[]` cho tất cả, `[1]` cho nam và `[2]` cho nữ.
- Hạng mục quảng cáo đặc biệt vẫn chịu validation của Meta; UI phải giữ lỗi và subcode đầy đủ nếu một targeting không được phép.

### Custom Audience

Server tải Custom Audience từ ad account hiện tại và trả tối thiểu `id`, `name`, `subtype` và delivery status nếu Meta cung cấp.

UI có hai bộ chọn độc lập:

- **Bao gồm:** người dùng phù hợp với ít nhất một Custom Audience đã chọn.
- **Loại trừ:** người dùng thuộc ít nhất một Custom Audience đã chọn.

Payload map sang:

- `targeting.custom_audiences = [{ id }]`
- `targeting.excluded_custom_audiences = [{ id }]`

Một audience không được đồng thời nằm trong cả hai danh sách. Nếu người dùng chuyển audience sang danh sách đối nghịch, UI gỡ nó khỏi danh sách cũ.

### Giới hạn hơn nữa

UI cung cấp tìm kiếm server-side cho:

- Sở thích.
- Hành vi.
- Nhân khẩu học.

Server làm proxy tới Meta Targeting Search và chỉ trả các trường hiển thị an toàn như `id`, `name`, `type`, `path` và audience size nếu có. Danh mục nào không được API version hiện tại hỗ trợ sẽ không xuất hiện trong UI.

Mỗi kết quả tìm kiếm phải mang `targetingField` do server xác định, ví dụ `interests`, `behaviors`, `life_events` hoặc `industries`. Builder nhóm các item theo `targetingField` trong một phần tử `flexible_spec`. Phiên bản đầu không tạo nhiều nhóm AND lồng nhau; UI luôn hiển thị logic nhóm mà payload thực sự sử dụng.

## Lịch Ad Set

- `startTime` và `endTime` là tùy chọn.
- Nếu có `endTime` thì phải có `startTime` và thời điểm kết thúc phải sau thời điểm bắt đầu.
- Giá trị được gửi dạng ISO 8601 với timezone rõ ràng.
- Không có lịch phân phối theo giờ trong tuần ở lần nâng cấp này.

## API nội bộ

### Resource discovery

- `GET /api/resources`: trạng thái kết nối và danh sách ad account.
- `GET /api/ad-account-resources?adAccountId=...`: Page trong `promote_pages` và Custom Audience.
- `GET /api/targeting-search?adAccountId=...&category=...&query=...`: proxy tìm targeting.

Mọi endpoint kiểm tra session, quyền sở hữu Meta connection và ad account ID trước khi gọi Graph API.

### Draft và publish

- `POST /api/drafts/validate`: validation đầy đủ và trả lỗi theo path.
- `POST /api/runs`: validate lại ở server, sau đó publish tuần tự theo cây.

Publisher tiếp tục quy tắc hiện tại:

- Campaign lỗi thì bỏ qua toàn bộ Ad Set và Ad con.
- Ad Set lỗi thì bỏ qua các Ad con của nó.
- Nhánh Campaign khác vẫn tiếp tục.
- Object đã tạo thành công không bị rollback và luôn ở `PAUSED`.

## Biên module

### Server

- `src/meta-client.js`: OAuth, resource discovery, targeting search và lệnh create Meta.
- `src/draft.js`: validation và mapping draft sang payload Campaign/Ad Set/Creative/Ad.
- `src/publisher.js`: orchestration theo cây và truyền `adSet.pageId` xuống Creative.
- `src/server.js`: route, session, ownership và response.

### Client

Tách `public/app.js` hiện tại thành các module ESM nhỏ:

- `public/app.js`: bootstrap và event wiring.
- `public/state.js`: draft state, selection và immutable update helpers.
- `public/api.js`: gọi endpoint và chuẩn hóa lỗi client.
- `public/workspace.js`: render cây, editor và review panel.

`public/app.css` giữ design tokens và layout; component selector phải theo class có nghĩa, không dùng inline style cho trạng thái nghiệp vụ.

## Xử lý lỗi

- Validation client giúp phản hồi nhanh nhưng server luôn validate lại.
- Lỗi field xuất hiện cạnh field và trong review panel.
- Lỗi Meta giữ `message`, `type`, `code`, `error_subcode` và `fbtrace_id`.
- Lỗi quyền Page phân biệt với Page không nằm trong `promote_pages`.
- Resource loading có trạng thái loading, empty và retry.
- Targeting search debounce, hủy kết quả cũ và không hiển thị kết quả của query đã lỗi thời.
- Nút publish khóa trong lúc run đang chạy để ngăn submit trùng.

## Kiểm thử

Triển khai theo TDD với các nhóm test sau:

1. Campaign Budget gửi `daily_budget`, không gửi budget ở Ad Set.
2. Ad Set Budget gửi `is_adset_budget_sharing_enabled=false` và budget ở từng Ad Set.
3. Validation chặn budget trống ở đúng cấp.
4. Page bắt buộc ở từng Ad Set và được dùng cho cả `promoted_object` lẫn Creative.
5. Gender map đúng `[]`, `[1]`, `[2]`.
6. Custom Audience map đúng include/exclude và không trùng hai phía.
7. Advantage+ Audience không bị bật âm thầm.
8. Detailed targeting map đúng nhóm OR duy nhất.
9. Lịch bắt đầu/kết thúc được validate và serialize đúng timezone.
10. Resource route chỉ trả Page và Custom Audience của ad account hợp lệ.
11. Publisher vẫn bỏ qua node con khi cha lỗi và tiếp tục nhánh độc lập.
12. Render test xác nhận ba cột, editor theo node và trạng thái disabled của budget.
13. Browser smoke test ở desktop, tablet và mobile; kiểm tra keyboard focus và lỗi inline.

Không gửi request tạo object thật trong test tự động. Manual smoke test chỉ chạy khi người dùng chủ động chọn tài khoản/Page thử nghiệm và xác nhận tạo object `PAUSED`.

## Tiêu chí hoàn thành

- Giao diện dùng workspace ba cột và không còn form cây dài lồng nhau.
- Có thể tạo nhiều Campaign, Ad Set và Ad mà vẫn xác định rõ node đang chỉnh.
- Hai chiến lược ngân sách tạo payload loại trừ lẫn nhau và không còn lỗi `4834011`.
- Page được tải theo ad account, chọn ở từng Ad Set và dùng nhất quán khi tạo Ad Set/Creative.
- Messenger và `CONVERSATIONS` hiển thị rõ.
- Advantage+ Audience tắt; targeting thủ công có vị trí, tuổi, giới tính, Custom Audience và giới hạn chi tiết hơn.
- Include/exclude Custom Audience hoạt động đúng logic “ít nhất một”.
- Review panel chặn publish khi còn lỗi bắt buộc.
- Tất cả test tự động vượt qua và mọi object tạo thật trong smoke test ở trạng thái `PAUSED`.

## Nguồn đối chiếu

- Meta official Marketing API Postman workspace: `https://www.postman.com/meta/facebook-marketing-api/overview`
- Page theo ad account qua `promote_pages`: `https://www.postman.com/meta/facebook-marketing-api/request/g9szuy9/get-fb-page-id`
- Targeting fields gồm `custom_audiences`, `excluded_custom_audiences` và `flexible_spec`: `https://www.postman.com/meta/facebook-marketing-api/request/i3u5n9r/getadsetdetailsforaccount`
