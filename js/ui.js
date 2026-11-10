/** Shared rendering helpers. All dynamic text must pass through esc(). */
import { esc, fmt, fmtDate, href, pct } from './api.js';

export { esc, fmt, fmtDate, href, pct };

const app = () => document.getElementById('app');

export function render(html) {
  app().innerHTML = html;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function setActiveNav(name) {
  document.querySelectorAll('.main-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  document.getElementById('mainNav')?.classList.remove('open');
  document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'false');
}

export function breadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items.map((item, i) => {
    const link = item.href ? `<a href="${esc(item.href)}">${esc(item.label)}</a>` : `<span>${esc(item.label)}</span>`;
    return i ? `<span class="sep">/</span>${link}` : link;
  }).join('')}</nav>`;
}

export function pageHead({ kicker, title, lead, actions = '', extra = '' }) {
  return `
    <div class="page-head">
      <div>
        ${kicker ? `<span class="page-kicker">${esc(kicker)}</span>` : ''}
        <h1>${esc(title)}</h1>
        ${lead ? `<p class="lead">${lead}</p>` : ''}
      </div>
      ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
    </div>
    ${extra}`;
}

export function pagination({ page, pageSize, total, makeHref }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return `<p class="tiny muted" style="text-align:center">${fmt(total)} bản ghi</p>`;
  const current = Math.min(Math.max(1, page), pages);
  const buttons = [];
  buttons.push(`<a class="btn btn-outline btn-sm" ${current === 1 ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : `href="${esc(makeHref(current - 1))}"`}>← Trước</a>`);
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, current + 2);
  if (start > 1) buttons.push(`<a class="btn btn-outline btn-sm" href="${esc(makeHref(1))}">1</a>${start > 2 ? '<span class="tiny muted">…</span>' : ''}`);
  for (let i = start; i <= end; i++) {
    buttons.push(i === current
      ? `<span class="btn btn-primary btn-sm" aria-current="page">${i}</span>`
      : `<a class="btn btn-outline btn-sm" href="${esc(makeHref(i))}">${i}</a>`);
  }
  if (end < pages) buttons.push(`${end < pages - 1 ? '<span class="tiny muted">…</span>' : ''}<a class="btn btn-outline btn-sm" href="${esc(makeHref(pages))}">${pages}</a>`);
  buttons.push(`<a class="btn btn-outline btn-sm" ${current === pages ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : `href="${esc(makeHref(current + 1))}"`}>Sau →</a>`);
  return `<div class="pagination">${buttons.join('')}<span class="page-info">Trang ${current}/${pages} · ${fmt(total)} bản ghi</span></div>`;
}

export function callout(tone, title, text) {
  const icon = tone === 'danger' ? '⚠' : tone === 'warn' ? '!' : tone === 'ok' ? '✓' : 'i';
  return `<div class="callout callout-${esc(tone)}"><span class="c-icon" aria-hidden="true">${icon}</span><div>${title ? `<strong>${esc(title)}</strong>` : ''}${text}</div></div>`;
}

export function emptyState(title, text = '') {
  return `<div class="empty-state"><div class="es-icon" aria-hidden="true">⌕</div><strong>${esc(title)}</strong><span>${text}</span></div>`;
}

export function errorState(err) {
  return `<div class="empty-state"><div class="es-icon" aria-hidden="true">⚠</div><strong>Không thể tải dữ liệu</strong><span>${esc(err.message || err)}</span><div class="mt-2"><button class="btn btn-outline" onclick="location.reload()">Thử lại</button></div></div>`;
}

export function loadingBlock(text = 'Đang truy xuất dữ liệu…') {
  return `<div class="page-loader"><span class="spinner" aria-hidden="true"></span><p>${esc(text)}</p></div>`;
}

export function sourceList(sources, retrievedAt) {
  if (!sources || !sources.length) return '<p class="tiny muted">Chưa có nguồn được khai báo cho bản ghi này.</p>';
  return `<ul class="small" style="padding-left:1.1rem;margin:0">${sources.map(s => `
    <li style="margin-bottom:.3rem">
      ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>` : esc(s.label)}
      ${s.license ? `<span class="pill pill-muted" style="margin-left:.35rem">${esc(s.license)}</span>` : ''}
    </li>`).join('')}</ul>
    ${retrievedAt ? `<p class="tiny muted" style="margin-top:.5rem">Ngày lấy dữ liệu: ${esc(fmtDate(retrievedAt))}</p>` : ''}`;
}

export function codeChips(items) {
  return `<div class="chip-cloud">${items.filter(Boolean).map(c => `<span class="code-chip">${esc(c)}</span>`).join('')}</div>`;
}

export function facts(items) {
  return `<dl class="facts">${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>`;
}

export function tabBar(tabs, activeId) {
  return `<div class="tabs" role="tablist">${tabs.map(t => `
    <button class="tab ${t.id === activeId ? 'active' : ''}" role="tab" data-tab="${esc(t.id)}" aria-selected="${t.id === activeId}">${esc(t.label)}${t.count !== undefined ? ` <span class="tiny muted">${fmt(t.count)}</span>` : ''}</button>`).join('')}</div>`;
}

export function mountTabs(defaultId) {
  const buttons = [...document.querySelectorAll('[data-tab]')];
  const panels = [...document.querySelectorAll('[data-tab-panel]')];
  const activate = (id) => {
    buttons.forEach(b => {
      const on = b.dataset.tab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    panels.forEach(p => { p.hidden = p.dataset.tabPanel !== id; });
  };
  buttons.forEach(b => b.addEventListener('click', () => activate(b.dataset.tab)));
  activate(defaultId || buttons[0]?.dataset.tab);
}

export function downloadJson(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function toast(message, ms = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => el.classList.remove('show'), ms);
}

let statsPromise = null;
export function getStats(force = false) {
  if (!statsPromise || force) {
    statsPromise = fetch('/api/stats').then(r => {
      if (!r.ok) throw new Error('Không tải được thống kê');
      return r.json();
    }).catch(err => { statsPromise = null; throw err; });
  }
  return statsPromise;
}
