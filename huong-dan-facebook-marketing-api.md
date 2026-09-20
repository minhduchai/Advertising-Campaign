# Giáo trình: Xây dựng phần mềm Set Ads Facebook tự động qua Marketing API

> Đối tượng: Học viên IT đã biết lập trình (JavaScript/Node.js), chưa biết Facebook Marketing API.
> Mục tiêu: Hiểu rõ cấu trúc quảng cáo Facebook và tự viết được phần mềm tạo quảng cáo tự động qua API.

---

## PHẦN 1: KIẾN TRÚC TỔNG QUAN

Facebook Ads có cấu trúc phân cấp 3 tầng, **bắt buộc phải hiểu rõ trước khi code**:

```
Campaign (Chiến dịch)
   └── Ad Set (Nhóm quảng cáo)          [có thể có nhiều Ad Set trong 1 Campaign]
         └── Ad (Quảng cáo)             [có thể có nhiều Ad trong 1 Ad Set]
               └── Ad Creative (Nội dung sáng tạo: ảnh/video/text)
```

| Tầng | Quyết định điều gì |
|---|---|
| **Campaign** | Mục tiêu chiến dịch (Objective), có bật CBO (ngân sách cấp chiến dịch) hay không |
| **Ad Set** | Đối tượng mục tiêu (audience), vị trí hiển thị (placement), ngân sách, lịch chạy, chuyển đổi tối ưu (optimization goal) |
| **Ad** | Nội dung hiển thị: ảnh/video, text, link, nút CTA |

Khi viết phần mềm, bạn sẽ gọi API theo đúng thứ tự: **tạo Campaign trước → lấy `campaign_id` → tạo Ad Set → lấy `adset_id` → tạo Creative → lấy `creative_id` → tạo Ad**.

---

## PHẦN 2: CHUẨN BỊ TRƯỚC KHI CODE

### 2.1. Các thành phần bắt buộc phải có

| Thành phần | Lấy ở đâu | Dùng để làm gì |
|---|---|---|
| **Facebook App** | developers.facebook.com → Tạo App loại "Business" | Cung cấp `App ID` và `App Secret` |
| **Business Manager** | business.facebook.com | Quản lý tài khoản quảng cáo, tài sản |
| **Ad Account ID** | Trong Business Manager, dạng `act_1234567890` | ID tài khoản quảng cáo cần thao tác |
| **Page ID** | Fanpage cần chạy ads | Ad bắt buộc gắn với 1 Page |
| **Access Token** | Qua luồng OAuth 2.0 (chi tiết Phần 3) | "Chìa khóa" để gọi API thay mặt người dùng |
| **System User Token** (khuyến nghị cho production) | Business Settings → System Users | Token không hết hạn, dùng cho server chạy tự động |

### 2.2. Quyền (Permissions) cần xin duyệt

Khi tạo App, bạn cần xin các quyền sau qua App Review:

- `ads_management` — tạo/sửa/xóa campaign, ad set, ad
- `ads_read` — đọc dữ liệu báo cáo
- `business_management` — thao tác trong Business Manager
- `pages_read_engagement` / `pages_manage_ads` — nếu ad gắn với Page

> **Lưu ý cho học viên:** Ở giai đoạn dev/test, bạn có thể dùng chính tài khoản cá nhân là "Tester" hoặc "Developer" của App để test mà **không cần chờ duyệt App Review**. Chỉ khi launch cho nhiều khách hàng ngoài mới cần App Review.

### 2.3. Công cụ nên dùng khi học

- **Graph API Explorer** (developers.facebook.com/tools/explorer) — bấm chuột để test API trước khi viết code, giúp hiểu rõ field/response.
- **Postman** — lưu lại các API call, tạo collection để học viên thực hành.

---

## PHẦN 3: XÁC THỰC — OAUTH 2.0 FLOW CHI TIẾT

### 3.1. Luồng tổng quát

```
1. User bấm "Kết nối Facebook" trên phần mềm của bạn
2. Redirect user sang Facebook Login Dialog (kèm scope quyền cần xin)
3. User đăng nhập + cho phép quyền
4. Facebook redirect về redirect_uri của bạn kèm "code"
5. Server của bạn dùng "code" đổi lấy "access_token" (short-lived, ~1-2h)
6. Đổi tiếp short-lived token → long-lived token (~60 ngày)
7. Lưu token vào database, gắn với user
```

### 3.2. Bước 1 — Redirect user đến Facebook Login

```
GET https://www.facebook.com/v25.0/dialog/oauth?
  client_id={APP_ID}
  &redirect_uri={REDIRECT_URI}
  &scope=ads_management,ads_read,business_management,pages_manage_ads
  &response_type=code
  &state={RANDOM_STRING_CHONG_CSRF}
```

### 3.3. Bước 2 — Đổi `code` lấy `access_token`

```javascript
const axios = require('axios');

async function exchangeCodeForToken(code) {
  const response = await axios.get('https://graph.facebook.com/v25.0/oauth/access_token', {
    params: {
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      redirect_uri: process.env.FB_REDIRECT_URI,
      code: code
    }
  });
  return response.data.access_token; // short-lived token
}
```

### 3.4. Bước 3 — Đổi sang Long-lived Token (60 ngày)

```javascript
async function getLongLivedToken(shortToken) {
  const response = await axios.get('https://graph.facebook.com/v25.0/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      fb_exchange_token: shortToken
    }
  });
  return response.data.access_token; // long-lived, ~60 days
}
```

> **Best practice cho production:** Dùng **System User Access Token** (tạo trong Business Settings → System Users → Generate Token). Token này **không tự hết hạn**, phù hợp cho phần mềm chạy nền tự động set ads mà không cần user đăng nhập lại mỗi 60 ngày.

---

## PHẦN 4: BƯỚC 1 — TẠO CAMPAIGN

### 4.1. Endpoint

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/campaigns
```

### 4.2. Mapping 6 mục tiêu UI ↔ giá trị API (ODAX)

| Tên hiển thị trên UI (tiếng Việt) | Giá trị field `objective` trong API |
|---|---|
| Mức độ nhận biết | `OUTCOME_AWARENESS` |
| Lưu lượng truy cập | `OUTCOME_TRAFFIC` |
| Lượt tương tác | `OUTCOME_ENGAGEMENT` |
| Khách hàng tiềm năng | `OUTCOME_LEADS` |
| Quảng cáo ứng dụng | `OUTCOME_APP_PROMOTION` |
| Doanh số | `OUTCOME_SALES` |

### 4.3. Các field quan trọng

| Field | Kiểu | Ghi chú |
|---|---|---|
| `name` | string | Tên chiến dịch, tự đặt |
| `objective` | string | 1 trong 6 giá trị ở bảng trên |
| `status` | string | `ACTIVE` (chạy luôn) hoặc `PAUSED` (tạo xong để tạm dừng — **khuyến nghị dùng PAUSED khi test**) |
| `special_ad_categories` | array | Bắt buộc phải có, để `[]` nếu không thuộc ngành đặc biệt (nhà ở, tín dụng, việc làm, chính trị...) |
| `daily_budget` hoặc `lifetime_budget` | integer | **Chỉ cần nếu bật CBO** (ngân sách cấp Campaign). Đơn vị: **cent** theo currency của tài khoản (VNĐ thì nhập số nguyên VNĐ) |
| `bid_strategy` | string | VD: `LOWEST_COST_WITHOUT_CAP` (mặc định, để hệ thống tự tối ưu chi phí) |

### 4.4. Code mẫu (Node.js)

```javascript
async function createCampaign({ adAccountId, accessToken, name, objective }) {
  const url = `https://graph.facebook.com/v25.0/act_${adAccountId}/campaigns`;

  const response = await axios.post(url, null, {
    params: {
      name,
      objective,               // vd: 'OUTCOME_ENGAGEMENT'
      status: 'PAUSED',
      special_ad_categories: JSON.stringify([]),
      access_token: accessToken
    }
  });

  return response.data.id; // campaign_id, ví dụ: "120210000000000"
}
```

### 4.5. Response mẫu

```json
{ "id": "120210123456789" }
```

Lưu `id` này lại — đây là `campaign_id` cần dùng cho bước tạo Ad Set.

---

## PHẦN 5: BƯỚC 2 — TẠO AD SET (NHÓM QUẢNG CÁO)

Đây là bước **phức tạp nhất** vì chứa targeting, ngân sách, tối ưu hóa.

### 5.1. Endpoint

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/adsets
```

### 5.2. Các field bắt buộc

| Field | Ý nghĩa | Ví dụ |
|---|---|---|
| `name` | Tên ad set | `"Spa_TP.HCM_18-45_Nữ"` |
| `campaign_id` | ID campaign đã tạo ở bước 1 | `"120210123456789"` |
| `daily_budget` | Ngân sách/ngày (nếu không dùng CBO), đơn vị cent theo currency | `100000` (100,000 VNĐ) |
| `billing_event` | Tính phí theo gì | `IMPRESSIONS` (phổ biến nhất) |
| `optimization_goal` | Facebook tối ưu phân phối theo mục tiêu nào | Xem bảng 5.3 |
| `bid_amount` hoặc để bid tự động | Giá thầu | Thường để trống, dùng `LOWEST_COST_WITHOUT_CAP` |
| `targeting` | Đối tượng mục tiêu (object phức tạp) | Xem 5.4 |
| `status` | `PAUSED` khi test | |
| `destination_type` | Nơi dẫn về (nếu objective là Engagement/Traffic) | `MESSENGER`, `WEBSITE`, `ON_AD` |

### 5.3. `optimization_goal` — phải khớp với `objective` của Campaign

| Campaign Objective | Optimization Goal phù hợp |
|---|---|
| `OUTCOME_ENGAGEMENT` (tương tác/nhắn tin) | `CONVERSATIONS` (tối ưu ra tin nhắn), hoặc `POST_ENGAGEMENT`, `THRUPLAY` (video) |
| `OUTCOME_TRAFFIC` | `LINK_CLICKS` hoặc `LANDING_PAGE_VIEWS` |
| `OUTCOME_LEADS` | `LEAD_GENERATION` hoặc `QUALITY_LEAD` |
| `OUTCOME_SALES` | `OFFSITE_CONVERSIONS` (cần Pixel) |
| `OUTCOME_AWARENESS` | `REACH` hoặc `AD_RECALL_LIFT` |
| `OUTCOME_APP_PROMOTION` | `APP_INSTALLS` |

> Đây là điểm học viên hay bị lỗi nhất: chọn sai `optimization_goal` không khớp với `objective` sẽ bị API trả lỗi `Invalid parameter`.

### 5.4. Object `targeting` — Geo-targeting Việt Nam

```javascript
const targeting = {
  geo_locations: {
    cities: [
      { key: "2450022", radius: 20, distance_unit: "kilometer" } // key lấy từ Targeting Search API
    ],
    // Hoặc target theo cả nước:
    // countries: ["VN"]
  },
  age_min: 18,
  age_max: 45,
  genders: [2], // 1 = Nam, 2 = Nữ, để trống mảng = tất cả
  locales: [10], // 10 = Tiếng Việt (lấy mã từ Marketing API locale list)
  publisher_platforms: ["facebook", "instagram", "messenger"],
  facebook_positions: ["feed", "story", "reels"],
  // Sở thích (interest) - phải search ra interest_id trước qua Targeting Search API
  flexible_spec: [
    {
      interests: [{ id: "6003107902433", name: "Spa" }]
    }
  ]
};
```

**Lấy `key` cho city/interest bằng Targeting Search API:**

```
GET https://graph.facebook.com/v25.0/search
  ?type=adgeolocation
  &location_types=["city"]
  &q=Ho Chi Minh
  &access_token={TOKEN}
```

```
GET https://graph.facebook.com/v25.0/search
  ?type=adinterest
  &q=Spa
  &access_token={TOKEN}
```

### 5.5. Code mẫu tạo Ad Set

```javascript
async function createAdSet({ adAccountId, accessToken, campaignId, name, dailyBudget }) {
  const targeting = {
    geo_locations: { countries: ["VN"] },
    age_min: 18,
    age_max: 45,
    genders: [2],
    publisher_platforms: ["facebook", "instagram", "messenger"]
  };

  const response = await axios.post(
    `https://graph.facebook.com/v25.0/act_${adAccountId}/adsets`,
    null,
    {
      params: {
        name,
        campaign_id: campaignId,
        daily_budget: dailyBudget,          // vd: 100000 (VNĐ)
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'CONVERSATIONS', // khớp objective OUTCOME_ENGAGEMENT
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'MESSENGER',
        targeting: JSON.stringify(targeting),
        status: 'PAUSED',
        access_token: accessToken
      }
    }
  );

  return response.data.id; // adset_id
}
```

---

## PHẦN 6: BƯỚC 3 — UPLOAD CREATIVE & TẠO AD

### 6.1. Upload ảnh trước (nếu quảng cáo dạng ảnh)

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/adimages
```

```javascript
const FormData = require('form-data');
const fs = require('fs');

async function uploadImage({ adAccountId, accessToken, imagePath }) {
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('source', fs.createReadStream(imagePath));

  const response = await axios.post(
    `https://graph.facebook.com/v25.0/act_${adAccountId}/adimages`,
    form,
    { headers: form.getHeaders() }
  );

  // Response trả về object images, lấy hash
  const imageHash = Object.values(response.data.images)[0].hash;
  return imageHash;
}
```

### 6.2. Tạo Ad Creative (nội dung quảng cáo)

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/adcreatives
```

```javascript
async function createCreative({ adAccountId, accessToken, pageId, imageHash, message, link }) {
  const objectStorySpec = {
    page_id: pageId,
    link_data: {
      image_hash: imageHash,
      link: link,                     // hoặc bỏ qua nếu CTA là Messenger
      message: message,               // nội dung caption
      call_to_action: {
        type: 'MESSAGE_PAGE',         // CTA "Gửi tin nhắn"
        value: { app_destination: 'MESSENGER' }
      }
    }
  };

  const response = await axios.post(
    `https://graph.facebook.com/v25.0/act_${adAccountId}/adcreatives`,
    null,
    {
      params: {
        name: 'Creative_' + Date.now(),
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: accessToken
      }
    }
  );

  return response.data.id; // creative_id
}
```

### 6.3. Tạo Ad (gộp Ad Set + Creative)

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/ads
```

```javascript
async function createAd({ adAccountId, accessToken, adsetId, creativeId, name }) {
  const response = await axios.post(
    `https://graph.facebook.com/v25.0/act_${adAccountId}/ads`,
    null,
    {
      params: {
        name,
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        status: 'PAUSED',
        access_token: accessToken
      }
    }
  );

  return response.data.id; // ad_id
}
```

---

## PHẦN 6B: UPLOAD VIDEO VÀ TẠO VIDEO AD

Nếu quảng cáo dùng video thay vì ảnh, luồng sẽ khác ở 3 điểm: endpoint upload, xử lý bất đồng bộ, và cấu trúc creative.

### 6B.1. Upload video

Dùng endpoint `advideos` thay vì `adimages`:

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/advideos
```

```javascript
async function uploadVideo({ adAccountId, accessToken, videoPath, title }) {
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('source', fs.createReadStream(videoPath));
  form.append('title', title);

  const response = await axios.post(
    `https://graph.facebook.com/v25.0/act_${adAccountId}/advideos`,
    form,
    { headers: form.getHeaders() }
  );

  return response.data.id; // video_id — nhưng CHƯA chắc đã xử lý xong
}
```

### 6B.2. Điểm khác biệt quan trọng: video xử lý bất đồng bộ

Facebook cần thời gian encode video (vài giây đến vài phút tùy độ dài/dung lượng). Bạn **không thể tạo Ad Creative ngay** — phải poll trạng thái cho đến khi `status.video_status === 'ready'`:

```javascript
async function waitForVideoReady({ videoId, accessToken, maxWaitMs = 120000 }) {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const res = await axios.get(`https://graph.facebook.com/v25.0/${videoId}`, {
      params: { fields: 'status', access_token: accessToken }
    });

    const status = res.data.status?.video_status;
    if (status === 'ready') return true;
    if (status === 'error') throw new Error('Video xử lý lỗi: ' + JSON.stringify(res.data.status));

    await new Promise(r => setTimeout(r, 3000)); // đợi 3s rồi check lại
  }

  throw new Error('Video xử lý quá lâu, timeout');
}
```

### 6B.3. Ảnh thumbnail (bắt buộc)

Video ad cần 1 ảnh cover/thumbnail. Có 2 cách:
- Lấy thumbnail tự động Facebook cung cấp (field `thumbnails` trong response video), hoặc
- Upload ảnh riêng qua `adimages` (như Phần 6.1) rồi lấy `image_hash`.

```javascript
async function getVideoThumbnail({ videoId, accessToken }) {
  const res = await axios.get(`https://graph.facebook.com/v25.0/${videoId}`, {
    params: { fields: 'thumbnails', access_token: accessToken }
  });
  // Chọn 1 thumbnail trong danh sách trả về
  return res.data.thumbnails.data[0].uri;
}
```

### 6B.4. Tạo Creative với `video_data` thay vì `link_data`

```javascript
async function createVideoCreative({ adAccountId, accessToken, pageId, videoId, imageHash, message, link }) {
  const objectStorySpec = {
    page_id: pageId,
    video_data: {
      video_id: videoId,
      image_hash: imageHash,       // thumbnail bắt buộc
      message: message,
      call_to_action: {
        type: 'MESSAGE_PAGE',
        value: { app_destination: 'MESSENGER' }
      }
      // Nếu muốn dẫn về website thay vì Messenger:
      // call_to_action: { type: 'LEARN_MORE', value: { link } }
    }
  };

  const response = await axios.post(
    `https://graph.facebook.com/v25.0/act_${adAccountId}/adcreatives`,
    null,
    {
      params: {
        name: 'VideoCreative_' + Date.now(),
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: accessToken
      }
    }
  );

  return response.data.id;
}
```

### 6B.5. Flow đầy đủ khi dùng video

```javascript
const videoId = await uploadVideo({ ...config, videoPath: './creative/spa-promo.mp4', title: 'Spa Promo T8' });
await waitForVideoReady({ videoId, accessToken: config.accessToken }); // BẮT BUỘC chờ
const imageHash = await uploadImage({ ...config, imagePath: './creative/thumbnail.jpg' }); // hoặc lấy auto-thumbnail
const creativeId = await createVideoCreative({ ...config, videoId, imageHash, message: '...' });
const adId = await createAd({ ...config, adsetId, creativeId, name: 'Ad_Video_01' });
```

### 6B.6. Lưu ý quan trọng cho học viên

| Vấn đề | Ghi chú |
|---|---|
| Giới hạn dung lượng | Tối đa 4GB, độ dài tối đa 241 phút (nhưng feed ads thường nên dưới 60s để hiệu quả) |
| Định dạng | MP4/MOV khuyến nghị, H.264 codec |
| Bỏ qua bước `waitForVideoReady` | Lỗi phổ biến nhất — gọi tạo creative khi video chưa `ready` sẽ bị trả lỗi hoặc creative bị treo |
| Reels/Stories | Cần tỷ lệ khung hình 9:16, nên upload riêng file dọc thay vì dùng video ngang bị crop |

---

## PHẦN 7: FLOW ĐẦY ĐỦ END-TO-END (chạy tuần tự)

```javascript
async function runFullAdCreationFlow() {
  const config = {
    adAccountId: '1234567890',
    accessToken: 'EAAG...',
    pageId: '9876543210'
  };

  // Bước 1: Campaign
  const campaignId = await createCampaign({
    ...config,
    name: 'Spa_ThangTam_2026',
    objective: 'OUTCOME_ENGAGEMENT'
  });
  console.log('Campaign ID:', campaignId);

  // Bước 2: Ad Set
  const adsetId = await createAdSet({
    ...config,
    campaignId,
    name: 'AdSet_TPHCM_Nu_18-45',
    dailyBudget: 100000
  });
  console.log('AdSet ID:', adsetId);

  // Bước 3a: Upload ảnh
  const imageHash = await uploadImage({
    ...config,
    imagePath: './creative/spa-ad-01.jpg'
  });

  // Bước 3b: Tạo Creative
  const creativeId = await createCreative({
    ...config,
    imageHash,
    message: 'Ưu đãi spa mùa hè - Giảm 30% gói chăm sóc da',
    link: 'https://your-spa-site.com'
  });

  // Bước 4: Tạo Ad
  const adId = await createAd({
    ...config,
    adsetId,
    creativeId,
    name: 'Ad_UuDaiMuaHe_01'
  });
  console.log('Ad ID:', adId, '=> Tạo thành công, đang ở trạng thái PAUSED');
}
```

> **Lưu ý quan trọng:** Luôn tạo với `status: 'PAUSED'` trong lúc dev/test, chỉ chuyển `status: 'ACTIVE'` bằng 1 API `POST` riêng sau khi đã kiểm tra kỹ trên UI Ads Manager — tránh cháy ngân sách do bug.

---

## PHẦN 8: XỬ LÝ LỖI THƯỜNG GẶP

| Mã lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `190` | Access token hết hạn/không hợp lệ | Refresh token hoặc dùng System User Token |
| `100` (Invalid parameter) | Sai `optimization_goal` không khớp `objective`, hoặc thiếu field bắt buộc | Kiểm tra lại bảng mapping ở Phần 5.3 |
| `2635` | Tài khoản chưa được duyệt Business Verification | Verify Business Manager trên Meta |
| `368` | Tài khoản bị flag spam do tạo quá nhiều object trong thời gian ngắn | Thêm delay giữa các API call, không tạo hàng loạt cùng lúc |
| `1487742` | Ảnh không đạt tỷ lệ / kích thước tối thiểu | Ảnh tối thiểu 1080x1080px, đúng tỷ lệ placement |

**Cách đọc lỗi trả về từ API:**

```json
{
  "error": {
    "message": "Invalid parameter",
    "type": "OAuthException",
    "code": 100,
    "error_subcode": 1885183,
    "fbtrace_id": "AbC123..."
  }
}
```

Luôn log `fbtrace_id` — khi cần liên hệ Facebook Support hoặc tra cứu forum, mã này giúp định vị chính xác lỗi.

---

## PHẦN 9: THỰC HÀNH ĐỀ XUẤT CHO HỌC VIÊN

1. Tạo Facebook App + lấy token qua Graph API Explorer (chưa cần code OAuth).
2. Dùng token đó, gọi thử `createCampaign` bằng Postman trước khi viết code Node.js.
3. Viết lại toàn bộ flow ở Phần 7 thành 1 module Node.js, tách riêng từng hàm.
4. Thêm bước validate input trước khi gọi API (vd: kiểm tra `dailyBudget` không dưới mức tối thiểu Facebook cho phép).
5. Nâng cao: xây UI để user chọn objective bằng tiếng Việt (map sang giá trị API), chọn ảnh, nhập targeting — rồi gọi flow tự động phía trên.

---

## PHẦN 10: TÀI LIỆU THAM KHẢO CHÍNH THỨC

- Marketing API Reference: https://developers.facebook.com/docs/marketing-api/reference
- Campaign Objective (ODAX): https://developers.facebook.com/docs/marketing-api/campaign-structure
- Targeting Search: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
- Ad Creative: https://developers.facebook.com/docs/marketing-api/creative

> **Ghi chú:** Facebook thường xuyên cập nhật version API (hiện dùng `v25.0` trong ví dụ). Luôn kiểm tra Changelog trước khi lên production: https://developers.facebook.com/docs/graph-api/changelog
