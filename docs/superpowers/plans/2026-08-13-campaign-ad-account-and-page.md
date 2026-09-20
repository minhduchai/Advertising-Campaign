# Kế hoạch triển khai tài khoản quảng cáo và Page theo chiến dịch

> **Dành cho agent triển khai:** BẮT BUỘC dùng sub-skill `superpowers:subagent-driven-development` hoặc `superpowers:executing-plans` để thực hiện từng nhiệm vụ. Các bước dùng cú pháp checkbox (`- [ ]`) để theo dõi.

**Mục tiêu:** Mỗi chiến dịch chọn tài khoản quảng cáo và Facebook Page riêng; dòng chiến dịch chỉ chọn đối tượng còn nút mũi tên riêng điều khiển thu/phóng.

**Kiến trúc:** `campaign.adAccountId` và `campaign.pageId` trở thành nguồn dữ liệu duy nhất cho toàn bộ nhóm quảng cáo/quảng cáo con. Trình duyệt lưu tài nguyên theo từng tài khoản và giải quyết tài nguyên đang dùng từ chiến dịch cha; máy chủ nhóm việc kiểm tra Page theo tài khoản rồi publisher gửi từng cây chiến dịch đến đúng tài khoản. Snapshot lịch sử chuyển sang phiên bản 2 và lưu tài khoản/Page tại chiến dịch.

**Công nghệ:** JavaScript ES modules, Node.js HTTP, SQLite/Neon hiện có, HTML/CSS thuần, `node:test`.

## Ràng buộc chung

- Không tạo thật bất kỳ đối tượng Meta nào trong quá trình kiểm thử.
- Giữ mọi Campaign, Ad Set và Ad ở trạng thái `PAUSED` như hiện tại.
- Không làm mất cấu hình của chiến dịch khác khi đổi tài khoản của một chiến dịch.
- Không dùng chung creative giữa hai tài khoản quảng cáo hoặc hai Page.
- Giữ khả năng đọc lịch sử phiên bản cũ.
- Kho mã hiện không phải Git nên các checkpoint không thực hiện commit.

---

### Nhiệm vụ 1: Mô hình trạng thái và điều khiển cây

**Tệp:**
- Sửa: `public/state.js`
- Sửa: `public/workspace.js`
- Sửa: `public/app.js`
- Sửa: `public/app.css`
- Kiểm thử: `test/client-state.test.js`
- Kiểm thử: `test/workspace.test.js`
- Kiểm thử: `test/tree-interactions.test.js`

**Giao diện:**
- Tạo `createCampaign(randomId, defaults)` trả về Campaign có `adAccountId` và `pageId`.
- Tạo `toggleCampaignCollapsed(state, campaignId)` chỉ thay đổi `collapsedCampaignIds`.
- `activateNode(state, clientId)` chỉ chọn node và mở chiến dịch cha khi chọn node con.
- Nút `[data-action="toggle-campaign-collapse"]` điều khiển thu/phóng độc lập.

- [ ] **Bước 1: Viết kiểm thử thất bại cho chọn và thu/phóng**

```js
test('selects a Campaign without collapsing it and toggles only through disclosure', () => {
  const state = createWorkspaceState({ randomId: sequenceIds() });
  const campaignId = state.draft.campaigns[0].clientId;
  assert.equal(activateNode(state, campaignId), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(toggleCampaignCollapsed(state, campaignId), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, [campaignId]);
});
```

- [ ] **Bước 2: Chạy kiểm thử và xác nhận thất bại đúng nguyên nhân**

Chạy: `node --test test/client-state.test.js test/workspace.test.js test/tree-interactions.test.js`

Mong đợi: FAIL vì chưa export `toggleCampaignCollapsed`, dòng Campaign vẫn chứa trạng thái mở và chưa có nút disclosure riêng.

- [ ] **Bước 3: Sửa state và HTML cây tối thiểu**

```js
export function toggleCampaignCollapsed(state, campaignId) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return false;
  setCampaignCollapsed(state, campaignId, !isCampaignCollapsed(state, campaignId));
  return true;
}
```

`tree-node-main` giữ `data-action="select-node"`; disclosure là button riêng có `data-action="toggle-campaign-collapse"`, `aria-expanded` và nhãn truy cập phù hợp.

- [ ] **Bước 4: Chạy lại kiểm thử cây**

Chạy: `node --test test/client-state.test.js test/workspace.test.js test/tree-interactions.test.js`

Mong đợi: PASS.

### Nhiệm vụ 2: Tài khoản và Page ở cấp chiến dịch

**Tệp:**
- Sửa: `public/state.js`
- Sửa: `public/workspace.js`
- Sửa: `public/app.js`
- Sửa: `public/index.html`
- Sửa: `public/app.css`
- Kiểm thử: `test/client-state.test.js`
- Kiểm thử: `test/workspace.test.js`

**Giao diện:**
- `campaign.adAccountId: string` và `campaign.pageId: string` là bắt buộc.
- `resources.accountResourcesById[accountId]` chứa `{ pages, pageDiscovery, customAudiences }`.
- `activeCampaign(state)` và `resourcesForCampaign(state, campaign)` giải quyết ngữ cảnh đang chỉnh sửa.
- Đổi tài khoản gọi `changeCampaignAccount(state, campaignId, accountId)` và chỉ xóa Page/audience/targeting của chiến dịch đó.

- [ ] **Bước 1: Viết kiểm thử thất bại cho kế thừa và cô lập dữ liệu**

```js
test('new Campaign inherits account and Page while account changes clear only its subtree', () => {
  const state = createWorkspaceState({ randomId: sequenceIds() });
  const first = state.draft.campaigns[0];
  first.adAccountId = 'act_1';
  first.pageId = 'page_1';
  const second = addCampaign(state, sequenceIds());
  assert.equal(second.adAccountId, 'act_1');
  assert.equal(second.pageId, 'page_1');
  changeCampaignAccount(state, second.clientId, 'act_2');
  assert.equal(second.pageId, '');
  assert.equal(first.pageId, 'page_1');
});
```

- [ ] **Bước 2: Chạy kiểm thử và xác nhận thất bại**

Chạy: `node --test test/client-state.test.js test/workspace.test.js`

Mong đợi: FAIL vì Campaign chưa có tài khoản/Page và editor chưa render hai select.

- [ ] **Bước 3: Sửa mô hình, editor và bộ nhớ đệm tài nguyên**

Campaign editor render `select[data-field="adAccountId"]` từ `state.resources.adAccounts` và `select[data-field="pageId"]` từ cache của Campaign. Bỏ `#ad-account` khỏi topbar và bỏ Page selector khỏi Ad Set editor. Các helper Page, audience, targeting, location và conversation template nhận Campaign/account hiện hành thay vì đọc `state.draft.adAccountId`.

- [ ] **Bước 4: Chạy lại kiểm thử state và workspace**

Chạy: `node --test test/client-state.test.js test/workspace.test.js test/tree-interactions.test.js test/conversation.test.js`

Mong đợi: các kiểm thử mới PASS; chỉ chấp nhận lỗi nền đã biết nếu vẫn đúng tên kiểm thử cũ.

### Nhiệm vụ 3: Xác thực và tạo Meta theo từng chiến dịch

**Tệp:**
- Sửa: `src/draft.js`
- Sửa: `src/request-handler.js`
- Sửa: `src/publisher.js`
- Kiểm thử: `test/draft.test.js`
- Kiểm thử: `test/publisher.test.js`
- Kiểm thử: `test/publish-routes.test.js`

**Giao diện:**
- `validateDraft(draft)` báo lỗi tại `campaigns.N.adAccountId` và `campaigns.N.pageId`.
- `pageAuthorizationIssues(draft, pageCatalogsByAccount)` kiểm tra Campaign/Page đúng tài khoản.
- `publishDraft` dùng `campaign.adAccountId` và `campaign.pageId` cho toàn bộ cây con.

- [ ] **Bước 1: Viết kiểm thử thất bại cho hai tài khoản/Page**

```js
test('publishes each Campaign through its own account and Page', async () => {
  const draft = twoCampaignDraft({
    first: { adAccountId: 'act_1', pageId: 'page_1' },
    second: { adAccountId: 'act_2', pageId: 'page_2' }
  });
  const result = await publishDraft(publisherFixture(draft));
  assert.deepEqual(result.calls.campaignAccounts, ['act_1', 'act_2']);
  assert.deepEqual(result.calls.promotedPages, ['page_1', 'page_2']);
});
```

- [ ] **Bước 2: Chạy kiểm thử và xác nhận thất bại**

Chạy: `node --test test/draft.test.js test/publisher.test.js test/publish-routes.test.js`

Mong đợi: FAIL vì code hiện dùng `draft.adAccountId` và `adSet.pageId`.

- [ ] **Bước 3: Sửa validation, route và publisher**

Trong route, tạo `Map<adAccountId, pageCatalog>` bằng các account duy nhất; ghép danh sách Page cho snapshot nhưng kiểm tra từng Campaign trên catalog đúng account. Publisher truyền `campaign.adAccountId` vào `createCampaign`, `createAdSet`, upload/creative/Ad và truyền `campaign.pageId` vào promoted object/creative.

- [ ] **Bước 4: Chạy lại kiểm thử backend**

Chạy: `node --test test/draft.test.js test/publisher.test.js test/publish-routes.test.js`

Mong đợi: PASS cho luồng đa tài khoản, Page sai tài khoản bị chặn trước Meta write.

### Nhiệm vụ 4: Snapshot và lịch sử đa tài khoản

**Tệp:**
- Sửa: `src/run-report.js`
- Sửa: `src/request-handler.js`
- Sửa: `public/activity-history.js`
- Kiểm thử: `test/run-report.test.js`
- Kiểm thử: `test/activity-history.test.js`
- Kiểm thử: `test/publish-routes.test.js`

**Giao diện:**
- Snapshot `version: 2` lưu `adAccountId`, `pageId`, `pageName` trong từng Campaign.
- `run.adAccountId` bằng account duy nhất khi toàn bộ Campaign cùng account, ngược lại là `null`.
- Lịch sử mới hiển thị account và Page trong thẻ Campaign; lịch sử version 1 tiếp tục đọc Page từ Ad Set.

- [ ] **Bước 1: Viết kiểm thử snapshot thất bại**

```js
test('stores account and Page on every Campaign in snapshot version 2', () => {
  const snapshot = createRunSnapshot(snapshotFixture());
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.campaigns[0].adAccountId, 'act_1');
  assert.equal(snapshot.campaigns[0].pageId, 'page_1');
  assert.equal(snapshot.campaigns[0].pageName, 'Page One');
});
```

- [ ] **Bước 2: Chạy kiểm thử và xác nhận thất bại**

Chạy: `node --test test/run-report.test.js test/activity-history.test.js test/publish-routes.test.js`

Mong đợi: FAIL vì snapshot hiện là version 1 và Page nằm trong Ad Set.

- [ ] **Bước 3: Sửa snapshot và renderer tương thích ngược**

Lưu Campaign account/Page trong version 2; `renderCampaign` hiển thị hai giá trị. `renderAdSet` chỉ hiển thị Page từ Ad Set khi đọc snapshot version 1.

- [ ] **Bước 4: Chạy lại kiểm thử lịch sử**

Chạy: `node --test test/run-report.test.js test/activity-history.test.js test/publish-routes.test.js`

Mong đợi: PASS cho version 2 và không làm hỏng fixture version 1.

### Nhiệm vụ 5: Hồi quy, build và triển khai

**Tệp:**
- Kiểm tra: toàn bộ tệp đã sửa

- [ ] **Bước 1: Chạy bộ kiểm thử tập trung**

Chạy: `node --test test/client-state.test.js test/workspace.test.js test/tree-interactions.test.js test/draft.test.js test/publisher.test.js test/publish-routes.test.js test/run-report.test.js test/activity-history.test.js test/client-api.test.js test/vercel-runtime.test.js`

Mong đợi: PASS.

- [ ] **Bước 2: Chạy toàn bộ kiểm thử và build**

Chạy: `npm.cmd test` và `npm.cmd run build`.

Mong đợi: build PASS; đối chiếu mọi lỗi toàn bộ test với ba lỗi nền đã biết trước thay đổi.

- [ ] **Bước 3: Deploy production**

Chạy: `npx.cmd --yes vercel --prod --yes`.

Mong đợi: alias `https://creative-campaign-lgclinic.vercel.app` trỏ đến deployment mới.

- [ ] **Bước 4: Kiểm tra production không tạo dữ liệu Meta**

Kiểm tra `/health`, `/`, `/app.js` và `/workspace.js` trả HTTP 200; xác nhận HTML production không còn `#ad-account` và bundle chứa `toggle-campaign-collapse`.
