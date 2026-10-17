const status = document.querySelector('#access-status');
const users = document.querySelector('#access-users');
const form = document.querySelector('#access-form');
const pending = document.querySelector('#access-pending');
let catalog = { users: [], profiles: [] };
let refreshSequence = 0;
async function update(metaUserId, allowed, details = {}) {
  const response = await fetch('/api/admin/access', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-management': '1' },
    body: JSON.stringify({ metaUserId, allowed, ...details }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Không cập nhật được quyền sử dụng.');
  }
  status.textContent = allowed ? 'Đã lưu quyền và thông tin nhận diện.' : 'Đã khóa quyền truy cập.';
  await refresh();
}
async function refresh() {
  const sequence = ++refreshSequence;
  const response = await fetch('/api/admin/access', { cache: 'no-store' });
  if (!response.ok) throw new Error('Không tải được danh sách.');
  const { users: entries, profiles = [] } = await response.json();
  if (sequence !== refreshSequence) return;
  catalog = { users: entries, profiles };
  const waiting = profiles.filter(profile => !entries.some(user => user.id === profile.id));
  document.querySelector('#access-pending-count').textContent = waiting.length
    ? `${waiting.length} tài khoản đã đăng nhập, chưa được cấp quyền.` : 'Không có tài khoản chờ cấp quyền.';
  document.title = `${waiting.length ? `(${waiting.length}) ` : ''}Quản lý quyền sử dụng`;
  pending.replaceChildren();
  for (const profile of waiting) {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = profile.name || 'Chưa có tên';
    const identity = document.createElement('small');
    const lastSeen = Number(profile.lastSeen);
    identity.textContent = ` — ID app: ${profile.id}${Number.isFinite(lastSeen) && lastSeen > 0
      ? ` — Đăng nhập: ${new Date(lastSeen).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' })}` : ''} `;
    const approve = document.createElement('button');
    approve.textContent = 'Cho phép';
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try { await update(profile.id, true); }
      catch (error) { status.textContent = error.message; approve.disabled = false; }
    });
    row.append(name, identity, approve);
    pending.append(row);
  }
  const picker = document.querySelector('[name="metaUserId"]');
  const selected = picker.value;
  picker.replaceChildren(new Option('Chọn tài khoản', ''));
  for (const profile of profiles) {
    const user = entries.find(user => user.id === profile.id);
    if (!user?.admin) {
      picker.add(new Option(`${user?.label ? user.label + ' / ' : ''}${profile.name || 'Chưa có tên'}${user ? ' (đã cấp quyền)' : ' (chưa cấp quyền)'} — ID app: ${profile.id}`, profile.id));
    }
  }
  picker.value = selected;
  users.replaceChildren();
  for (const user of entries) {
    const row = document.createElement('li');
    const profile = profiles.find(profile => profile.id === user.id);
    row.textContent = `${user.label || profile?.name || 'Chưa xác định tài khoản'}${user.admin ? ' — Quản trị viên' : ' — Được phép sử dụng'} `;
    if (user.label && profile?.name) {
      const name = document.createElement('span');
      name.textContent = `(Tên Meta: ${profile.name}) `;
      row.append(name);
    }
    if (user.facebookUrl) {
      const link = document.createElement('a');
      link.href = user.facebookUrl;
      link.textContent = 'Mở Facebook';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link, ' ');
    }
    const identity = document.createElement('small');
    identity.textContent = `ID app: ${user.id}${profile ? '' : ' — Chưa khớp tài khoản đăng nhập; có thể đã nhập nhầm ID hồ sơ'}. `;
    row.append(identity);
    if (!user.admin) {
      if (profile) {
        const edit = document.createElement('button');
        edit.textContent = 'Sửa thông tin';
        edit.addEventListener('click', () => {
          form.closest('details').open = true;
          picker.value = user.id; fillDetails(); form.elements.label.focus();
        });
        row.append(edit, ' ');
      }
      const button = document.createElement('button');
      button.textContent = 'Khóa';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await update(user.id, false); } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
      row.append(button);
    }
    users.append(row);
  }
}
function fillDetails() {
  const user = catalog.users.find(user => user.id === form.elements.metaUserId.value);
  form.elements.label.value = user?.label ?? '';
  form.elements.facebookUrl.value = user?.facebookUrl ?? '';
  document.querySelector('#access-save').textContent = user ? 'Lưu thông tin' : 'Cấp quyền';
}
form.elements.metaUserId.addEventListener('change', fillDetails);
form.addEventListener('submit', async event => {
  event.preventDefault();
  try { await update(form.elements.metaUserId.value, true, { label: form.elements.label.value, facebookUrl: form.elements.facebookUrl.value }); }
  catch (error) { status.textContent = error.message; }
});
document.querySelector('#access-refresh').addEventListener('click', () => {
  refresh().catch(error => { status.textContent = error.message; });
});
refresh().catch(error => { status.textContent = error.message; });
setInterval(() => {
  if (!document.hidden) refresh().catch(error => { status.textContent = error.message; });
}, 15_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh().catch(error => { status.textContent = error.message; });
});
