# Kiểm tra code ngày 07/09/2026

Đợt này tập trung vào kiểm thử tương tác trình duyệt thực tế — phần mà đợt
06/09 ghi rõ là chưa làm. Lỗi nghiêm trọng nhất bên dưới chỉ lộ ra khi chạy
thật trong trình duyệt, không bộ test nào hiện có bắt được.

## Tóm tắt

Không có lỗi nào làm app sập. Build, test, boot server, các route và luồng UI
đều chạy. Tìm được 1 lỗi đã chứng minh bằng bằng chứng runtime, 2 lỗi thiết kế
ở tầng lưu trữ R2, và 5 điểm cần dọn.

| # | Lỗi | Mức | File |
|---|-----|-----|------|
| 1 | Module ES nạp 2 lần do `?v=` không đồng nhất | Cao | `public/app.js`, `public/state.js`, `public/launch-preview.js` |
| 2 | Upload R2 single-part thiếu kiểm tra chủ sở hữu | Trung bình | `src/r2-media.js` |
| 3 | Cleanup R2 có thể xóa media đang dùng | Trung bình | `src/r2-media.js` |
| 4 | ~35MB rác deploy lên Vercel | Thấp | `.vercelignore` |
| 5 | `upload-agent-client.js` không được phục vụ (có đính chính) | Thấp | `public/` |
| 6 | Handler khởi tạo ở module scope | Thấp | `api/router.js` |
| 7 | `/api/drafts/validate` không cần auth | Thấp | `src/request-handler.js` |
| 8 | Chống replay nonce chỉ trong bộ nhớ | Thấp | `src/request-handler.js` |

---

## 1. Module ES bị nạp hai lần (Cao)

### Hiện trạng

Cache-busting `?v=` được gắn không đồng nhất giữa các file. Trình duyệt định
danh module ES **theo URL đầy đủ**, nên `./state.js` và `./state.js?v=2026...`
là hai module hoàn toàn tách biệt, mỗi bản có bộ biến module-level riêng.

- `public/app.js` import kèm `?v=...`
- `public/state.js:2` import `./activity-history.js` **không** có `?v=`
- `public/launch-preview.js:1-3` import `./state.js`, `./workspace.js`,
  `./workspace-progress.js` **không** có `?v=`

### Bằng chứng

Chạy trong trình duyệt tại `http://localhost:3099/?frontend=launch-control`:

```
stateSameModule: false      stateSameFn: false
progressSameModule: false   progressSameFn: false
```

Network log của một lần tải trang xác nhận nạp đôi:

```
/state.js?v=20260904-campaign-presets-audience      + /state.js
/workspace.js?v=20260904-campaign-presets-audience  + /workspace.js
/workspace-progress.js?v=20260903-seeding-before-adset + /workspace-progress.js
/activity-history.js?v=20260905-history-table-dedupe   + /activity-history.js
```

`activity-history.js` nạp đôi ở **cả trang thường**, không riêng chế độ
launch-control.

### Vì sao nguy hiểm

Không phải chuyện tốn băng thông. Vấn đề là cache-busting bị vô hiệu với các
bản import trần: sau khi deploy code mới, `app.js` lấy bản mới vì version đã
bump, còn `launch-preview.js` và `state.js` có thể lấy **bản cũ từ cache
trình duyệt** ở URL không đổi. Hai bản code lệch phiên bản chạy song song
trong cùng một trang — đúng loại lỗi mà việc gắn version sinh ra để ngăn.

Hiện tại hai module trùng chỉ chứa hằng số (`TERMINAL_RUN_STATUSES`,
`creativeFields`) nên chưa gây sai lệch hành vi. Nhưng bất kỳ state
module-level nào thêm sau này, hoặc bất kỳ phép so sánh định danh nào
(`===`, `instanceof`, dùng hàm làm khóa Map) sẽ hỏng âm thầm.

### Nên sửa

Bỏ hẳn `?v=` khỏi mọi câu lệnh `import` và chuyển việc bust cache sang tầng
HTTP header — đây là cách sạch nhất và không thể lệch lại:

```js
// src/http.js — sendPublicFile
response.writeHead(200, {
  'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
  'cache-control': 'no-cache'   // vẫn cache, nhưng revalidate mỗi lần
});
```

Nếu muốn giữ nguyên cách gắn version, thì phải gắn **đồng nhất ở mọi nơi** —
sửa `public/state.js:2` và `public/launch-preview.js:1-3` cho khớp chuỗi
version trong `public/app.js`. Cách này dễ lệch lại lần sau nên không khuyến
nghị.

### Cách kiểm chứng sau khi sửa

Mở trang, chạy trong console:

```js
performance.getEntriesByType('resource')
  .map(e => e.name.replace(location.origin, ''))
  .filter(n => n.endsWith('.js'))
```

Không được có tên file nào xuất hiện hai lần.

---

## 2. Upload R2 single-part thiếu kiểm tra chủ sở hữu (Trung bình)

### Hiện trạng

Trong `src/r2-media.js`, hai đường upload xử lý quyền sở hữu khác nhau.

**Đường multipart — đúng.** `multipartMediaKey()` chèn owner vào key
(`ads/<owner>/<mediaId>/<file>`), và `requireMultipartPath()` so khớp,
trả 403 nếu lệch:

```js
if (segments[1] !== ownerSegment) {
  throw mediaError('R2 multipart upload does not belong to this session', 403);
}
```

**Đường single-part — thiếu.** `presignUpload()` (dòng 91) tạo key
**không có owner** ở dòng 94:

```js
const key = `ads/${mediaId}/${safeFileName(name, mimeType)}`;
```

và `completeUpload()` (dòng 98) chỉ kiểm tra tiền tố ở dòng 100, **không bao
giờ** so với `ownerMetaUserId` — dù đã nhận tham số này:

```js
if (!String(input?.key ?? '').startsWith(`ads/${input.mediaId}/`)) {
  throw mediaError('R2 upload path is invalid', 400);
}
```

### Mức độ

Chưa khai thác trực tiếp được: `handleR2Presign`
(`src/request-handler.js:2672`) sinh `mediaId` bằng `randomBytes(16)`
(128 bit), nên không đoán được key của người khác. Đây là lỗ hổng phòng thủ
theo chiều sâu, không phải lỗ hổng đang mở. Nhưng nếu một key rò ra ngoài
bằng bất kỳ đường nào (log, URL presigned bị chia sẻ, ảnh chụp màn hình), một
tài khoản khác có thể gọi `/api/r2-media/complete` để nhận object đó về tên
mình, rồi đọc qua `getMetaFetchUrl`.

### Nên sửa

Cho đường single-part dùng chung quy ước key với multipart:

```js
// presignUpload
const key = `ads/${ownerPathSegment(ownerMetaUserId)}/${mediaId}/${safeFileName(name, mimeType)}`;

// completeUpload — thay phép kiểm tra startsWith
requireMultipartPath({ ownerMetaUserId, mediaId: input.mediaId, key: input.key });
```

`presignUpload` hiện chưa nhận `ownerMetaUserId`, cần truyền thêm từ
`handleR2Presign` ở `src/request-handler.js:2673`.

**Lưu ý khi triển khai:** đổi quy ước key làm các object đã upload theo đường
cũ (`ads/<mediaId>/...`) không còn khớp `requireMultipartPath`. Vì media ở
đây là tạm thời và bị xóa sau mỗi run, ảnh hưởng chỉ giới hạn ở các upload
đang dở lúc deploy. Nếu muốn chắc chắn, chấp nhận cả hai dạng key trong
`completeUpload` một thời gian rồi mới siết lại.

---

## 3. Cleanup R2 có thể xóa media đang dùng (Trung bình)

### Hiện trạng

`cleanupR2Objects()` trong `src/r2-media.js:122`: khi tổng dung lượng vượt
ngưỡng (mặc định 9GB), nó xóa **toàn bộ** object dưới `ads/` cũ hơn 6 giờ,
của mọi người dùng:

```js
const candidates = objects.filter((object) => modifiedAt <= now - minimumAgeMs);
// rồi xóa hết candidates, theo lô 1000
```

Ba điểm thiếu:

- Không dừng lại khi dung lượng đã về dưới ngưỡng — xóa hết mọi thứ đủ tuổi,
  không phải xóa vừa đủ.
- Không kiểm tra media có đang được draft chưa publish tham chiếu hay không.
- Không xóa row DB tương ứng, nên `db.getMedia` vẫn trả metadata cho một
  object đã biến mất.

### Hậu quả thực tế

Media ở đây là tạm thời theo thiết kế — `deleteTemporaryMedia` dọn sau mỗi
run publish (`src/request-handler.js:2372` và `:2663`), nên cleanup theo tuổi
chủ yếu là lưới an toàn cho các file mồ côi. Đánh giá này đã được điều chỉnh
sau khi đọc vòng đời media.

Nhưng vẫn còn kịch bản hỏng thật: người dùng upload ảnh, chuẩn bị chiến dịch
rồi hôm sau mới publish. Nếu bucket vượt 9GB trong khoảng đó, file bị xóa âm
thầm. UI vẫn hiển thị media đã đính kèm vì row DB còn nguyên,
`getMetaFetchUrl` vẫn ký được URL, và publish mới fail ở bước Meta fetch với
lỗi khó truy nguyên.

### Nên sửa

Ưu tiên theo thứ tự:

1. **Xóa vừa đủ.** Sắp candidates theo `LastModified` tăng dần, xóa dần cho
   tới khi `totalBytes` về dưới ngưỡng thì dừng, thay vì xóa sạch.
2. **Đồng bộ DB.** Sau khi xóa object, xóa hoặc đánh dấu row media tương ứng
   để UI biết file không còn và báo lỗi sớm, thay vì fail lúc publish.
3. **Nới tuổi tối thiểu.** 6 giờ quá ngắn cho nhịp làm việc soạn hôm nay
   publish hôm sau. 48–72 giờ hợp lý hơn; chỉnh qua `R2_CLEANUP_MIN_AGE_MS`
   không cần sửa code.

Cũng lưu ý `DeleteObjectsCommand` đang dùng `Quiet: true`, nên lỗi xóa từng
object bị ẩn, trong khi `deletedCount: candidates.length` vẫn báo là đã xóa
hết. Nên bỏ `Quiet` hoặc đọc `Errors` trong response để số liệu trả về đúng
thực tế.

---

## 4. Rác deploy lên Vercel (Thấp)

`.vercelignore` bỏ sót các thư mục sau, tất cả đều được đóng gói khi deploy:

| Thư mục | Dung lượng | Ghi chú |
|---|---|---|
| `telegram-file-bot/` | 33MB | chứa cả Python virtualenv `.venv` |
| `.old-frontend-dpl_7jWwTw/` | 996K | frontend cũ, code chết |
| `review-backup-20260813-224833/` | 228K | bản sao lưu |
| `tmp/` | 388K | |
| `dist/` | 100K | |
| `test/`, `cloudflare/`, `design-system/`, `design-concepts/` | — | không cần cho runtime |

Tổng khoảng 35MB thừa mỗi lần deploy, làm chậm upload và build. Không phát
hiện secret thật trong các thư mục này — chỉ có `.env.example` và các file
thư viện tình cờ có chữ "token" trong tên.

### Nên sửa

Bổ sung vào `.vercelignore`:

```
telegram-file-bot/
.old-frontend-dpl_7jWwTw/
review-backup-*/
tmp/
dist/
test/
cloudflare/
design-system/
design-concepts/
*.zip
```

Riêng `.old-frontend-dpl_7jWwTw/` và các file `.zip` ở thư mục gốc
(`TelegramFileBot-*.zip`, `review-src.zip`, `telegram-file-bot.zip`) nên xóa
hẳn khỏi dự án chứ không chỉ loại khỏi deploy.

---

## 5. `public/upload-agent-client.js` không được phục vụ (Thấp)

> **Đính chính 07/09/2026.** Bản đầu của mục này ghi "không có file nào tham
> chiếu tới nó" và đề xuất xóa. **Sai.** Lệnh grep lúc đó chỉ quét `public/`
> và `src/`, bỏ sót `test/`. Thực tế `test/upload-agent-interactions.test.js:7`
> có import file này. Không được xóa.

File không nằm trong allowlist `publicFiles` ở `src/request-handler.js:49`
nên server không phục vụ nó cho trình duyệt — đúng, vì không trang nào cần.
Nhưng nó vẫn là source được test dùng, nên phải giữ lại trong dự án.

Cách xử lý đúng: giữ file, chỉ loại khỏi gói deploy qua `.vercelignore`.

Đây là file duy nhất trong `public/` không có trong allowlist — mọi file
`.js`/`.css` khác đều được khai báo đúng.

---

## 6. Handler khởi tạo ở module scope (Thấp)

`api/router.js:3` gọi `createVercelHandler()` ngay khi module được nạp.
`loadConfig()` bên trong ném lỗi nếu thiếu bất kỳ biến env bắt buộc nào.

Hậu quả: thiếu một biến env là **mọi** request nhận 500 trắng ở cold start,
không có thông tin chẩn đoán trả về cho người gọi. Thông báo lỗi thật chỉ nằm
trong log Vercel.

### Nên sửa

Khởi tạo lười và trả lỗi có ngữ cảnh:

```js
let handler = null;
export default async function (request, response) {
  try {
    handler ??= createVercelHandler();
  } catch (error) {
    console.error('[boot] Cấu hình không hợp lệ', error);
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    return response.end(JSON.stringify({ error: 'Cấu hình máy chủ chưa đầy đủ' }));
  }
  return handler(request, response);
}
```

---

## 7. `/api/drafts/validate` không yêu cầu xác thực (Thấp)

Đã kiểm chứng: POST không kèm session trả 422 kèm kết quả validate, không
phải 401.

```
POST /api/drafts/validate  ->  422 {"valid":false,"errors":[...]}
```

Endpoint không đọc dữ liệu người dùng nên không rò rỉ thông tin, nhưng nó
nhận body tới 5MB (`MAX_JSON_BODY_BYTES` trong `src/http.js`) và chạy validate
không giới hạn tốc độ. Đây là bề mặt tiêu tốn tài nguyên miễn phí.

### Nên sửa

Thêm kiểm tra session như các route khác, hoặc nếu cố ý cho phép validate ẩn
danh thì hạ giới hạn body riêng cho route này:

```js
const input = await readJson(request, 256 * 1024);
```

---

## 8. Chống replay nonce chỉ trong bộ nhớ (Thấp)

`workflowNonces` là một `Map` cục bộ trong `createRequestHandler`
(`src/request-handler.js:79`). Nonce được dọn đúng cách mỗi request
(`:2215`), không rò bộ nhớ.

Nhưng trên Vercel, mỗi instance serverless giữ Map riêng. Nhiều instance chạy
song song thì một request bị phát lại có thể rơi vào instance chưa từng thấy
nonce đó và được chấp nhận, trong cửa sổ lệch giờ 5 phút.

Chữ ký HMAC vẫn hợp lệ và cửa sổ hẹp nên rủi ro thấp. Nếu muốn chặt chẽ, lưu
nonce vào Postgres với TTL thay vì bộ nhớ.

---

## Những phần đã kiểm tra và đạt

Ghi lại để đợt sau không phải làm lại:

| Hạng mục | Kết quả |
|---|---|
| `npm run build` | Đạt |
| `node --test` | **735/735 đạt**, 0 fail, 0 skip |
| `node --check` toàn bộ `src`, `api`, `scripts`, `public` | Không lỗi cú pháp |
| `npm audit` | 0 lỗ hổng (86 package) |
| Boot server + 31 route | Đúng; 401 chuẩn trên mọi endpoint cần auth |
| SQL injection | Không có — Neon dùng tagged template, SQLite dùng prepared statement |
| Namespace cache Meta | Đúng — mọi khóa có tiền tố `user:<metaUserId>:`, không rò chéo tài khoản |
| Cookie phiên | `HttpOnly`, `SameSite=Lax`, `Secure` khi production, `Cache-Control: private, no-store` |
| OAuth state | Sinh 32 byte ngẫu nhiên, gắn với session, dùng một lần |
| Chữ ký workflow | HMAC-SHA256 trên canonical request có hash body, kiểm lệch giờ, chống replay, so sánh timing-safe, validate định dạng hex |
| Xác thực Telegram worker | So sánh bearer token timing-safe |
| Phục vụ file tĩnh | Dùng allowlist, không path traversal (`/../.env` trả 404) |
| Rò secret ra bundle client | Không — đã đối chiếu giá trị thật của `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` với `public/` và `dist/` |
| Tải UI, chế độ demo, chế độ launch-control | Không có lỗi JavaScript |
| Xử lý JSON hỏng | Trả 400 đúng (bản sửa ngày 06/09 vẫn hoạt động) |

## Phạm vi và giới hạn

Đã chạy toàn bộ bộ test hiện có, kiểm tra cú pháp, dò endpoint bằng HTTP thật
trên server chạy cục bộ (port 3099), và **kiểm thử tương tác trình duyệt
thật** gồm đọc console, network log và thực thi JavaScript trong trang. Rà thủ
công các đường HTTP/session, cấu hình, chữ ký workflow, cache Meta, lưu trữ R2
và vòng đời media.

Đây không phải bằng chứng mọi nhánh logic đều đúng. Chưa đọc thủ công từng
dòng của `src/request-handler.js` (2950 dòng), `src/db.js` (1628 dòng) và
`src/postgres-db.js` (1323 dòng).

Không gọi tạo quảng cáo hay bình luận thật, không deploy, không chạy migration,
không kiểm tra kết nối production tới Meta, Neon, R2, Vercel hay Telegram.
Không chạy bộ test của `cloudflare/` và `telegram-file-bot/` trong đợt này.

**Chưa sửa file nào.** Toàn bộ nội dung trên là phát hiện và đề xuất.

Các module không có test riêng, nên ưu tiên khi viết thêm test:
`request-handler.js`, `database.js`, `blob-upload.js`, `run-stream.js`,
`audience-regions.js`, `audience-template.js`, `run-history-summary.js`,
`shared-conversation-library.js`.

## Thứ tự nên làm

1. **Lỗi 1** — rẻ, ảnh hưởng mọi người dùng, và chỉ lộ ra sau khi deploy nên
   rất khó truy nếu để lâu.
2. **Lỗi 4** — sửa một file, giảm ngay 35MB mỗi lần deploy.
3. **Lỗi 3** — nới `R2_CLEANUP_MIN_AGE_MS` là xong phần lớn rủi ro, không cần
   sửa code.
4. **Lỗi 2** — vá cho khớp đường multipart.
5. Lỗi 5, 6, 7, 8 — dọn dần.
