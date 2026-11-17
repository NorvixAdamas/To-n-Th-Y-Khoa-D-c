/** Application shell: hash router, global search, navigation. */
import { render, errorState, loadingBlock, setActiveNav, esc, fmt, toast } from './ui.js';
import { debounce, getJson } from './api.js';
import {
  viewHome, viewDiseases, viewDisease, viewSymptoms, viewSymptom, viewAnatomy, viewAnatomyDetail,
  viewDrugs, viewDrug, viewLabs, viewLab, viewOrganisms, viewOrganism,
  viewGenes, viewGene, viewCodes, viewResearch, viewTrials, viewSearch, viewAssistant,
  viewAbout, viewNotFound, disposeView
} from './views.js';

const app = document.getElementById('app');
let navToken = 0;

function parseHash() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart || '/';
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { path, segments, params: new URLSearchParams(queryPart) };
}

const routes = [
  { match: p => p === '/', view: viewHome },
  { match: p => p === '/diseases', view: viewDiseases },
  { match: p => p.startsWith('/diseases/'), view: viewDisease, slug: true },
  { match: p => p === '/symptoms', view: viewSymptoms },
  { match: p => p.startsWith('/symptoms/'), view: viewSymptom, slug: true },
  { match: p => p === '/anatomy', view: viewAnatomy },
  { match: p => p.startsWith('/anatomy/'), view: viewAnatomyDetail, slug: true },
  { match: p => p === '/drugs', view: viewDrugs },
  { match: p => p.startsWith('/drugs/'), view: viewDrug, slug: true },
  { match: p => p === '/labs', view: viewLabs },
  { match: p => p.startsWith('/labs/'), view: viewLab, slug: true },
  { match: p => p === '/organisms', view: viewOrganisms },
  { match: p => p.startsWith('/organisms/'), view: viewOrganism, slug: true },
  { match: p => p === '/genes', view: viewGenes },
  { match: p => p.startsWith('/genes/'), view: viewGene, slug: true },
  { match: p => p === '/codes', view: viewCodes },
  { match: p => p === '/research', view: viewResearch },
  { match: p => p === '/trials', view: viewTrials },
  { match: p => p === '/search', view: viewSearch },
  { match: p => p === '/assistant', view: viewAssistant },
  { match: p => p === '/about', view: viewAbout }
];

async function route() {
  const { path, segments, params } = parseHash();
  const token = ++navToken;
  const routeDef = routes.find(r => r.match(path));
  document.title = `${titleFor(path, segments)} — Global Medical Encyclopedia`;
  closeMobileMenu();
  closeSuggest();
  if (!routeDef) { disposeView(); viewNotFound(); return; }
  disposeView();
  app.innerHTML = loadingBlock();
  try {
    if (routeDef.slug) {
      const slug = segments.slice(1).join('/');
      await routeDef.view(params, slug);
    } else {
      await routeDef.view(params);
    }
  } catch (err) {
    if (token !== navToken) return;
    disposeView();
    app.innerHTML = `<div class="card" style="margin-top:1rem">${errorState(err)}</div>`;
  }
}

function titleFor(path, segments) {
  if (path === '/') return 'Bách khoa toàn thư y khoa toàn cầu';
  const map = {
    diseases: 'Bệnh học toàn cầu', symptoms: 'Bộ khám phá triệu chứng', anatomy: 'Giải phẫu tương tác 3D',
    drugs: 'Dược điển toàn cầu', labs: 'Thư viện xét nghiệm', organisms: 'Vi sinh & tác nhân gây bệnh',
    genes: 'Gene & di truyền', codes: 'Mã bệnh ICD-10-CM', research: 'Nghiên cứu y khoa', trials: 'Thử nghiệm lâm sàng',
    search: 'Tìm kiếm toàn hệ thống', assistant: 'Trợ lý tri thức y khoa', about: 'Về nền tảng'
  };
  return map[segments[0]] || map[path.replace('/', '')] || 'Global Medical Encyclopedia';
}

/* ------------------------------------------------------------------ */
/* Header behaviours                                                   */
/* ------------------------------------------------------------------ */

const menuToggle = document.getElementById('menuToggle');
const mainNav = document.getElementById('mainNav');
menuToggle?.addEventListener('click', () => {
  const open = mainNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
});
function closeMobileMenu() {
  mainNav?.classList.remove('open');
  menuToggle?.setAttribute('aria-expanded', 'false');
}

const form = document.getElementById('headerSearchForm');
const input = document.getElementById('headerSearchInput');
const suggestBox = document.getElementById('suggestBox');

function closeSuggest() {
  if (suggestBox) { suggestBox.hidden = true; suggestBox.innerHTML = ''; }
}

async function loadSuggestions(value) {
  if (!suggestBox) return;
  const q = value.trim();
  if (q.length < 2) { closeSuggest(); return; }
  try {
    const data = await getJson(`/api/suggest?q=${encodeURIComponent(q)}`);
    if (!data.suggestions?.length) { closeSuggest(); return; }
    suggestBox.innerHTML = data.suggestions.map(s => `
      <a class="suggest-item" href="${esc(s.url)}">
        <span class="s-type">${esc(s.typeLabel)}</span>
        <span><span class="s-title">${esc(s.title)}</span>${s.subtitle ? `<br><span class="s-sub">${esc(s.subtitle)}</span>` : ''}</span>
      </a>`).join('');
    suggestBox.hidden = false;
  } catch { closeSuggest(); }
}

input?.addEventListener('input', debounce(e => loadSuggestions(e.target.value), 200));
input?.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSuggest();
  if (e.key === 'ArrowDown' && !suggestBox.hidden) {
    e.preventDefault();
    suggestBox.querySelector('a')?.focus();
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.header-search')) closeSuggest();
});

form?.addEventListener('submit', e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  closeSuggest();
  location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

// Keyboard shortcut: "/" focuses global search.
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
    e.preventDefault();
    input?.focus();
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

document.getElementById('footerYear').textContent = new Date().getFullYear();
window.addEventListener('hashchange', route);
if (!location.hash) location.hash = '#/';
route();

getJson('/api/stats').then(stats => {
  const el = document.getElementById('headerSourceCount');
  if (el) el.textContent = `${fmt(stats.counts.diseases)} bệnh · ${stats.sources.length} nguồn dữ liệu`;
}).catch(() => {
  const el = document.getElementById('headerSourceCount');
  if (el) el.textContent = 'Không tải được dữ liệu';
});

window.addEventListener('error', event => {
  if (event.message?.includes('ResizeObserver')) return;
  console.error(event.error || event.message);
});

setActiveNav('home');
void toast;
