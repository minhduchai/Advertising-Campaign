# Global Meta Resource Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tải tài khoản quảng cáo và Facebook Page một lần sau OAuth, cho phép chọn độc lập và chặn cặp tài khoản–Page không tương thích.

**Architecture:** `/api/resources` trả catalog tài khoản và Page dùng chung. `/api/ad-account-resources` chỉ trả tài nguyên theo tài khoản cùng tập `promotablePageIds`; client cache theo tài khoản và validation kiểm tra cặp lựa chọn trước khi tạo Ads.

**Tech Stack:** Node.js, JavaScript ES modules, Meta Graph API v24, HTML datalist, Node test runner.

## Global Constraints

- Không tải lại toàn bộ Page khi đổi tài khoản quảng cáo.
- Tài khoản quảng cáo và Page phải chọn độc lập và luôn đổi lại được.
- Không tự xóa Page khi đổi tài khoản.
- Cặp tài khoản–Page không tương thích phải khóa tạo Ads.
- Lỗi quota không được xóa catalog hoặc lựa chọn hiện tại.

---

### Task 1: Tách catalog Page dùng chung khỏi tài nguyên tài khoản

**Files:**
- Modify: `src/meta-client.js`
- Modify: `src/request-handler.js`
- Test: `test/meta-client.test.js`
- Test: `test/auth-routes.test.js`

**Interfaces:**
- Produces: `metaClient.listGlobalPageCatalog(token)` trả `{ pages, discovery }`.
- Produces: `metaClient.listPromotablePages(token, accountId)` trả Page quảng bá theo tài khoản.

- [ ] Viết test thất bại xác nhận `/api/resources` trả `pages` và `pageDiscovery` từ catalog dùng chung.
- [ ] Viết test thất bại xác nhận `/api/ad-account-resources` trả `promotablePageIds` nhưng không quét lại Business Page.
- [ ] Chạy `node --test test/meta-client.test.js test/auth-routes.test.js` và xác nhận test mới thất bại.
- [ ] Tách `listGlobalPageCatalog()` dùng `me/accounts`, `me/businesses`, `owned_pages`, `client_pages`; giữ `listPromotablePages()` chỉ gọi `/{accountId}/promote_pages`.
- [ ] Cập nhật hai route để trả đúng hợp đồng mới.
- [ ] Chạy lại hai file test và xác nhận đạt.

### Task 2: Lưu catalog Page dùng chung trong state

**Files:**
- Modify: `public/state.js`
- Modify: `public/app.js`
- Test: `test/client-state.test.js`
- Test: `test/workspace.test.js`

**Interfaces:**
- Consumes: `payload.pages`, `payload.pageDiscovery`, `payload.promotablePageIds`.
- Produces: `state.resources.pages`, `state.resources.pageDiscovery` và `accountResources.promotablePageIds`.

- [ ] Viết test thất bại xác nhận workspace state có catalog Page dùng chung.
- [ ] Viết test thất bại xác nhận đổi tài khoản không xóa `campaign.pageId`.
- [ ] Chạy test và xác nhận thất bại đúng nguyên nhân.
- [ ] Thêm state dùng chung và cập nhật `loadResources()` để lưu catalog sau OAuth.
- [ ] Cập nhật `setAccountResources()` để lưu `promotablePageIds`.
- [ ] Sửa `changeCampaignAccount()` chỉ xóa targeting phụ thuộc tài khoản, không xóa Page.
- [ ] Chạy lại test và xác nhận đạt.

### Task 3: Cho phép chọn tài khoản và Page độc lập

**Files:**
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Test: `test/workspace.test.js`

**Interfaces:**
- Consumes: `state.resources.adAccounts`, `state.resources.pages`.
- Produces: hai combobox độc lập `adAccountId` và `pageId`.

- [ ] Viết test thất bại xác nhận Page combobox không bị disabled khi chưa chọn tài khoản nhưng đã kết nối.
- [ ] Viết test thất bại xác nhận Page lấy dữ liệu từ catalog dùng chung.
- [ ] Chạy test và xác nhận thất bại.
- [ ] Sửa `pagePicker()` đọc catalog dùng chung, bỏ điều kiện `!campaign.adAccountId` và không khóa sau lựa chọn.
- [ ] Sửa handler để chọn lại cùng tài khoản dùng cache, đổi tài khoản khác vẫn tải tài nguyên riêng của tài khoản đó.
- [ ] Chạy lại test và xác nhận đạt.

### Task 4: Kiểm tra tương thích và chống mất dữ liệu khi quota lỗi

**Files:**
- Modify: `public/state.js`
- Modify: `public/app.js`
- Modify: `src/request-handler.js`
- Test: `test/client-state.test.js`
- Test: `test/workspace.test.js`
- Test: `test/draft-validation.test.js`

**Interfaces:**
- Produces: lỗi validation tại `campaigns.{index}.pageId` khi Page không thuộc `promotablePageIds`.

- [ ] Viết test thất bại cho cặp tài khoản–Page không tương thích.
- [ ] Viết test thất bại xác nhận lỗi quota giữ catalog và lựa chọn.
- [ ] Chạy test và xác nhận thất bại.
- [ ] Cập nhật `pageCatalogIssues()` dùng catalog chung và tập tương thích theo tài khoản.
- [ ] Khi chưa xác minh được tập tương thích, hiển thị lỗi có thể thử lại thay vì xóa Page.
- [ ] Build client bằng `node scripts/build-client.js`.
- [ ] Chạy toàn bộ `node --test` và xác nhận không có lỗi hồi quy.
- [ ] Deploy bằng `npx vercel deploy --prod --yes --scope ducndna-5064s-projects --project creative-campaign-lgclinic`.
