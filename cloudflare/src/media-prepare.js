// Bước `media:prepare`: máy chủ upload video lên Meta và kiểm tra trạng thái MỘT lần mỗi lời gọi; nếu còn video chưa sẵn sàng
// thì trả { pending: true, retryAfterMs }. Workflow ngủ rồi tạo instance kế tiếp (giống cách chờ seeding) để không vượt giới hạn
// số bước/subrequest của một instance.
export const MEDIA_PREPARE_KEY = "media:prepare";
export const MAX_MEDIA_PREPARE_ATTEMPTS = 60;
const MIN_WAIT_MS = 5_000;
const MAX_WAIT_MS = 60_000;
const DEFAULT_WAIT_MS = 15_000;

export function isMediaPrepareStep(plannedStep) {
  return String(plannedStep?.key) === MEDIA_PREPARE_KEY;
}

// previousAttempt: số lần đã chờ trước đó (lấy từ payload của instance).
// Trả về { action: 'done' } | { action: 'wait', attempt, waitMs } | { action: 'give_up', message }.
export function nextMediaPrepareAction(result, previousAttempt = 0) {
  if (result?.pending !== true) return { action: "done" };
  const attempt = Math.max(0, Math.floor(Number(previousAttempt) || 0)) + 1;
  if (attempt > MAX_MEDIA_PREPARE_ATTEMPTS) {
    return {
      action: "give_up",
      message: `Video vẫn đang xử lý sau ${MAX_MEDIA_PREPARE_ATTEMPTS} lần kiểm tra (${Number(result.ready) || 0}/${Number(result.total) || 0} video sẵn sàng); cần kiểm tra lượt tạo.`,
    };
  }
  const requested = Number(result.retryAfterMs);
  const waitMs = Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_WAIT_MS));
  return { action: "wait", attempt, waitMs };
}
