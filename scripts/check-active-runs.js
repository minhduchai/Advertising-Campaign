import { fileURLToPath } from 'node:url';
import { createSqlTransport } from '../src/postgres-transport.js';

// Chạy trên server trước khi deploy: `node --env-file=<app.env> scripts/check-active-runs.js`.
// Thoát mã 0 nếu không có lượt tạo nào đang chạy, mã 3 nếu có (deploy sẽ khởi động lại dịch vụ và cắt ngang lượt đó).
// Chỉ đọc bảng `runs` (status, created_at, workflow_lease_expires_at); không in token, URL kết nối hay dữ liệu cá nhân.
export const ACTIVE_RUN_STATUSES = ['creating', 'seeding', 'retrying_ad'];
// Lượt cũ hơn mốc này bị coi là treo, không chặn deploy mãi mãi.
export const STALE_RUN_MS = 6 * 60 * 60 * 1000;
// Lượt chạy trực tiếp (không workflow) không có lease: coi là còn chạy trong khoảng này kể từ lúc tạo (mốc đăng tối đa ~4 phút).
export const DIRECT_RUN_WINDOW_MS = 15 * 60 * 1000;

export function isRunActive(row, now = Date.now()) {
  if (!ACTIVE_RUN_STATUSES.includes(row?.status)) return false;
  const createdAt = Number(row.created_at);
  if (!Number.isFinite(createdAt) || now - createdAt > STALE_RUN_MS) return false;
  const lease = row.workflow_lease_expires_at == null ? null : Number(row.workflow_lease_expires_at);
  // Workflow gia hạn lease ở mỗi bước: lease còn hạn nghĩa là workflow đang chạy.
  if (lease !== null && Number.isFinite(lease)) return lease > now;
  return now - createdAt < DIRECT_RUN_WINDOW_MS;
}

export function countActiveRuns(rows, now = Date.now()) {
  return rows.filter((row) => isRunActive(row, now)).length;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL chưa được cấu hình.');
    return 2;
  }
  const sql = createSqlTransport(databaseUrl);
  try {
    const now = Date.now();
    const rows = await sql`
      SELECT status, created_at, workflow_lease_expires_at
      FROM runs
      WHERE completed_at IS NULL AND created_at > ${now - STALE_RUN_MS}
    `;
    const active = countActiveRuns(rows, now);
    console.log(`active_runs=${active}`);
    return active > 0 ? 3 : 0;
  } finally {
    await sql.end?.();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      // Không in error.message vì có thể chứa thông tin kết nối.
      console.error(`Không kiểm tra được lượt đang chạy (${error?.name ?? 'Error'}).`);
      process.exitCode = 2;
    }
  );
}
