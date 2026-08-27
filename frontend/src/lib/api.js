const TOKEN_KEY = 'pos_token';
const USER_KEY = 'pos_user';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

/** ข้อผิดพลาดจาก API ที่พก status และรายละเอียดมาด้วย */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, opts = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth.token && !opts.noAuth ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !opts.noAuth && !opts.keepSession) {
    auth.clear();
    if (!location.pathname.startsWith('/customer')) location.href = '/login';
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 200) }; }

  if (!res.ok) throw new ApiError(res.status, json.error || `เกิดข้อผิดพลาด (${res.status})`, json.details);
  return json;
}

export const api = {
  get: (p, o) => request('GET', p, null, o),
  post: (p, b, o) => request('POST', p, b, o),
  patch: (p, b, o) => request('PATCH', p, b, o),
  put: (p, b, o) => request('PUT', p, b, o),
  del: (p, o) => request('DELETE', p, null, o),
  /** ดาวน์โหลดรายงานเป็นไฟล์ CSV เปิดใน MS-Excel ได้ */
  async downloadCsv(path, filename) {
    const res = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'format=csv', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) throw new ApiError(res.status, 'ดาวน์โหลดรายงานไม่สำเร็จ');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
