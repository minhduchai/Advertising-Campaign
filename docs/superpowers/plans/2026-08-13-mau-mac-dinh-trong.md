# Kế hoạch triển khai mẫu mặc định trống

> **Dành cho tác nhân triển khai:** BẮT BUỘC dùng `subagent-driven-development` hoặc `executing-plans` để thực hiện từng task. Mỗi bước dùng checkbox để theo dõi.

**Mục tiêu:** Quảng cáo mới luôn có phần Cuộc trò chuyện rỗng, không tự áp mẫu dùng chung, trong khi toàn bộ mẫu đã lưu vẫn được giữ để người dùng chọn thủ công.

**Kiến trúc:** Tách dữ liệu mẫu ưu đãi được seed khỏi hàm tạo cuộc trò chuyện mặc định của quảng cáo. Trình duyệt không còn đọc cờ `isDefault` để tự áp mẫu; bộ chọn cung cấp trạng thái ảo `Mặc định (trống)` và đặt lại trình soạn khi người dùng chọn trạng thái này.

**Công nghệ:** Node.js ES modules, HTML template strings, Node test runner, Vercel.

## Ràng buộc chung

- Không xóa hoặc sửa các mẫu hiện có trong database.
- Không chạy migration database.
- Không tự động lưu nội dung khi người dùng nhập.
- Không tạo git commit vì người dùng chưa yêu cầu.
- Nội dung giao diện dùng tiếng Việt.

---

### Task 1: Tách mẫu seed khỏi mặc định rỗng

**Files:**
- Modify: `public/conversation.js`
- Modify: `src/shared-conversation-library.js`
- Modify: `test/conversation.test.js`
- Modify: `test/client-state.test.js`

**Interfaces:**
- Produces: `createDefaultConversation(randomId)` trả về nội dung rỗng với một nút web rỗng.
- Produces: `createFemaleUnderarmConversation(randomId)` giữ nguyên nội dung mẫu ưu đãi đã seed.
- Consumes: `createAd()` trong `public/state.js` tiếp tục gọi `createDefaultConversation`.

- [ ] **Step 1: Viết test thất bại cho mặc định rỗng**

```js
test('creates a blank default conversation for a new Ad', () => {
  const conversation = createDefaultConversation(idSequence('button-1'));
  assert.equal(conversation.templateName, '');
  assert.equal(conversation.greeting, '');
  assert.deepEqual(conversation.customerActions, [{ id: 'button-1', label: '', type: 'OPEN_URL', value: '' }]);
  assert.equal(conversation.dirty, false);
});
```

Chuyển test nội dung ưu đãi sang gọi `createFemaleUnderarmConversation` và bổ sung các assertion rỗng vào test `creates the approved nested defaults`.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/conversation.test.js test/client-state.test.js`

Expected: FAIL vì `createDefaultConversation` vẫn chứa nội dung ưu đãi và `createFemaleUnderarmConversation` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

Trong `public/conversation.js`, tạo helper nội bộ trả về cấu trúc rỗng, để `createDefaultConversation` dùng `dirty: false` và `createEmptyConversation` dùng `dirty: true`. Di chuyển nội dung ưu đãi cũ sang export mới:

```js
export function createFemaleUnderarmConversation(randomId = defaultRandomId) {
  return {
    sourceTemplateId: null,
    templateName: DEFAULT_TEMPLATE_NAME,
    greeting: DEFAULT_GREETING,
    quickReplies: [],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    customerActions: [{ id: randomId(), label: 'Đăng Ký Ngay', type: 'OPEN_URL', value: DEFAULT_BUTTON_URL }],
    dirty: false
  };
}
```

Trong `src/shared-conversation-library.js`, dùng `createFemaleUnderarmConversation` để dữ liệu seed không thay đổi.

- [ ] **Step 4: Chạy test để xác nhận GREEN**

Run: `node --test test/conversation.test.js test/client-state.test.js test/conversation-template-routes.test.js`

Expected: PASS.

---

### Task 2: Bỏ tự áp mẫu và thêm lựa chọn trống

**Files:**
- Modify: `public/app.js`
- Modify: `public/workspace.js`
- Modify: `test/tree-interactions.test.js`
- Modify: `test/workspace.test.js`

**Interfaces:**
- Consumes: `createDefaultConversation()` để đặt lại trình soạn về trạng thái trống.
- Preserves: CRUD mẫu dùng chung và `sourceTemplateId` khi chọn một mẫu đã lưu.

- [ ] **Step 1: Viết test thất bại cho UI và controller**

Trong `test/workspace.test.js`, yêu cầu HTML có `Mặc định (trống)`, không có `data-action="default-conversation-template"`, không thêm hậu tố `· Mặc định` dù fixture có `isDefault: true`.

Trong `test/tree-interactions.test.js`, yêu cầu controller:

```js
assert.doesNotMatch(appSource, /applyDefaultTemplateToCandidates/);
assert.doesNotMatch(appSource, /applyCachedDefaultsToCampaign/);
assert.match(appSource, /select-conversation-template[\s\S]*?!control\.value[\s\S]*?createDefaultConversation\(\)/);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/workspace.test.js test/tree-interactions.test.js`

Expected: FAIL vì UI vẫn hiện thao tác đặt mặc định và controller vẫn tự áp mẫu.

- [ ] **Step 3: Viết implementation tối thiểu**

Trong `public/app.js`:

- Khi giá trị của `select-conversation-template` rỗng, tách creative dùng chung rồi gán `createDefaultConversation()` cho quảng cáo.
- Xóa các lời gọi và hàm `applyDefaultTemplateToCandidates`, `defaultTemplateForPage`, `applyCachedDefaultsToCampaign`.
- Xóa action `default-conversation-template` khỏi danh sách xử lý và xóa nhánh gọi API đặt mặc định.
- `loadConversationTemplates` chỉ tải và lưu danh sách, không tự áp nội dung.

Trong `public/workspace.js`:

```html
<option value="">Mặc định (trống)</option>
```

- Không render badge `Mặc định`.
- Không thêm `· Mặc định` vào tên mẫu.
- Không render nút `Đặt mặc định`.

- [ ] **Step 4: Chạy test để xác nhận GREEN**

Run: `node --test test/workspace.test.js test/tree-interactions.test.js`

Expected: PASS.

---

### Task 3: Xác minh và triển khai production

**Files:**
- Generated by build: browser bundles under `public/`

**Interfaces:**
- Consumes: toàn bộ thay đổi từ Task 1 và Task 2.
- Produces: deployment production tại `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 1: Chạy toàn bộ kiểm tra**

Run: `npm.cmd test`

Expected: exit code `0`, không có test thất bại.

- [ ] **Step 2: Triển khai Vercel**

Run: `npx.cmd --yes vercel --prod --yes`

Expected: alias production trỏ về `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 3: Kiểm tra trực tiếp production**

Kiểm tra `/health` trả về `{"ok":true}` và asset `workspace.js` chứa `Mặc định (trống)` nhưng không chứa `data-action="default-conversation-template"`.
