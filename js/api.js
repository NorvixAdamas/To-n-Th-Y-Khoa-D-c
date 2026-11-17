/** Small client helpers for the encyclopedia API. */
import { STATIC_MODE } from './runtime-config.js';

async function staticApi() {
  return import('./static-api.js');
}

export async function getJson(path, { timeout = 30000 } = {}) {
  if (STATIC_MODE) {
    const api = await staticApi();
    return api.getJson(path);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, { headers: { accept: 'application/json' }, signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error || `Yêu cầu thất bại (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Nguồn phản hồi quá chậm. Vui lòng thử lại.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson(path, body, { timeout = 45000 } = {}) {
  if (STATIC_MODE) {
    const api = await staticApi();
    return api.postJson(path, body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Yêu cầu thất bại (HTTP ${res.status})`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function fmt(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('vi-VN');
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function truncate(text, max = 240) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function href(path, params) {
  return `#${path}${qs(params)}`;
}

export function debounce(fn, wait = 240) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
