/** All encyclopedia views. Data is always fetched from the real API. */
import { getJson, postJson } from './api.js';
import {
  render, setActiveNav, breadcrumb, pageHead, pagination, callout, emptyState, errorState,
  loadingBlock, sourceList, codeChips, facts, tabBar, mountTabs, toast, getStats,
  esc, fmt, fmtDate, href, pct
} from './ui.js';
import { ORGANS, LAYERS, createAnatomyViewer } from './anatomy.js';

let activeViewer = null;
let trialNextToken = null;

export function disposeView() {
  if (activeViewer) { activeViewer.dispose(); activeViewer = null; }
}

const SOURCE_LABELS = {
  mondo: 'MONDO', hpo: 'HPO', orphadata: 'Orphanet', uberon: 'Uberon', openfda: 'openFDA',
  dailymed: 'DailyMed', ncbi_taxonomy: 'NCBI Taxonomy', pubmed: 'PubMed', europepmc: 'Europe PMC',
  clinicaltrials: 'ClinicalTrials.gov', medlineplus: 'MedlinePlus', ncbi_gene: 'NCBI Gene',
  doid: 'Human Disease Ontology', icd10cm: 'ICD-10-CM', reactome: 'Reactome', uniprot: 'UniProt',
  openalex: 'OpenAlex', crossref: 'Crossref'
};

function statusPill(status) {
  const map = { ready: 'Đã đồng bộ', syncing: 'Đang đồng bộ', failed: 'Lỗi', not_synced: 'Chưa đồng bộ' };
  return `<span class="status-pill status-${esc(status)}">${esc(map[status] || status)}</span>`;
}

function sourceName(slug) { return SOURCE_LABELS[slug] || slug || 'Nguồn không xác định'; }

function safeExternal(url, label) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad');
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  } catch { return esc(label); }
}

/* ================================================================== */
/* Home                                                               */
/* ================================================================== */

export async function viewHome() {
  setActiveNav('home');
  const stats = await getStats();
  const c = stats.counts;
  const readySources = stats.sources.filter(s => s.status === 'ready').length;
  const topCategories = [...stats.categories].filter(x => x.disease_count > 0).sort((a, b) => b.disease_count - a.disease_count);
  render(`
    <section class="hero">
      <span class="eyebrow"><span class="live-dot"></span> One platform · All medical knowledge</span>
      <h1>Bách khoa toàn thư y khoa <em>toàn cầu</em>, có nguồn và có mã định danh.</h1>
      <p class="hero-sub">Tra cứu bệnh học, kiểu hình, thuốc, giải phẫu, gene, xét nghiệm, vi sinh và nghiên cứu khoa học trên một nền tảng duy nhất. Mỗi bản ghi hiển thị mã nguồn, giấy phép và ngày cập nhật.</p>
      <div class="hero-actions">
        <a class="btn btn-cyan" href="#/search">Tra cứu toàn hệ thống</a>
        <a class="btn btn-ghost" href="#/diseases">Khám phá bệnh học</a>
        <a class="btn btn-ghost" href="#/assistant">Hỏi trợ lý tri thức AI</a>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><strong>${fmt(c.diseases)}</strong><span>Bệnh &amp; hội chứng</span></div>
        <div class="hero-stat"><strong>${fmt(c.symptoms)}</strong><span>Thuật ngữ kiểu hình</span></div>
        <div class="hero-stat"><strong>${fmt(c.drugs)}</strong><span>Sản phẩm thuốc</span></div>
        <div class="hero-stat"><strong>${fmt(c.anatomy)}</strong><span>Cấu trúc giải phẫu</span></div>
        <div class="hero-stat"><strong>${fmt(stats.sources.length)}</strong><span>Nguồn dữ liệu tích hợp</span></div>
      </div>
      <p class="hero-note">Cập nhật gần nhất: ${stats.lastSync ? esc(fmtDate(stats.lastSync)) : 'chưa có lần đồng bộ nào'} · ${readySources}/${stats.sources.length} nguồn ở trạng thái sẵn sàng · ${fmt(stats.linkedDiseases)} bệnh có liên kết triệu chứng (${stats.coverage.symptomCoverage}% số bệnh).</p>
    </section>

    <section class="section">
      <div class="section-head">
        <div><h2>Thư viện tri thức</h2><p>Mỗi mô-đun đọc dữ liệu thật từ cơ sở dữ liệu SQLite với chỉ mục tìm kiếm FTS5, không có danh sách mẫu.</p></div>
        <a href="#/about">Phương pháp &amp; nguồn →</a>
      </div>
      <div class="module-grid">
        ${[
          ['diseases', 'Bệnh học toàn cầu', 'Danh mục bệnh MONDO/Orphanet với mã ICD-10, MONDO, ORPHA và kiểu hình.', c.diseases, 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5v10M7 12h10'],
          ['symptoms', 'Bộ khám phá triệu chứng', 'Chọn nhiều kiểu hình để tìm bệnh có liên kết trong dữ liệu HPO/Orphanet.', c.symptoms, 'M4 12h4l2-6 4 12 2-6h4'],
          ['anatomy', 'Giải phẫu tương tác 3D', 'Mô hình WebGL thật với các lớp giải phẫu và thuật ngữ Uberon.', c.anatomy, 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 21v-4a6 6 0 0 1 12 0v4'],
          ['drugs', 'Dược điển toàn cầu', 'Sản phẩm thuốc openFDA: hoạt chất, dạng bào chế, nhà sản xuất, nhãn thuốc.', c.drugs, 'M8 3h8v4h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2V3Z'],
          ['labs', 'Bách khoa xét nghiệm', 'Mục đích, mẫu bệnh phẩm và cảnh báo về khoảng tham chiếu theo phòng xét nghiệm.', c.labs, 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3'],
          ['organisms', 'Vi sinh &amp; tác nhân', 'Phân loại NCBI Taxonomy của vi khuẩn, virus, nấm và ký sinh trùng.', c.organisms, 'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Z'],
          ['genes', 'Gene &amp; di truyền', 'Gene người từ NCBI Gene, liên kết bệnh Orphanet, pathway Reactome và protein UniProt.', c.genes, 'M4 4c8 0 8 16 16 16M20 4C12 4 12 20 4 20'],
          ['codes', 'Mã bệnh ICD-10-CM', 'Tra mã và mô tả chẩn đoán chính thức từ bộ mã CMS 2026 (public domain).', c.icdCodes, 'M4 6h16M4 12h10M4 18h7M17 14l3 3-3 3'],
          ['research', 'Nghiên cứu y khoa', 'Tìm PubMed, Europe PMC, Crossref, OpenAlex và thử nghiệm lâm sàng theo bệnh, DOI, năm.', c.articles, 'M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14l-4-3-4 3-4-3-4 3Z']
        ].map(([route, title, text, count, path]) => `
          <a class="card card-hover module-tile" href="#/${route}" style="text-decoration:none;color:inherit">
            <span class="m-count">${fmt(count)}</span>
            <span class="m-icon"><svg viewBox="0 0 24 24"><path d="${path}"/></svg></span>
            <h3>${title}</h3><p>${text}</p>
          </a>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div><h2>Danh mục bệnh học</h2><p>Số lượng bệnh đã nhập theo từng nhóm chuyên khoa. Nhóm “Khác” là các bản ghi chưa ánh xạ được vào cây phân loại đã chọn.</p></div>
        <a href="#/diseases">Xem toàn bộ →</a>
      </div>
      <div class="category-grid">
        ${topCategories.slice(0, 18).map(cat => `
          <a class="category-tile" href="${href('/diseases', { category: cat.slug })}">
            <span><strong>${esc(cat.name_vi)}</strong><span>${esc(cat.name_en)}</span></span>
            <span class="ct-count">${fmt(cat.disease_count)}</span>
          </a>`).join('')}
      </div>
    </section>

    <section class="section grid grid-2">
      <div class="card card-pad-lg">
        <h2 style="font-size:1.2rem">Độ bao phủ dữ liệu</h2>
        <p class="small muted">Chỉ số được tính trực tiếp từ cơ sở dữ liệu, không phải số liệu minh họa.</p>
        <div class="stack">
          <div>
            <div class="flex between small"><span>Bệnh có liên kết kiểu hình</span><strong>${stats.coverage.symptomCoverage}%</strong></div>
            <div class="progress"><span style="width:${stats.coverage.symptomCoverage}%"></span></div>
            <p class="tiny muted">${fmt(stats.linkedDiseases)} / ${fmt(c.diseases)} bệnh</p>
          </div>
          <div>
            <div class="flex between small"><span>Bệnh có tên tiếng Việt từ nguồn đã xác thực</span><strong>${stats.coverage.vietnameseCoverage}%</strong></div>
            <div class="progress"><span style="width:${stats.coverage.vietnameseCoverage}%"></span></div>
            <p class="tiny muted">${fmt(stats.translated)} bệnh có bản dịch chính thức. Tên tiếng Anh và khoa học luôn được hiển thị song song.</p>
          </div>
          <div>
            <div class="flex between small"><span>Liên kết bệnh – triệu chứng</span><strong>${fmt(c.diseaseSymptoms)}</strong></div>
            <div class="flex between small"><span>Liên kết gene – bệnh</span><strong>${fmt(c.diseaseGenes)}</strong></div>
            <div class="flex between small"><span>Tổng mã định danh bệnh</span><strong>${fmt(c.identifiers)}</strong></div>
          </div>
        </div>
        ${callout('warn', 'Phạm vi', 'Kho dữ liệu đang bao phủ ' + fmt(c.diseases) + ' bản ghi bệnh từ các nguồn mở. Đây chưa phải toàn bộ mọi bệnh đã được ghi nhận trên thế giới.')}
      </div>
      <div class="card card-pad-lg">
        <h2 style="font-size:1.2rem">Trạng thái nguồn dữ liệu</h2>
        <p class="small muted">Giấy phép và thời điểm đồng bộ được lưu trong bảng <span class="mono">sources</span>.</p>
        <div>
          ${stats.sources.slice(0, 9).map(s => `
            <div class="source-row">
              <div><div class="src-name">${esc(s.name)}</div><div class="src-sub">${esc(s.license_name)}</div></div>
              <div class="small">${fmt(s.record_count)}</div>
              <div class="tiny muted">${s.last_success_at ? esc(fmtDate(s.last_success_at)) : '—'}</div>
              <div>${statusPill(s.status)}</div>
            </div>`).join('')}
        </div>
        <p class="mt-2"><a class="btn btn-outline btn-sm" href="#/admin">Mở trung tâm dữ liệu</a></p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Trợ lý tri thức y khoa</h2><p>Truy xuất dữ liệu đã tích hợp, trả lời kèm nguồn. Không chẩn đoán và không kê đơn.</p></div></div>
      <div class="card card-pad-lg grid grid-2" style="align-items:center">
        <div>
          <h3>MEDICAL KNOWLEDGE AI</h3>
          <p class="small">Hỏi về một bệnh, so sánh hai bệnh, giải thích một xét nghiệm hoặc tìm nghiên cứu liên quan. Trợ lý chỉ trả lời khi tìm thấy bản ghi nguồn; nếu không, trợ lý nói rõ là không đủ dữ liệu.</p>
          <a class="btn btn-primary" href="#/assistant">Bắt đầu hỏi</a>
        </div>
        <div class="chip-cloud">
          <a href="${href('/assistant', { q: 'Đái tháo đường type 2 là gì?' })}">Đái tháo đường type 2 là gì?</a>
          <a href="${href('/assistant', { q: 'So sánh hen phế quản và COPD' })}">So sánh hen và COPD</a>
          <a href="${href('/assistant', { q: 'Xét nghiệm HbA1c dùng để làm gì?' })}">HbA1c dùng để làm gì?</a>
          <a href="${href('/assistant', { q: 'Tìm nghiên cứu về Alzheimer' })}">Nghiên cứu về Alzheimer</a>
        </div>
      </div>
    </section>
  `);
}

/* ================================================================== */
/* Diseases                                                           */
/* ================================================================== */

export async function viewDiseases(params) {
  setActiveNav('diseases');
  const stats = await getStats();
  const filters = {
    q: params.get('q') || '', category: params.get('category') || '',
    rare: params.get('rare') || '', sort: params.get('sort') || 'name', page: Number(params.get('page') || 1)
  };
  const data = await getJson(`/api/diseases?${new URLSearchParams({
    q: filters.q, category: filters.category, rare: filters.rare, sort: filters.sort,
    page: String(filters.page), pageSize: '24'
  })}`);
  const activeCategory = stats.categories.find(c => c.slug === filters.category);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Bệnh học toàn cầu' }])}
    ${pageHead({
      kicker: 'Global Disease Encyclopedia',
      title: 'Bệnh học toàn cầu',
      lead: `${fmt(data.total)} bản ghi phù hợp. Dữ liệu từ MONDO, Orphanet và HPO; mỗi bệnh có mã định danh, nguồn và ngày cập nhật.`,
      actions: `<a class="btn btn-outline btn-sm" href="#/search">Tìm kiếm toàn hệ thống</a>`
    })}
    <form class="toolbar" id="diseaseFilters" role="search">
      <div class="field" style="flex:1 1 260px">
        <label for="dq" class="sr-only">Từ khóa</label>
        <input class="input input-search" id="dq" name="q" value="${esc(filters.q)}" placeholder="Tên bệnh tiếng Anh, tiếng Việt, mã MONDO, ICD-10, ORPHA…" style="flex:1">
      </div>
      <div class="field">
        <label for="dcat">Nhóm</label>
        <select class="select" id="dcat" name="category">
          <option value="">Tất cả nhóm</option>
          ${stats.categories.map(c => `<option value="${esc(c.slug)}" ${c.slug === filters.category ? 'selected' : ''}>${esc(c.name_vi)} (${fmt(c.disease_count)})</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="dsort">Sắp xếp</label>
        <select class="select" id="dsort" name="sort">
          <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>Tên A → Z</option>
          <option value="symptoms" ${filters.sort === 'symptoms' ? 'selected' : ''}>Nhiều kiểu hình nhất</option>
          <option value="recent" ${filters.sort === 'recent' ? 'selected' : ''}>Cập nhật gần nhất</option>
        </select>
      </div>
      <div class="field">
        <label><input type="checkbox" name="rare" value="1" ${filters.rare === '1' ? 'checked' : ''}> Bệnh hiếm</label>
      </div>
      <button class="btn btn-primary btn-sm" type="submit">Lọc</button>
      ${(filters.q || filters.category || filters.rare) ? '<a class="btn btn-outline btn-sm" href="#/diseases">Xóa lọc</a>' : ''}
    </form>
    ${activeCategory ? `<p class="small muted">Đang xem nhóm <strong>${esc(activeCategory.name_vi)}</strong> — ${esc(activeCategory.description || '')}</p>` : ''}
    ${data.results.length ? `<div class="result-list">${data.results.map(d => `
      <article class="card card-hover result-card">
        <div class="rc-top">
          <span class="rc-type">Bệnh</span>
          <h3><a href="#/diseases/${encodeURIComponent(d.slug)}">${esc(d.name_en)}</a></h3>
          ${d.is_rare ? '<span class="pill pill-warn">Bệnh hiếm</span>' : ''}
          ${d.category_vi ? `<span class="pill pill-muted">${esc(d.category_vi)}</span>` : ''}
        </div>
        <div class="rc-sub">${d.name_vi ? `${esc(d.name_vi)} · ` : ''}${esc(d.mondo_id || '')}${d.orphanet_code ? ` · ORPHA:${esc(d.orphanet_code)}` : ''}${d.symptom_count ? ` · ${fmt(d.symptom_count)} kiểu hình` : ''}</div>
        <p>${esc(d.excerpt || 'Nguồn dữ liệu chưa cung cấp mô tả cho bệnh này.')}</p>
        <div class="rc-codes">${d.icd10 ? `<span class="code-chip">ICD-10: ${esc(d.icd10)}</span>` : ''}${d.mondo_id ? `<span class="code-chip">${esc(d.mondo_id)}</span>` : ''}${d.orphanet_code ? `<span class="code-chip">ORPHA:${esc(d.orphanet_code)}</span>` : ''}</div>
      </article>`).join('')}</div>` : emptyState('Không tìm thấy bệnh phù hợp', 'Thử từ khóa ngắn hơn, tên tiếng Anh hoặc mã định danh.')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: (p) => href('/diseases', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('diseaseFilters');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    location.hash = `#/diseases${buildQuery({
      q: fd.get('q'), category: fd.get('category'), sort: fd.get('sort'),
      rare: fd.get('rare') ? '1' : '', page: 1
    })}`;
  });
  form.querySelectorAll('select').forEach(s => s.addEventListener('change', () => form.requestSubmit()));
}

function buildQuery(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== undefined && v !== null) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function viewDisease(params, slug) {
  setActiveNav('diseases');
  const d = await getJson(`/api/diseases/${encodeURIComponent(slug)}`);
  const ids = d.identifiers.reduce((acc, row) => {
    (acc[row.scheme] ||= []).push(row.value);
    return acc;
  }, {});
  const identifierRows = Object.entries(ids).map(([scheme, values]) => `
    <tr><td><span class="pill pill-muted">${esc(scheme.toUpperCase())}</span></td><td class="mono">${values.map(esc).join(', ')}</td></tr>`).join('');
  const symptomRows = d.symptoms.map(s => `
    <tr>
      <td><a href="#/symptoms/${encodeURIComponent(s.slug)}">${esc(s.name_en)}</a>${s.name_vi ? `<div class="tiny muted">${esc(s.name_vi)}</div>` : ''}</td>
      <td class="mono tiny">${esc(s.hpo_id || '')}</td>
      <td>${s.frequency_text ? `<span class="pill pill-cyan">${esc(s.frequency_text)}</span>` : '<span class="tiny muted">Nguồn không nêu tần suất</span>'}</td>
      <td class="tiny muted">${esc(sourceName(s.source_slug))}${s.evidence ? ` · ${esc(s.evidence)}` : ''}</td>
    </tr>`).join('');
  const related = d.related.map(r => `<a href="#/diseases/${encodeURIComponent(r.slug)}">${esc(r.name_en)} <span class="tiny muted">(${fmt(r.shared)} kiểu hình chung)</span></a>`).join('');
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Bệnh học', href: '#/diseases' }, { label: d.name_en }])}
    <header class="detail-head">
      <div class="dh-sub">${esc(d.category_vi || 'Chưa phân nhóm')} · ${esc(d.mondo_id || '')}</div>
      <h1>${esc(d.name_en)}</h1>
      ${d.name_vi ? `<div class="dh-sub">${esc(d.name_vi)}${d.name_vi_status && d.name_vi_status !== 'official' ? ' <span class="pill pill-muted" title="Bản dịch do nền tảng biên tập, chưa được nguồn y khoa xác thực">Bản dịch hệ thống · chưa xác thực</span>' : ''}</div>` : '<div class="dh-sub tiny">Chưa có bản dịch tiếng Việt được xác thực — hiển thị tên gốc từ nguồn.</div>'}
      <div class="dh-codes">
        ${d.mondo_id ? `<span class="code-chip">${esc(d.mondo_id)}</span>` : ''}
        ${d.orphanet_code ? `<span class="code-chip">ORPHA:${esc(d.orphanet_code)}</span>` : ''}
        ${d.icd10 ? `<span class="code-chip">ICD-10: ${esc(d.icd10)}</span>` : ''}
        ${d.doid ? `<span class="code-chip">DOID:${esc(d.doid)}</span>` : ''}
        ${d.is_rare ? '<span class="pill">Bệnh hiếm</span>' : ''}
      </div>
      <div class="dh-actions">
        <button class="btn btn-cyan btn-sm" id="printDisease">In / Lưu PDF</button>
        <a class="btn btn-ghost btn-sm" href="/api/export/disease/${encodeURIComponent(d.slug)}" download="${esc(d.slug)}.json">Tải JSON</a>
        <a class="btn btn-ghost btn-sm" href="#/trials${buildQuery({ q: d.name_en })}">Thử nghiệm lâm sàng</a>
      </div>
    </header>

    ${tabBar([
      { id: 'overview', label: 'Tổng quan' },
      { id: 'symptoms', label: 'Triệu chứng', count: d.symptoms.length },
      { id: 'genetics', label: 'Gene & tác nhân', count: d.genes.length + d.organisms.length },
      { id: 'related', label: 'Liên quan', count: d.related.length },
      { id: 'research', label: 'Nghiên cứu' },
      { id: 'sources', label: 'Nguồn' }
    ], 'overview')}

    <div data-tab-panel="overview" class="two-col">
      <div class="stack">
        <section class="card card-pad-lg">
          <h2 style="font-size:1.25rem">Định nghĩa</h2>
          <p>${d.definition ? esc(d.definition) : '<em class="muted">Chưa có dữ liệu đáng tin cậy trong nguồn đã tích hợp.</em>'}</p>
          ${d.definition_source ? `<p class="tiny muted">Nguồn định nghĩa: ${esc(d.definition_source)}</p>` : ''}
        </section>
        ${d.synonyms.length ? `<section class="card card-pad-lg"><h2 style="font-size:1.1rem">Tên đồng nghĩa</h2><div class="chip-cloud">${d.synonyms.slice(0, 40).map(s => `<span class="code-chip">${esc(s.name)}${s.lang !== 'en' ? ` (${esc(s.lang)})` : ''}</span>`).join('')}</div></section>` : ''}
        ${related ? `<section class="card card-pad-lg"><h2 style="font-size:1.1rem">Bệnh có biểu hiện tương đồng</h2><div class="chip-cloud">${related}</div><p class="tiny muted mt-1">Tương đồng dựa trên số kiểu hình HPO/Orphanet dùng chung; không phải quan hệ nhân quả hay chẩn đoán phân biệt đầy đủ.</p></section>` : ''}
      </div>
      <aside class="stack side-card">
        <div class="card">
          <h3 style="font-size:.95rem">Thông tin nguồn</h3>
          ${facts([
            ['Phân nhóm', esc(d.category_vi || '—')],
            ['Bệnh hiếm', d.is_rare ? 'Có (theo Orphanet/MONDO)' : 'Không ghi nhận'],
            ['Di truyền', d.inheritance ? esc(d.inheritance) : '<span class="muted">Chưa có dữ liệu đáng tin cậy</span>'],
            ['Dịch tễ', d.prevalence ? esc(d.prevalence) : '<span class="muted">Chưa có dữ liệu đáng tin cậy</span>'],
            ['Nguồn chính', esc(sourceName(d.source_slug))],
            ['Cập nhật', d.updated_at ? esc(fmtDate(d.updated_at)) : '—']
          ])}
        </div>
        <div class="card">
          <h3 style="font-size:.95rem">Mã định danh</h3>
          ${identifierRows ? `<div class="table-wrap"><table class="data"><tbody>${identifierRows}</tbody></table></div>` : '<p class="tiny muted">Chưa có mã định danh bổ sung.</p>'}
        </div>
        ${d.parents.length ? `<div class="card"><h3 style="font-size:.95rem">Lớp bệnh rộng hơn</h3><div class="chip-cloud">${d.parents.map(p => `<a href="#/diseases/${encodeURIComponent(p.slug)}">${esc(p.name_en)}</a>`).join('')}</div></div>` : ''}
        ${d.children.length ? `<div class="card"><h3 style="font-size:.95rem">Phân nhóm hẹp hơn</h3><div class="chip-cloud">${d.children.map(p => `<a href="#/diseases/${encodeURIComponent(p.slug)}">${esc(p.name_en)}</a>`).join('')}</div></div>` : ''}
        ${callout('danger', 'Không dùng để tự chẩn đoán', 'Thông tin bệnh học chỉ nhằm mục đích giáo dục. Việc chẩn đoán và điều trị phải do nhân viên y tế có thẩm quyền thực hiện.')}
      </aside>
    </div>

    <div data-tab-panel="symptoms" hidden>
      ${d.symptoms.length ? `
        <div class="toolbar" style="justify-content:space-between">
          <span class="small muted">${fmt(d.symptoms.length)} kiểu hình ghi nhận từ HPO/Orphanet. Tần suất do nguồn cung cấp.</span>
          <a class="btn btn-outline btn-sm" href="#/symptoms">Mở bộ khám phá triệu chứng</a>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Triệu chứng / kiểu hình</th><th>HPO</th><th>Tần suất</th><th>Nguồn</th></tr></thead>
          <tbody>${symptomRows}</tbody>
        </table></div>
        ${callout('warn', 'Lưu ý diễn giải', 'Sự hiện diện một kiểu hình trong danh sách không đồng nghĩa với việc một người mắc bệnh này. Không thể kết luận chẩn đoán chỉ dựa trên triệu chứng.')}
      ` : emptyState('Chưa có liên kết triệu chứng', 'Nguồn dữ liệu hiện tại chưa có annotation kiểu hình cho bệnh này.')}
    </div>

    <div data-tab-panel="genetics" hidden class="stack">
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Gene liên quan (${fmt(d.genes.length)})</h2>
        ${d.genes.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Gene</th><th>Tên</th><th>Nhiễm sắc thể</th><th>Liên kết nguồn</th></tr></thead><tbody>
          ${d.genes.map(g => `<tr><td><a href="#/genes/${encodeURIComponent(g.slug)}"><strong>${esc(g.symbol)}</strong></a></td><td>${esc(g.name || '—')}</td><td>${esc(g.chromosome || '—')}</td><td class="tiny">${esc(g.association_type || '—')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted small">Chưa có liên kết gene–bệnh đã xác thực trong kho dữ liệu.</p>'}
        ${callout('warn', 'Di truyền học', 'Thông tin gene và biến thể không đủ để kết luận chẩn đoán cho một cá nhân. Cần tư vấn di truyền và xét nghiệm được chỉ định bởi bác sĩ.')}
      </div>
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Tác nhân gây bệnh (${fmt(d.organisms.length)})</h2>
        ${d.organisms.length ? `<div class="chip-cloud">${d.organisms.map(o => `<a href="#/organisms/${encodeURIComponent(o.slug)}">${esc(o.name_scientific)}${o.name_common ? ` (${esc(o.name_common)})` : ''}</a>`).join('')}</div>` : '<p class="muted small">Nguồn dữ liệu chưa ghi nhận tác nhân gây bệnh cho bản ghi này.</p>'}
      </div>
    </div>

    <div data-tab-panel="related" hidden class="stack">
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Quan hệ phân loại</h2>
        <div class="grid grid-2">
          <div><h3 style="font-size:.95rem">Bệnh rộng hơn</h3>${d.parents.length ? `<div class="chip-cloud">${d.parents.map(p => `<a href="#/diseases/${encodeURIComponent(p.slug)}">${esc(p.name_en)}</a>`).join('')}</div>` : '<p class="small muted">Không có.</p>'}</div>
          <div><h3 style="font-size:.95rem">Bệnh hẹp hơn</h3>${d.children.length ? `<div class="chip-cloud">${d.children.map(p => `<a href="#/diseases/${encodeURIComponent(p.slug)}">${esc(p.name_en)}</a>`).join('')}</div>` : '<p class="small muted">Không có.</p>'}</div>
        </div>
      </div>
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Biểu hiện tương đồng</h2>
        ${d.related.length ? `<div class="chip-cloud">${related}</div>` : '<p class="small muted">Chưa đủ dữ liệu kiểu hình để tính tương đồng.</p>'}
      </div>
    </div>

    <div data-tab-panel="research" hidden>
      <div class="card card-pad-lg">
        <div class="flex between wrap center gap-1">
          <div><h2 style="font-size:1.15rem">Nghiên cứu &amp; thử nghiệm liên quan</h2><p class="small muted">Truy vấn trực tiếp PubMed, Europe PMC và ClinicalTrials.gov theo tên bệnh.</p></div>
          <button class="btn btn-primary btn-sm" id="loadResearch">Tìm nghiên cứu</button>
        </div>
        <div id="researchResults" class="mt-2"></div>
      </div>
    </div>

    <div data-tab-panel="sources" hidden class="stack">
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Nguồn tham khảo &amp; giấy phép</h2>
        ${sourceList(d.sources, d.retrieved_at)}
        ${callout('info', 'Nguyên tắc dữ liệu', 'Nền tảng không tự tạo nội dung y khoa. Các trường thiếu dữ liệu được hiển thị là “Chưa có dữ liệu đáng tin cậy”. Nếu các nguồn mâu thuẫn, nền tảng hiển thị nguồn và ngày công bố.')}
      </div>
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Dữ liệu thô</h2>
        <p class="small">Tải bản ghi JSON kèm mã định danh, triệu chứng, gene và nguồn.</p>
        <a class="btn btn-outline btn-sm" href="/api/export/disease/${encodeURIComponent(d.slug)}" download="${esc(d.slug)}.json">Tải JSON</a>
        <button class="btn btn-outline btn-sm" id="copyCitation">Sao chép trích dẫn</button>
        <p class="tiny muted mt-1" id="citationText">${esc(d.name_en)}. Global Medical Encyclopedia. ${esc(d.mondo_id || '')}${d.orphanet_code ? ` / ORPHA:${d.orphanet_code}` : ''}. Truy cập ${esc(fmtDate(new Date().toISOString()))}.</p>
      </div>
    </div>
  `);
  mountTabs('overview');
  document.getElementById('printDisease')?.addEventListener('click', () => window.print());
  document.getElementById('copyCitation')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('citationText').textContent);
      toast('Đã sao chép trích dẫn');
    } catch { toast('Trình duyệt không cho phép sao chép tự động'); }
  });
  document.getElementById('loadResearch')?.addEventListener('click', async (e) => {
    const box = document.getElementById('researchResults');
    e.target.disabled = true;
    box.innerHTML = loadingBlock('Đang truy vấn PubMed / Europe PMC…');
    try {
      const r = await getJson(`/api/research?q=${encodeURIComponent(d.name_en)}&pageSize=8&source=all`);
      box.innerHTML = r.results.length ? `<div>${r.results.map(researchCard).join('')}</div>
        <p class="small"><a class="btn btn-outline btn-sm" href="#/research${buildQuery({ q: d.name_en })}">Mở trung tâm nghiên cứu</a></p>` : emptyState('Không tìm thấy bài báo phù hợp');
    } catch (err) { box.innerHTML = errorState(err); }
    e.target.disabled = false;
  });
}

function researchCard(r) {
  return `<article class="research-item">
    <h3>${safeExternal(r.url, r.title || 'Bài báo không có tiêu đề')}</h3>
    <div class="ri-meta">
      <span>${esc(sourceName(r.source))}</span>·<span>${esc(r.journal || 'N/A')}</span>·<span>${esc(r.year || 'N/A')}</span>
      ${r.pmid ? `·<span class="code-chip">PMID ${esc(r.pmid)}</span>` : ''}
      ${r.doi ? `·<span class="code-chip">DOI ${esc(r.doi)}</span>` : ''}
      ${r.isOpenAccess ? '<span class="pill pill-ok">Open Access</span>' : '<span class="pill pill-muted">Kiểm tra giấy phép</span>'}
    </div>
    ${r.authors ? `<div class="ri-authors">${esc(r.authors)}</div>` : ''}
    ${r.abstract ? `<p class="ri-abstract clamped" data-abstract>${esc(r.abstract)}</p><button class="link-btn" data-expand-abstract>Xem abstract đầy đủ</button>` : '<p class="tiny muted">Nguồn không cung cấp abstract.</p>'}
  </article>`;
}

/* ================================================================== */
/* Symptoms                                                           */
/* ================================================================== */

export async function viewSymptoms(params) {
  setActiveNav('symptoms');
  const filters = { q: params.get('q') || '', system: params.get('system') || '', page: Number(params.get('page') || 1) };
  const data = await getJson(`/api/symptoms?${new URLSearchParams({ q: filters.q, system: filters.system, page: String(filters.page), pageSize: '30' })}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Bộ khám phá triệu chứng' }])}
    ${pageHead({
      kicker: 'Symptom Explorer',
      title: 'Bộ khám phá triệu chứng',
      lead: 'Tìm triệu chứng bằng tiếng Việt hoặc tiếng Anh, xem bệnh có liên kết kiểu hình và các triệu chứng thường xuất hiện cùng. Đây không phải công cụ chẩn đoán.'
    })}
    <form class="toolbar" id="symptomFilters">
      <input class="input input-search" name="q" value="${esc(filters.q)}" placeholder="Ví dụ: đau đầu, sốt, ho, khó thở, phát ban…">
      <select class="select" name="system">
        <option value="">Tất cả cơ quan / hệ</option>
        ${data.systems.map(s => `<option value="${esc(s.name)}" ${s.name === filters.system ? 'selected' : ''}>${esc(s.name)} (${fmt(s.c)})</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm">Tìm</button>
      ${(filters.q || filters.system) ? '<a class="btn btn-outline btn-sm" href="#/symptoms">Xóa lọc</a>' : ''}
    </form>
    ${callout('danger', 'Cảnh báo', 'Không thể kết luận bạn mắc bệnh dựa trên triệu chứng. Nếu có dấu hiệu nguy hiểm như khó thở nặng, đau ngực, rối loạn ý thức, co giật, chảy máu không cầm, hãy gọi cấp cứu ngay.')}
    <p class="small muted">${fmt(data.total)} thuật ngữ kiểu hình.</p>
    ${data.results.length ? `<div class="grid grid-3">${data.results.map(s => `
      <article class="card card-hover">
        <div class="flex between wrap center gap-1">
          <h3 style="font-size:.98rem;margin:0"><a href="#/symptoms/${encodeURIComponent(s.slug)}">${esc(s.name_en)}</a></h3>
          <span class="pill pill-cyan">${fmt(s.disease_count)} bệnh</span>
        </div>
        ${s.name_vi ? `<div class="tiny muted">${esc(s.name_vi)}</div>` : ''}
        <div class="rc-sub">${esc(s.organ_system || 'Chưa phân hệ')} · ${esc(s.hpo_id || '')}</div>
        <p class="small" style="color:#3a4f63">${esc((s.definition || 'Nguồn chưa cung cấp định nghĩa.').slice(0, 180))}</p>
      </article>`).join('')}</div>` : emptyState('Không tìm thấy triệu chứng', 'Thử từ khóa khác hoặc tên tiếng Anh.')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/symptoms', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('symptomFilters');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    location.hash = `#/symptoms${buildQuery({ q: fd.get('q'), system: fd.get('system'), page: 1 })}`;
  });
  form.querySelector('select').addEventListener('change', () => form.requestSubmit());
}

export async function viewSymptom(params, slug) {
  setActiveNav('symptoms');
  const s = await getJson(`/api/symptoms/${encodeURIComponent(slug)}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Triệu chứng', href: '#/symptoms' }, { label: s.name_en }])}
    <header class="detail-head">
      <div class="dh-sub">${esc(s.organ_system || 'Kiểu hình')} · ${esc(s.hpo_id || '')}</div>
      <h1>${esc(s.name_en)}</h1>
      ${s.name_vi ? `<div class="dh-sub">${esc(s.name_vi)}</div>` : ''}
      <div class="dh-codes">${s.synonyms ? String(s.synonyms).split('|').slice(0, 8).map(x => `<span class="code-chip">${esc(x.trim())}</span>`).join('') : ''}</div>
    </header>
    <div class="two-col mt-2">
      <div class="stack">
        <section class="card card-pad-lg">
          <h2 style="font-size:1.2rem">Định nghĩa</h2>
          <p>${s.definition ? esc(s.definition) : '<em class="muted">Nguồn HPO/Orphanet chưa cung cấp định nghĩa.</em>'}</p>
        </section>
        <section class="card card-pad-lg">
          <h2 style="font-size:1.2rem">Bệnh có ghi nhận triệu chứng (${fmt(s.diseases.length)})</h2>
          ${s.diseases.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Bệnh</th><th>Nhóm</th><th>Tần suất</th><th>Nguồn</th></tr></thead><tbody>
            ${s.diseases.map(d => `<tr>
              <td><a href="#/diseases/${encodeURIComponent(d.slug)}">${esc(d.name_en)}</a>${d.name_vi ? `<div class="tiny muted">${esc(d.name_vi)}</div>` : ''}</td>
              <td class="tiny">${esc(d.category_vi || '—')}</td>
              <td>${d.frequency_text ? `<span class="pill pill-cyan">${esc(d.frequency_text)}</span>` : '<span class="tiny muted">—</span>'}</td>
              <td class="tiny muted">${esc(sourceName(d.source_slug))}</td>
            </tr>`).join('')}
          </tbody></table></div>` : '<p class="small muted">Chưa có bệnh liên kết trong kho dữ liệu.</p>'}
        </section>
        <section class="card card-pad-lg">
          <h2 style="font-size:1.2rem">Triệu chứng thường xuất hiện cùng</h2>
          ${s.cooccurring.length ? `<div class="chip-cloud">${s.cooccurring.map(x => `<a href="#/symptoms/${encodeURIComponent(x.slug)}">${esc(x.name_en)} <span class="tiny muted">(${fmt(x.shared)})</span></a>`).join('')}</div>` : '<p class="small muted">Chưa đủ dữ liệu.</p>'}
          <p class="tiny muted mt-1">Số trong ngoặc là số bệnh cùng chứa cả hai kiểu hình trong dữ liệu HPO/Orphanet. Đây là đồng xuất hiện trong dữ liệu, không phải quan hệ nhân quả.</p>
        </section>
      </div>
      <aside class="stack side-card">
        ${callout('danger', 'Không chẩn đoán', 'Trang này không đưa ra xác suất mắc bệnh và không thay thế thăm khám. Hãy tìm trợ giúp y tế nếu triệu chứng nặng, kéo dài hoặc tiến triển nhanh.')}
        <div class="card"><h3 style="font-size:.95rem">Nguồn</h3>${sourceList(s.sources, s.source_url ? null : null)}</div>
        <div class="card"><h3 style="font-size:.95rem">Liên kết</h3><p class="small"><a href="#/diseases">Tra cứu bệnh học</a><br><a href="#/search${buildQuery({ q: s.name_en })}">Tìm trong toàn hệ thống</a></p></div>
      </aside>
    </div>
  `);
}

/* ================================================================== */
/* Anatomy 3D                                                         */
/* ================================================================== */

export async function viewAnatomy(params) {
  setActiveNav('anatomy');
  disposeView();
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Giải phẫu tương tác 3D' }])}
    ${pageHead({
      kicker: 'Interactive Human Anatomy',
      title: 'Giải phẫu người tương tác 3D',
      lead: 'Mô hình WebGL dựng bằng Three.js: xoay 360°, phóng to, bật/tắt từng lớp giải phẫu, chọn cơ quan để xem thuật ngữ và định nghĩa từ Uberon. Mô hình mang tính sơ đồ giáo dục, không phải mô hình hình thái y khoa chính xác.',
      actions: `<a class="btn btn-outline btn-sm" href="#/search?q=anatomy">Tra cứu thuật ngữ</a>`
    })}
    ${callout('info', 'Về mô hình', 'Đây là mô hình 3D thực thi bằng WebGL, không phải ảnh CSS. Hình dạng cơ quan được đơn giản hóa để dễ tương tác; dữ liệu tên gọi và định nghĩa lấy từ Uberon.')}
    <div class="anatomy-layout mt-2">
      <div class="viewer-panel" id="anatomyViewer" aria-label="Mô hình giải phẫu 3D tương tác">
        <div class="viewer-overlay">
          <div class="viewer-toolbar">
            <button class="vbtn" id="vFront">Mặt trước</button>
            <button class="vbtn" id="vBack">Mặt sau</button>
            <button class="vbtn" id="vRotate">Tự xoay</button>
            <button class="vbtn" id="vReset">Đặt lại</button>
          </div>
          <div class="viewer-legend" id="layerControls">
            <strong style="color:#fff;font-size:.72rem">Lớp giải phẫu</strong>
            ${LAYERS.map(l => `<label><input type="checkbox" data-layer="${l.id}" ${['skin', 'skeleton', 'respiratory', 'circulatory', 'digestive', 'urinary', 'nervous'].includes(l.id) ? 'checked' : ''}><span class="swatch" style="background:${l.color}"></span>${esc(l.label)}</label>`).join('')}
          </div>
          <div class="viewer-hint">Kéo để xoay · cuộn để zoom · nhấn cơ quan để chọn</div>
        </div>
      </div>
      <aside class="stack side-card">
        <div class="card">
          <h3 style="font-size:.98rem;margin-bottom:.5rem">Cơ quan</h3>
          <input class="input" id="organSearch" placeholder="Tìm cơ quan…" style="width:100%;margin-bottom:.5rem">
          <div class="organ-list" id="organList"></div>
        </div>
        <div class="card organ-info" id="organInfo">
          <h3 style="font-size:.98rem">Chọn một cơ quan</h3>
          <p class="small muted">Thông tin giải phẫu và liên kết bệnh học sẽ hiển thị tại đây.</p>
        </div>
      </aside>
    </div>
    <section class="section card card-pad-lg">
      <div class="flex between wrap center gap-1">
        <div><h2 style="font-size:1.2rem">Từ điển giải phẫu Uberon</h2><p class="small muted">Tra cứu thuật ngữ giải phẫu đã nhập từ ontology.</p></div>
        <form id="anatomySearch" class="flex gap-1 wrap"><input class="input" name="q" placeholder="Ví dụ: heart, liver, kidney…" value="${esc(params.get('aq') || '')}"><button class="btn btn-primary btn-sm">Tìm</button></form>
      </div>
      <div id="anatomyResults" class="mt-1"></div>
    </section>
  `);

  const viewerEl = document.getElementById('anatomyViewer');
  viewerEl.style.position = 'relative';
  activeViewer = createAnatomyViewer(viewerEl, { onSelect: (organ) => showOrgan(organ) });

  for (const box of document.querySelectorAll('[data-layer]')) {
    activeViewer.setLayer(box.dataset.layer, box.checked);
    box.addEventListener('change', () => activeViewer.setLayer(box.dataset.layer, box.checked));
  }
  for (const [id, fn] of [['vFront', 'front'], ['vBack', 'back'], ['vReset', 'reset']]) {
    document.getElementById(id)?.addEventListener('click', () => activeViewer[fn]());
  }
  document.getElementById('vRotate')?.addEventListener('click', (e) => {
    const on = activeViewer.toggleAutoRotate();
    e.target.classList.toggle('active', on);
  });

  const list = document.getElementById('organList');
  const renderOrgans = (filter = '') => {
    const f = filter.trim().toLowerCase();
    list.innerHTML = ORGANS.filter(o => !f || o.vi.toLowerCase().includes(f) || o.en.toLowerCase().includes(f))
      .map(o => `<button class="organ-btn" data-organ="${esc(o.id)}"><span class="dot" style="background:#${o.color.toString(16).padStart(6, '0')}"></span><span>${esc(o.vi)}</span><span class="vn">${esc(o.en)}</span></button>`).join('');
    list.querySelectorAll('[data-organ]').forEach(btn => btn.addEventListener('click', () => {
      list.querySelectorAll('.organ-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeViewer.selectOrgan(btn.dataset.organ);
    }));
  };
  renderOrgans();
  document.getElementById('organSearch').addEventListener('input', e => renderOrgans(e.target.value));

  async function showOrgan(organ) {
    const panel = document.getElementById('organInfo');
    panel.innerHTML = `<h3 style="font-size:.98rem">${esc(organ.vi)}</h3><p class="small muted">${esc(organ.en)} · đang tra cứu Uberon…</p><div class="loading-inline"><span class="spinner"></span></div>`;
    try {
      let a = null;
      if (organ.uberon) {
        try { a = await getJson(`/api/anatomy/${encodeURIComponent(organ.uberon)}`); } catch { /* fallback to search */ }
      }
      if (!a) {
        const res = await getJson(`/api/anatomy?q=${encodeURIComponent(organ.query)}&pageSize=1`);
        a = res.results[0];
      }
      if (!a) {
        panel.innerHTML = `<h3 style="font-size:.98rem">${esc(organ.vi)}</h3><p class="small muted">Chưa có dữ liệu đáng tin cậy cho thuật ngữ này trong Uberon.</p>`;
        return;
      }
      panel.innerHTML = `
        <h3 style="font-size:1rem">${esc(a.name_en)}</h3>
        <div class="tiny muted">${esc(organ.vi)} · ${esc(a.uberon_id || '')}</div>
        ${a.systems ? `<p class="pill pill-cyan" style="margin-top:.35rem">${esc(a.systems)}</p>` : ''}
        <p class="oi-def small">${esc(a.definition || 'Uberon chưa cung cấp định nghĩa cho thuật ngữ này.')}</p>
        <p class="small"><a href="#/diseases?q=${encodeURIComponent(organ.query)}">Tìm bệnh liên quan đến “${esc(organ.query)}”</a></p>
        <p class="tiny muted">Nguồn: Uberon Anatomy Ontology · CC BY 3.0</p>`;
    } catch (err) {
      panel.innerHTML = `<h3 style="font-size:.98rem">${esc(organ.vi)}</h3><p class="small muted">${esc(err.message)}</p>`;
    }
  }

  const form = document.getElementById('anatomySearch');
  const results = document.getElementById('anatomyResults');
  const load = async (query) => {
    results.innerHTML = loadingBlock('Đang tra cứu Uberon…');
    try {
      const data = await getJson(`/api/anatomy?${new URLSearchParams({ q: query || '', pageSize: '18' })}`);
      results.innerHTML = data.results.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Thuật ngữ</th><th>ID</th><th>Hệ</th><th>Định nghĩa (Uberon)</th></tr></thead><tbody>
        ${data.results.map(a => `<tr><td><strong>${esc(a.name_en)}</strong></td><td class="mono tiny">${esc(a.uberon_id || '')}</td><td class="tiny">${esc(a.systems || '—')}</td><td class="tiny">${esc((a.excerpt || '').slice(0, 200))}</td></tr>`).join('')}
      </tbody></table></div><p class="tiny muted mt-1">Hiển thị ${data.results.length}/${fmt(data.total)} thuật ngữ. Nguồn: Uberon (CC BY 3.0).</p>` : emptyState('Không tìm thấy thuật ngữ');
    } catch (err) { results.innerHTML = errorState(err); }
  };
  form.addEventListener('submit', e => { e.preventDefault(); load(new FormData(form).get('q')); });
  load(params.get('aq') || '');
}

/* ================================================================== */
/* Drugs                                                              */
/* ================================================================== */

export async function viewDrugs(params) {
  setActiveNav('drugs');
  const filters = { q: params.get('q') || '', ingredient: params.get('ingredient') || '', form: params.get('form') || '', labeler: params.get('labeler') || '', page: Number(params.get('page') || 1) };
  const data = await getJson(`/api/drugs?${new URLSearchParams({ ...filters, page: String(filters.page), pageSize: '24' })}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Dược điển toàn cầu' }])}
    ${pageHead({
      kicker: 'Global Drug Encyclopedia',
      title: 'Dược điển toàn cầu',
      lead: `${fmt(data.total)} sản phẩm thuốc trong dữ liệu NDC của FDA (Hoa Kỳ), kèm hoạt chất, dạng bào chế và nhà sản xuất. Nhãn thuốc đầy đủ được tải từ openFDA/DailyMed khi mở trang chi tiết.`
    })}
    <form class="toolbar" id="drugFilters">
      <input class="input input-search" name="q" value="${esc(filters.q)}" placeholder="Tên thuốc, hoạt chất, mã NDC…">
      <input class="input" name="ingredient" value="${esc(filters.ingredient)}" placeholder="Hoạt chất">
      <select class="select" name="form"><option value="">Dạng bào chế</option>${data.forms.map(f => `<option value="${esc(f.name)}" ${f.name === filters.form ? 'selected' : ''}>${esc(f.name)} (${fmt(f.c)})</option>`).join('')}</select>
      <select class="select" name="labeler"><option value="">Nhà sản xuất</option>${data.labelers.map(f => `<option value="${esc(f.name)}" ${f.name === filters.labeler ? 'selected' : ''}>${esc(f.name)} (${fmt(f.c)})</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm">Lọc</button>
      ${(filters.q || filters.ingredient || filters.form || filters.labeler) ? '<a class="btn btn-outline btn-sm" href="#/drugs">Xóa lọc</a>' : ''}
    </form>
    ${callout('warn', 'Không phải khuyến nghị điều trị', 'Dữ liệu sản phẩm và nhãn thuốc chỉ nhằm tra cứu thông tin. Nền tảng không đề xuất liều dùng hay thay đổi phác đồ cho bất kỳ cá nhân nào.')}
    ${data.results.length ? `<div class="grid grid-3">${data.results.map(d => `
      <article class="card card-hover">
        <div class="flex between wrap gap-1" style="align-items:flex-start">
          <h3 style="font-size:.98rem;margin:0"><a href="#/drugs/${encodeURIComponent(d.slug)}">${esc(d.brand_name || d.generic_name)}</a></h3>
          ${d.marketing_category ? `<span class="pill pill-muted">${esc(d.marketing_category)}</span>` : ''}
        </div>
        ${d.generic_name && d.brand_name ? `<div class="tiny muted">${esc(d.generic_name)}</div>` : ''}
        <div class="rc-sub">${esc(d.dosage_form || 'Dạng bào chế chưa rõ')}${d.route ? ` · ${esc(d.route)}` : ''}</div>
        <p class="small" style="color:#3a4f63">${esc(d.active_ingredients || 'Hoạt chất chưa có trong nguồn.')}</p>
        <div class="rc-codes">${d.product_ndc ? `<span class="code-chip">NDC ${esc(d.product_ndc)}</span>` : ''}${d.labeler ? `<span class="tiny muted">${esc(d.labeler)}</span>` : ''}</div>
      </article>`).join('')}</div>` : emptyState('Không tìm thấy thuốc', 'Thử tên hoạt chất hoặc dạng bào chế khác.')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/drugs', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('drugFilters');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    location.hash = `#/drugs${buildQuery({ q: fd.get('q'), ingredient: fd.get('ingredient'), form: fd.get('form'), labeler: fd.get('labeler'), page: 1 })}`;
  });
  form.querySelectorAll('select').forEach(s => s.addEventListener('change', () => form.requestSubmit()));
}

export async function viewDrug(params, slug) {
  setActiveNav('drugs');
  const d = await getJson(`/api/drugs/${encodeURIComponent(slug)}`);
  const label = d.label || {};
  const section = (title, text) => text ? `<section class="card card-pad-lg"><h2 style="font-size:1.1rem">${title}</h2><div class="small" style="white-space:pre-wrap;max-height:340px;overflow:auto">${esc(text)}</div></section>` : '';
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Dược điển', href: '#/drugs' }, { label: d.brand_name || d.generic_name }])}
    <header class="detail-head">
      <div class="dh-sub">${esc(d.generic_name || 'Thuốc')} · ${esc(d.dosage_form || '')}</div>
      <h1>${esc(d.brand_name || d.generic_name)}</h1>
      <div class="dh-codes">${d.product_ndc ? `<span class="code-chip">NDC ${esc(d.product_ndc)}</span>` : ''}${d.marketing_category ? `<span class="code-chip">${esc(d.marketing_category)}</span>` : ''}</div>
      <div class="dh-actions"><button class="btn btn-cyan btn-sm" id="printDrug">In / Lưu PDF</button><a class="btn btn-ghost btn-sm" href="#/drugs">Về danh mục</a></div>
    </header>
    <div class="two-col mt-2">
      <div class="stack">
        ${section('Chỉ định (theo nhãn thuốc)', label.indications)}
        ${section('Chống chỉ định', label.contraindications)}
        ${section('Cảnh báo', label.warnings)}
        ${section('Tác dụng phụ', label.adverse_reactions)}
        ${section('Tương tác thuốc', label.drug_interactions)}
        ${section('Liều và cách dùng trong nhãn', label.dosage_admin)}
        ${!label.indications && !label.warnings ? `<div class="card card-pad-lg">${callout('warn', 'Chưa tải được nhãn thuốc', 'Nguồn openFDA/DailyMed chưa có bản ghi nhãn cho NDC này, hoặc nguồn tạm thời không phản hồi. Dữ liệu sản phẩm bên dưới vẫn là dữ liệu thật từ NDC Directory.')}</div>` : ''}
        <section class="card card-pad-lg">
          <h2 style="font-size:1.1rem">So sánh với thuốc khác</h2>
          <p class="small muted">So sánh thông tin sản phẩm dựa trên dữ liệu nguồn. Không so sánh hiệu quả điều trị.</p>
          <form id="compareForm" class="flex gap-1 wrap">
            <input class="input" name="q" placeholder="Nhập tên thuốc cần so sánh" required>
            <button class="btn btn-outline btn-sm">So sánh</button>
          </form>
          <div id="compareResult" class="mt-1"></div>
        </section>
      </div>
      <aside class="stack side-card">
        <div class="card">
          <h3 style="font-size:.95rem">Thông tin sản phẩm</h3>
          ${facts([
            ['Tên generic', esc(d.generic_name || '—')],
            ['Hoạt chất', esc(d.active_ingredients || '—')],
            ['Dạng bào chế', esc(d.dosage_form || '—')],
            ['Đường dùng', esc(d.route || '—')],
            ['Nhà sản xuất', esc(d.labeler || '—')],
            ['Nhóm dược lý', esc(d.pharm_class || '—')],
            ['Số đăng ký', esc(d.application_number || '—')],
            ['Quốc gia dữ liệu', esc(d.country || '—')]
          ])}
        </div>
        ${d.alternatives.length ? `<div class="card"><h3 style="font-size:.95rem">Sản phẩm cùng hoạt chất</h3><div class="chip-cloud">${d.alternatives.map(a => `<a href="#/drugs/${encodeURIComponent(a.slug)}">${esc(a.brand_name || a.product_ndc)}</a>`).join('')}</div></div>` : ''}
        <div class="card"><h3 style="font-size:.95rem">Nguồn</h3>${sourceList(d.sources, d.retrieved_at)}</div>
        ${callout('danger', 'An toàn thuốc', 'Không tự ý dùng, ngừng hoặc đổi liều thuốc. Tham khảo bác sĩ hoặc dược sĩ; kiểm tra nhãn thuốc và hướng dẫn của cơ quan quản lý tại quốc gia bạn.')}
      </aside>
    </div>
  `);
  document.getElementById('printDrug')?.addEventListener('click', () => window.print());
  document.getElementById('compareForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('compareResult');
    const query = new FormData(e.target).get('q');
    box.innerHTML = loadingBlock('Đang tìm thuốc…');
    try {
      const found = await getJson(`/api/drugs?${new URLSearchParams({ q: query, pageSize: '1' })}`);
      if (!found.results.length) { box.innerHTML = callout('warn', 'Không tìm thấy', 'Không có sản phẩm phù hợp trong dữ liệu NDC.'); return; }
      const other = await getJson(`/api/drugs/${encodeURIComponent(found.results[0].slug)}`);
      const rows = [
        ['Tên thương mại', d.brand_name, other.brand_name], ['Hoạt chất', d.active_ingredients, other.active_ingredients],
        ['Dạng bào chế', d.dosage_form, other.dosage_form], ['Đường dùng', d.route, other.route],
        ['Nhà sản xuất', d.labeler, other.labeler], ['Nhóm dược lý', d.pharm_class, other.pharm_class],
        ['Mã NDC', d.product_ndc, other.product_ndc]
      ];
      box.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Trường</th><th>${esc(d.brand_name || d.generic_name)}</th><th>${esc(other.brand_name || other.generic_name)}</th></tr></thead><tbody>
        ${rows.map(([k, a, b]) => `<tr><td>${k}</td><td>${esc(a || '—')}</td><td>${esc(b || '—')}</td></tr>`).join('')}
      </tbody></table></div><p class="tiny muted mt-1">Nguồn: openFDA NDC Directory. Bảng không đánh giá hiệu quả hay độ an toàn tương đối.</p>`;
    } catch (err) { box.innerHTML = errorState(err); }
  });
}

/* ================================================================== */
/* Labs, organisms, genes                                             */
/* ================================================================== */

export async function viewLabs(params) {
  setActiveNav('labs');
  const filters = { q: params.get('q') || '', page: Number(params.get('page') || 1) };
  const data = await getJson(`/api/labs?${new URLSearchParams({ ...filters, page: String(filters.page), pageSize: '30' })}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Xét nghiệm y khoa' }])}
    ${pageHead({ kicker: 'Medical Laboratory Encyclopedia', title: 'Thư viện xét nghiệm y khoa', lead: `${fmt(data.total)} xét nghiệm với mô tả mục đích từ MedlinePlus. Khoảng tham chiếu không được công bố chung vì phụ thuộc phòng xét nghiệm, phương pháp và nhóm đối tượng.` })}
    <form class="toolbar" id="labFilters"><input class="input input-search" name="q" value="${esc(filters.q)}" placeholder="Tên xét nghiệm, ví dụ: HbA1c, urinalysis, troponin…"><button class="btn btn-primary btn-sm">Tìm</button>${filters.q ? '<a class="btn btn-outline btn-sm" href="#/labs">Xóa lọc</a>' : ''}</form>
    ${callout('warn', 'Khoảng tham chiếu', 'Không dùng một khoảng tham chiếu duy nhất cho mọi người. Khoảng tham chiếu phải gắn với phòng xét nghiệm, phương pháp, đơn vị và nhóm tuổi/giới/thai kỳ.')}
    ${data.results.length ? `<div class="grid grid-3">${data.results.map(l => `
      <article class="card card-hover">
        <h3 style="font-size:.98rem"><a href="#/labs/${encodeURIComponent(l.slug)}">${esc(l.name_en)}</a></h3>
        <p class="small" style="color:#3a4f63">${esc((l.excerpt || 'Nguồn chưa cung cấp mô tả.').slice(0, 200))}</p>
        <a class="link-btn" href="#/labs/${encodeURIComponent(l.slug)}">Đọc chi tiết →</a>
      </article>`).join('')}</div>` : emptyState('Không tìm thấy xét nghiệm')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/labs', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('labFilters');
  form.addEventListener('submit', e => { e.preventDefault(); location.hash = `#/labs${buildQuery({ q: new FormData(form).get('q'), page: 1 })}`; });
}

export async function viewLab(params, slug) {
  setActiveNav('labs');
  const l = await getJson(`/api/labs/${encodeURIComponent(slug)}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Xét nghiệm', href: '#/labs' }, { label: l.name_en }])}
    <header class="detail-head"><div class="dh-sub">Xét nghiệm y khoa</div><h1>${esc(l.name_en)}</h1>${l.name_vi ? `<div class="dh-sub">${esc(l.name_vi)}</div>` : ''}<div class="dh-actions"><button class="btn btn-cyan btn-sm" id="printLab">In / Lưu PDF</button></div></header>
    <div class="two-col mt-2">
      <div class="stack">
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Mục đích xét nghiệm</h2><p>${esc(l.purpose || 'Chưa có dữ liệu đáng tin cậy.')}</p></section>
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Khoảng tham chiếu</h2><p class="small">${esc(l.reference_note)}</p></section>
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Giới hạn dữ liệu</h2>
          ${facts([
            ['Mẫu bệnh phẩm', l.specimen ? esc(l.specimen) : '<span class="muted">Chưa có dữ liệu đáng tin cậy</span>'],
            ['Phương pháp', l.method ? esc(l.method) : '<span class="muted">Chưa có dữ liệu đáng tin cậy</span>'],
            ['Đơn vị', l.unit ? esc(l.unit) : '<span class="muted">Chưa có dữ liệu đáng tin cậy</span>'],
            ['Nguồn', sourceName(l.source_slug)]
          ])}
          <p class="tiny muted mt-1">Các trường trống được giữ trống thay vì tự tạo giá trị y khoa.</p>
        </section>
      </div>
      <aside class="stack side-card">
        ${callout('danger', 'Không tự diễn giải kết quả', 'Kết quả xét nghiệm phải được bác sĩ diễn giải cùng bệnh sử, thăm khám và khoảng tham chiếu của phòng xét nghiệm thực hiện.')}
        <div class="card"><h3 style="font-size:.95rem">Nguồn</h3>${sourceList(l.sources, l.retrieved_at)}</div>
      </aside>
    </div>
  `);
  document.getElementById('printLab')?.addEventListener('click', () => window.print());
}

export async function viewOrganisms(params) {
  setActiveNav('organisms');
  const filters = { q: params.get('q') || '', kingdom: params.get('kingdom') || '', page: Number(params.get('page') || 1) };
  const data = await getJson(`/api/organisms?${new URLSearchParams({ ...filters, page: String(filters.page), pageSize: '30' })}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Vi sinh & tác nhân gây bệnh' }])}
    ${pageHead({ kicker: 'Microbiology Encyclopedia', title: 'Vi sinh &amp; tác nhân gây bệnh', lead: `${fmt(data.total)} taxon từ NCBI Taxonomy, được liên kết với bệnh qua logical definition của MONDO.` })}
    <form class="toolbar" id="orgFilters">
      <input class="input input-search" name="q" value="${esc(filters.q)}" placeholder="Tên khoa học, tên phổ biến, TaxID…">
      <select class="select" name="kingdom"><option value="">Tất cả giới</option>${data.kingdoms.map(k => `<option value="${esc(k.name)}" ${k.name === filters.kingdom ? 'selected' : ''}>${esc(k.name)} (${fmt(k.c)})</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm">Tìm</button>
      ${(filters.q || filters.kingdom) ? '<a class="btn btn-outline btn-sm" href="#/organisms">Xóa lọc</a>' : ''}
    </form>
    ${data.results.length ? `<div class="grid grid-3">${data.results.map(o => `
      <article class="card card-hover">
        <h3 style="font-size:.95rem"><em><a href="#/organisms/${encodeURIComponent(o.slug)}">${esc(o.name_scientific)}</a></em></h3>
        ${o.name_common ? `<div class="tiny muted">${esc(o.name_common)}</div>` : ''}
        <div class="rc-sub">${esc(o.rank || '')}${o.kingdom ? ` · ${esc(o.kingdom)}` : ''} · TaxID ${esc(o.taxid)}</div>
        <p class="small muted">${fmt(o.disease_count)} bệnh liên kết</p>
      </article>`).join('')}</div>` : emptyState('Không tìm thấy tác nhân')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/organisms', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('orgFilters');
  form.addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(form); location.hash = `#/organisms${buildQuery({ q: fd.get('q'), kingdom: fd.get('kingdom'), page: 1 })}`; });
  form.querySelector('select').addEventListener('change', () => form.requestSubmit());
}

export async function viewOrganism(params, slug) {
  setActiveNav('organisms');
  const m = await getJson(`/api/organisms/${encodeURIComponent(slug)}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Vi sinh', href: '#/organisms' }, { label: m.name_scientific }])}
    <header class="detail-head"><div class="dh-sub">${esc(m.rank || '')} · ${esc(m.kingdom || '')}</div><h1><em>${esc(m.name_scientific)}</em></h1>${m.name_common ? `<div class="dh-sub">${esc(m.name_common)}</div>` : ''}<div class="dh-codes"><span class="code-chip">TaxID ${esc(m.taxid)}</span></div></header>
    <div class="two-col mt-2">
      <div class="stack">
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Phân loại</h2><p class="small">${esc(m.lineage || 'Chưa có dữ liệu.')}</p></section>
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Bệnh liên quan (${fmt(m.diseases.length)})</h2>
          ${m.diseases.length ? `<div class="chip-cloud">${m.diseases.map(d => `<a href="#/diseases/${encodeURIComponent(d.slug)}">${esc(d.name_en)}</a>`).join('')}</div>` : '<p class="small muted">Chưa có liên kết bệnh–tác nhân đã xác thực trong kho dữ liệu.</p>'}
        </section>
      </div>
      <aside class="stack side-card"><div class="card"><h3 style="font-size:.95rem">Nguồn</h3>${sourceList(m.sources, m.retrieved_at)}</div></aside>
    </div>
  `);
}

export async function viewCodes(params) {
  setActiveNav('codes');
  const filters = { q: params.get('q') || '', chapter: params.get('chapter') || '', page: Number(params.get('page') || 1) };
  const data = await getJson(`/api/codes?${new URLSearchParams({ q: filters.q, chapter: filters.chapter, page: String(filters.page), pageSize: '50' })}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Mã bệnh ICD-10-CM' }])}
    ${pageHead({
      kicker: 'ICD-10-CM · CMS 2026',
      title: 'Tra mã bệnh ICD-10-CM',
      lead: 'Mã và mô tả chẩn đoán từ bộ Code Descriptions Tabular Order chính thức của CMS Hoa Kỳ. Đây là công cụ tra cứu mã, không phải chẩn đoán hay công cụ thanh toán.'
    })}
    <form class="toolbar" id="codeFilters">
      <input class="input input-search" name="q" value="${esc(filters.q)}" placeholder="Nhập mã (E11, J45) hoặc mô tả bệnh…">
      <select class="select" name="chapter">
        <option value="">Tất cả chương</option>
        ${data.chapters.map(ch => `<option value="${esc(ch.chapter)}" ${ch.chapter === filters.chapter ? 'selected' : ''}>${esc(ch.chapter)} (${fmt(ch.c)})</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm">Tra mã</button>
      ${(filters.q || filters.chapter) ? '<a class="btn btn-outline btn-sm" href="#/codes">Xóa lọc</a>' : ''}
    </form>
    ${callout('warn', 'Cách dùng mã', 'Mã ICD-10-CM được dùng cho thống kê và thanh toán tại Hoa Kỳ. Việc chọn mã đúng phụ thuộc hồ sơ lâm sàng và quy định của từng nơi; không tự dùng mã để chẩn đoán.')}
    <p class="small muted">${fmt(data.total)} mã phù hợp. Nguồn: CMS, ICD-10-CM 2026, public domain.</p>
    ${data.results.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Mô tả</th><th>Chương</th></tr></thead><tbody>
      ${data.results.map(row => `<tr><td><span class="code-chip">${esc(row.code)}</span></td><td>${esc(row.title)}</td><td class="tiny muted">${esc(row.chapter || '—')}</td></tr>`).join('')}
    </tbody></table></div>` : emptyState('Không tìm thấy mã phù hợp', 'Thử mã ngắn hơn, ví dụ E11 hoặc J45.')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/codes', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('codeFilters');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    location.hash = `#/codes${buildQuery({ q: fd.get('q'), chapter: fd.get('chapter'), page: 1 })}`;
  });
  form.querySelector('select').addEventListener('change', () => form.requestSubmit());
}

export async function viewGenes(params) {
  setActiveNav('genes');
  const filters = { q: params.get('q') || '', page: Number(params.get('page') || 1) };
  const data = await getJson(`/api/genes?${new URLSearchParams({ ...filters, page: String(filters.page), pageSize: '30' })}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Gene & di truyền' }])}
    ${pageHead({ kicker: 'Gene & Genetics', title: 'Gene và liên kết di truyền', lead: `${fmt(data.total)} gene người từ NCBI Gene, bổ sung liên kết bệnh Orphanet, pathway Reactome và protein UniProt. Thông tin không dùng để kết luận chẩn đoán cá nhân.` })}
    <form class="toolbar" id="geneFilters"><input class="input input-search" name="q" value="${esc(filters.q)}" placeholder="Ký hiệu gene, tên gene…"><button class="btn btn-primary btn-sm">Tìm</button>${filters.q ? '<a class="btn btn-outline btn-sm" href="#/genes">Xóa lọc</a>' : ''}</form>
    ${data.results.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Gene</th><th>Tên</th><th>NST</th><th>Vị trí</th><th>Bệnh liên kết</th></tr></thead><tbody>
      ${data.results.map(g => `<tr><td><a href="#/genes/${encodeURIComponent(g.slug)}"><strong>${esc(g.symbol)}</strong></a>${g.ncbi_gene_id ? `<div class="tiny muted">NCBI ${esc(g.ncbi_gene_id)}</div>` : ''}</td><td>${esc(g.name || '—')}${g.gene_type ? `<div class="tiny muted">${esc(g.gene_type)}</div>` : ''}</td><td>${esc(g.chromosome || '—')}</td><td class="tiny">${esc(g.location || '—')}</td><td class="num">${fmt(g.disease_count)}</td></tr>`).join('')}
    </tbody></table></div>` : emptyState('Không tìm thấy gene')}
    ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/genes', { ...filters, page: p }) })}
  `);
  const form = document.getElementById('geneFilters');
  form.addEventListener('submit', e => { e.preventDefault(); location.hash = `#/genes${buildQuery({ q: new FormData(form).get('q'), page: 1 })}`; });
}

export async function viewGene(params, slug) {
  setActiveNav('genes');
  const g = await getJson(`/api/genes/${encodeURIComponent(slug)}`);
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Gene', href: '#/genes' }, { label: g.symbol }])}
    <header class="detail-head"><div class="dh-sub">Gene · Homo sapiens</div><h1>${esc(g.symbol)}</h1>${g.name ? `<div class="dh-sub">${esc(g.name)}</div>` : ''}<div class="dh-codes">${g.chromosome ? `<span class="code-chip">NST ${esc(g.chromosome)}</span>` : ''}${g.location ? `<span class="code-chip">${esc(g.location)}</span>` : ''}</div></header>
    <div class="two-col mt-2">
      <div class="stack">
        ${g.aliases?.length ? `<section class="card card-pad-lg"><h2 style="font-size:1.15rem">Tên đồng nghĩa / alias (${fmt(g.aliases.length)})</h2><div class="chip-cloud">${g.aliases.map(a => `<span class="code-chip">${esc(a)}</span>`).join('')}</div></section>` : ''}
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Bệnh liên kết (${fmt(g.diseases.length)})</h2>
          ${g.diseases.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Bệnh</th><th>ORPHA</th><th>Kiểu liên kết</th></tr></thead><tbody>
            ${g.diseases.map(d => `<tr><td><a href="#/diseases/${encodeURIComponent(d.slug)}">${esc(d.name_en)}</a></td><td class="mono tiny">${esc(d.orphanet_code || '—')}</td><td class="tiny">${esc(d.association_type || '—')}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="small muted">Chưa có liên kết bệnh.</p>'}
        </section>
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Pathway Reactome (${fmt(g.pathways?.length || 0)})</h2>
          ${g.pathways?.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Pathway</th><th>Bằng chứng</th></tr></thead><tbody>${g.pathways.slice(0, 60).map(p => `<tr><td class="mono tiny">${esc(p.reactome_id)}</td><td><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a></td><td class="tiny">${esc(p.evidence || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Chưa có pathway đã ánh xạ cho gene này.</p>'}
        </section>
        <section class="card card-pad-lg"><h2 style="font-size:1.15rem">Protein UniProt (${fmt(g.proteins?.length || 0)})</h2>
          ${g.proteins?.length ? g.proteins.map(p => `<article style="border-top:1px solid var(--line);padding:.7rem 0"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(p.uniprot_id)}</strong></a> · ${esc(p.name || 'Chưa có tên')} ${p.length ? `· ${fmt(p.length)} aa` : ''}${p.function ? `<p class="small" style="color:#3a4f63">${esc(p.function.slice(0, 500))}${p.function.length > 500 ? '…' : ''}</p>` : ''}${p.subcellular ? `<p class="tiny muted">${esc(p.subcellular.slice(0, 300))}</p>` : ''}</article>`).join('') : '<p class="small muted">Chưa có protein reviewed liên kết gene này.</p>'}
        </section>
      </div>
      <aside class="stack side-card">${callout('warn', 'Di truyền', 'Không dùng thông tin gene để tự kết luận chẩn đoán. Cần tư vấn di truyền chuyên khoa.')}<div class="card"><h3 style="font-size:.95rem">Mã định danh</h3>${g.ncbi_gene_id ? `<p class="small">NCBI Gene: <a href="https://www.ncbi.nlm.nih.gov/gene/${esc(g.ncbi_gene_id)}" target="_blank" rel="noopener noreferrer">${esc(g.ncbi_gene_id)}</a></p>` : ''}${g.gene_type ? `<p class="small">Loại: ${esc(g.gene_type)}</p>` : ''}</div><div class="card"><h3 style="font-size:.95rem">Nguồn</h3>${sourceList(g.sources, g.retrieved_at)}</div></aside>
    </div>
  `);
}

/* ================================================================== */
/* Research, trials, search, assistant, admin, about                  */
/* ================================================================== */

export async function viewResearch(params) {
  setActiveNav('research');
  const q = params.get('q') || '';
  const source = params.get('source') || 'all';
  const year = params.get('year') || '';
  const oa = params.get('oa') === '1';
  const page = Number(params.get('page') || 1);
  let data = null;
  let error = null;
  if (q) {
    try {
      data = await getJson(`/api/research?${new URLSearchParams({ q, source, year, openAccess: oa ? '1' : '', page: String(page), pageSize: '20' })}`);
    } catch (err) { error = err; }
  }
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Nghiên cứu y khoa toàn cầu' }])}
    ${pageHead({ kicker: 'Global Medical Research', title: 'Nghiên cứu y khoa toàn cầu', lead: 'Tìm bài báo và tài liệu khoa học từ PubMed, Europe PMC, Crossref và OpenAlex. Kết quả được lấy trực tiếp từ API công khai; nền tảng không tự tạo PMID, DOI hay abstract.' })}
    <form class="toolbar" id="researchForm">
      <input class="input input-search" name="q" value="${esc(q)}" placeholder="Từ khóa, bệnh, tác giả, DOI, PMID…" required>
      <select class="select" name="source">
        <option value="all" ${source === 'all' ? 'selected' : ''}>PubMed + Europe PMC</option>
        <option value="pubmed" ${source === 'pubmed' ? 'selected' : ''}>PubMed</option>
        <option value="europepmc" ${source === 'europepmc' ? 'selected' : ''}>Europe PMC</option>
        <option value="crossref" ${source === 'crossref' ? 'selected' : ''}>Crossref</option>
        <option value="openalex" ${source === 'openalex' ? 'selected' : ''}>OpenAlex</option>
      </select>
      <input class="input" name="year" value="${esc(year)}" placeholder="Năm" style="width:88px">
      <label class="small flex center gap-1"><input type="checkbox" name="oa" value="1" ${oa ? 'checked' : ''}> Open Access</label>
      <button class="btn btn-primary btn-sm">Tìm nghiên cứu</button>
    </form>
    ${!q ? `<div class="card card-pad-lg"><h3>Gợi ý tìm kiếm</h3><div class="chip-cloud">${['tuberculosis', 'hypertension', 'diabetes mellitus', 'breast cancer', 'Alzheimer disease', 'malaria', 'vaccine efficacy', 'rare disease'].map(x => `<a href="${href('/research', { q: x })}">${esc(x)}</a>`).join('')}</div><p class="small muted mt-2">Có thể dùng cú pháp tìm kiếm của PubMed/Europe PMC, ví dụ <span class="mono">"diabetes AND 2025[dp]"</span>.</p></div>` : ''}
    ${error ? errorState(error) : ''}
    ${data ? `<div class="flex between wrap center gap-1"><p class="small muted">${fmt(data.total)} kết quả ước tính · ${data.source === 'all' ? 'PubMed + Europe PMC' : sourceName(data.source)} · ${data.warnings?.length ? esc(data.warnings.join(' · ')) : 'truy vấn trực tiếp'}</p><a class="btn btn-outline btn-sm" href="#/trials${buildQuery({ q })}">Xem thử nghiệm lâm sàng</a></div>
      ${data.results.length ? `<div class="card" style="padding:.2rem 1.1rem">${data.results.map(researchCard).join('')}</div>` : emptyState('Không tìm thấy bài báo', 'Thử từ khóa tiếng Anh hoặc bỏ bộ lọc năm/Open Access.')}
      <div class="pagination"><a class="btn btn-outline btn-sm" ${page <= 1 ? 'style="pointer-events:none;opacity:.5"' : `href="${href('/research', { q, source, year, oa: oa ? '1' : '', page: page - 1 })}"`}>← Trước</a><span class="page-info">Trang ${page}</span><a class="btn btn-outline btn-sm" href="${href('/research', { q, source, year, oa: oa ? '1' : '', page: page + 1 })}">Sau →</a></div>` : ''}
  `);
  const form = document.getElementById('researchForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    location.hash = `#/research${buildQuery({ q: fd.get('q'), source: fd.get('source'), year: fd.get('year'), oa: fd.get('oa') ? '1' : '', page: 1 })}`;
  });
  document.querySelectorAll('[data-expand-abstract]').forEach(btn => btn.addEventListener('click', () => {
    const p = btn.previousElementSibling;
    p.classList.toggle('clamped');
    btn.textContent = p.classList.contains('clamped') ? 'Xem abstract đầy đủ' : 'Thu gọn abstract';
  }));
}

export async function viewTrials(params) {
  setActiveNav('trials');
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const country = params.get('country') || '';
  const pageToken = params.get('token') || '';
  let data = null;
  let error = null;
  if (q || status || country) {
    try {
      data = await getJson(`/api/trials?${new URLSearchParams({ q, status, country, pageToken, pageSize: '12' })}`);
      trialNextToken = data.nextPageToken || null;
    } catch (err) { error = err; }
  }
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Thử nghiệm lâm sàng' }])}
    ${pageHead({ kicker: 'ClinicalTrials.gov', title: 'Thử nghiệm lâm sàng toàn cầu', lead: 'Tìm nghiên cứu theo bệnh, can thiệp, trạng thái tuyển bệnh và quốc gia. Dữ liệu lấy từ API v2 của ClinicalTrials.gov.' })}
    <form class="toolbar" id="trialForm">
      <input class="input input-search" name="q" value="${esc(q)}" placeholder="Bệnh, thuốc, can thiệp…">
      <select class="select" name="status">
        ${[['', 'Mọi trạng thái'], ['RECRUITING', 'Đang tuyển bệnh'], ['NOT_YET_RECRUITING', 'Chưa tuyển'], ['ACTIVE_NOT_RECRUITING', 'Đang tiến hành'], ['COMPLETED', 'Đã hoàn thành'], ['TERMINATED', 'Kết thúc sớm']].map(([v, l]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input class="input" name="country" value="${esc(country)}" placeholder="Quốc gia (English)">
      <button class="btn btn-primary btn-sm">Tìm thử nghiệm</button>
    </form>
    ${callout('info', 'Cách đọc kết quả', 'Việc một thử nghiệm đang tuyển bệnh không có nghĩa là bất kỳ ai cũng đủ điều kiện tham gia. Luôn đọc tiêu chuẩn chọn bệnh và liên hệ nhóm nghiên cứu.')}
    ${error ? errorState(error) : ''}
    ${data ? `${data.results.length ? `<div class="result-list">${data.results.map(t => `
      <article class="card result-card">
        <div class="rc-top"><span class="rc-type">${esc(t.nctId)}</span><span class="pill ${t.status === 'RECRUITING' ? 'pill-ok' : 'pill-muted'}">${esc(t.statusLabel)}</span>${(t.phases || []).map(p => `<span class="pill pill-cyan">${esc(p)}</span>`).join('')}</div>
        <h3>${safeExternal(t.url, t.title)}</h3>
        <div class="rc-sub">${esc(t.sponsor || 'Nhà tài trợ chưa rõ')}${t.startDate ? ` · bắt đầu ${esc(t.startDate)}` : ''}${t.enrollment ? ` · ${fmt(t.enrollment)} người` : ''}</div>
        ${t.conditions?.length ? `<div class="tiny muted">Bệnh: ${t.conditions.map(esc).join(', ')}</div>` : ''}
        ${t.interventions?.length ? `<div class="tiny muted">Can thiệp: ${t.interventions.slice(0, 4).map(esc).join(', ')}</div>` : ''}
        ${t.countries?.length ? `<div class="tiny muted">Quốc gia: ${t.countries.slice(0, 8).map(esc).join(', ')}</div>` : ''}
        ${t.summary ? `<p class="small" style="color:#3a4f63">${esc(t.summary.slice(0, 420))}${t.summary.length > 420 ? '…' : ''}</p>` : ''}
      </article>`).join('')}</div>` : emptyState('Không tìm thấy thử nghiệm phù hợp')}
      <p class="tiny muted">Tổng số ước tính: ${fmt(data.total)} · Nguồn: ClinicalTrials.gov (public domain).</p>
      <div class="pagination">
        ${pageToken ? `<a class="btn btn-outline btn-sm" href="#/trials${buildQuery({ q, status, country })}">← Trang đầu</a>` : ''}
        ${data.nextPageToken ? `<a class="btn btn-outline btn-sm" href="#/trials${buildQuery({ q, status, country, token: data.nextPageToken })}">Trang sau →</a>` : '<span class="page-info">Hết kết quả trong trang này</span>'}
      </div>` : ''}
  `);
  const form = document.getElementById('trialForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    location.hash = `#/trials${buildQuery({ q: fd.get('q'), status: fd.get('status'), country: fd.get('country') })}`;
  });
}

export async function viewSearch(params) {
  setActiveNav('search');
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  const page = Number(params.get('page') || 1);
  let data = null;
  let error = null;
  if (q) {
    try { data = await getJson(`/api/search?${new URLSearchParams({ q, type, page: String(page), pageSize: '20' })}`); }
    catch (err) { error = err; }
  }
  const types = [['', 'Tất cả'], ['disease', 'Bệnh'], ['symptom', 'Triệu chứng'], ['drug', 'Thuốc'], ['anatomy', 'Giải phẫu'], ['organism', 'Vi sinh'], ['lab', 'Xét nghiệm'], ['gene', 'Gene']];
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Tìm kiếm toàn hệ thống' }])}
    ${pageHead({ kicker: 'Global Medical Search', title: 'Tìm kiếm toàn hệ thống', lead: 'Tìm đồng thời bệnh, triệu chứng, thuốc, giải phẫu, vi sinh, xét nghiệm và gene. Hỗ trợ tiếng Việt có dấu/không dấu, tên đồng nghĩa, mã định danh, gợi ý và tìm gần đúng.' })}
    <form class="card card-pad-lg" id="searchPageForm" style="margin-bottom:1rem">
      <div class="flex gap-1 wrap">
        <input class="input input-search" name="q" value="${esc(q)}" placeholder="Nhập từ khóa, tên bệnh, mã ICD-10/MONDO/ORPHA…" style="flex:1" autofocus>
        <button class="btn btn-primary">Tìm kiếm</button>
      </div>
      <div class="chip-row mt-1">${types.map(([v, l]) => `<a class="chip ${v === type ? 'active' : ''}" href="${href('/search', { q, type: v })}">${l}</a>`).join('')}</div>
    </form>
    ${error ? errorState(error) : ''}
    ${data ? `
      <div class="flex between wrap center gap-1">
        <p class="small muted">${fmt(data.total)} kết quả cho “${esc(q)}”${data.mode === 'fuzzy' ? ' · tìm gần đúng' : ''}</p>
        <div class="chip-row">${Object.entries(data.types || {}).map(([k, v]) => `<span class="pill pill-muted">${esc(k)}: ${fmt(v)}</span>`).join('')}</div>
      </div>
      ${data.results.length ? `<div class="result-list">${data.results.map(hit => `
        <article class="card card-hover result-card">
          <div class="rc-top"><span class="rc-type">${esc(hit.typeLabel)}</span><h3><a href="${esc(hit.url + hit.slug)}">${esc(hit.title)}</a></h3>${hit.badge ? `<span class="pill pill-warn">${esc(hit.badge)}</span>` : ''}</div>
          ${hit.titleVi ? `<div class="tiny muted">${esc(hit.titleVi)}</div>` : ''}
          ${hit.subtitle ? `<div class="rc-sub">${esc(hit.subtitle)}</div>` : ''}
          ${hit.snippet ? `<p>${esc(hit.snippet)}</p>` : ''}
          <div class="rc-codes">${(hit.codes || []).map(c => `<span class="code-chip">${esc(c)}</span>`).join('')}</div>
        </article>`).join('')}</div>` : emptyState('Không tìm thấy kết quả', 'Thử tên tiếng Anh, mã bệnh hoặc từ khóa ngắn hơn.')}
      ${pagination({ page: data.page, pageSize: data.pageSize, total: data.total, makeHref: p => href('/search', { q, type, page: p }) })}
    ` : '<p class="small muted">Nhập từ khóa để bắt đầu. Ví dụ: <a href="#/search?q=đái tháo đường">đái tháo đường</a>, <a href="#/search?q=hypertension">hypertension</a>, <a href="#/search?q=J45">J45</a>.</p>'}
  `);
  const form = document.getElementById('searchPageForm');
  form.addEventListener('submit', e => { e.preventDefault(); location.hash = `#/search${buildQuery({ q: new FormData(form).get('q'), type })}`; });
}

const SUGGESTED_QUESTIONS = [
  'Đái tháo đường type 2 là gì?',
  'So sánh hen phế quản và COPD',
  'Xét nghiệm HbA1c dùng để làm gì?',
  'Gene BRCA1 liên quan đến bệnh nào?',
  'Tìm nghiên cứu về Alzheimer',
  'Triệu chứng của sốt xuất huyết'
];

export async function viewAssistant(params) {
  setActiveNav('assistant');
  const initial = params.get('q') || '';
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Trợ lý tri thức y khoa' }])}
    ${pageHead({ kicker: 'Medical Knowledge AI', title: 'Trợ lý tri thức y khoa', lead: 'Trợ lý truy xuất dữ liệu đã tích hợp và trả lời kèm nguồn. Không chẩn đoán, không kê đơn và không tạo mã bệnh, DOI hay nghiên cứu không tồn tại.' })}
    <div class="assistant-shell">
      <div class="card card-pad-lg chat-panel">
        <div class="chat-log" id="chatLog"></div>
        <form class="chat-form" id="chatForm">
          <textarea id="chatInput" placeholder="Hỏi về một bệnh, so sánh hai bệnh, xét nghiệm, thuốc, gene hoặc tìm nghiên cứu…" maxlength="500"></textarea>
          <button class="btn btn-primary" type="submit" id="chatSend">Gửi</button>
        </form>
        <div class="prompt-chips" id="promptChips">${SUGGESTED_QUESTIONS.map(x => `<button type="button" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      </div>
      <aside class="stack side-card">
        ${callout('info', 'Cách trợ lý trả lời', 'Trợ lý tìm bản ghi trong kho dữ liệu, trích xuất thông tin và liệt kê nguồn kèm ngày truy xuất. Nếu không có bản ghi phù hợp, trợ lý sẽ nói rõ là không đủ dữ liệu thay vì suy đoán.')}
        ${callout('danger', 'Không phải chẩn đoán', 'Nội dung chỉ nhằm mục đích giáo dục. Không dùng để tự chẩn đoán, tự dùng thuốc hoặc thay đổi điều trị.')}
        <div class="card"><h3 style="font-size:.95rem">Câu hỏi gợi ý</h3><div class="chip-cloud">${SUGGESTED_QUESTIONS.map(x => `<a href="${href('/assistant', { q: x })}">${esc(x)}</a>`).join('')}</div></div>
      </aside>
    </div>
  `);
  const log = document.getElementById('chatLog');
  const input = document.getElementById('chatInput');
  const addMsg = (role, html) => {
    const div = document.createElement('div');
    div.className = `msg msg-${role}`;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };
  const greeting = addMsg('bot', `<p class="mb-0">Xin chào. Tôi là trợ lý tri thức của Global Medical Encyclopedia. Tôi chỉ trả lời dựa trên bản ghi đã có nguồn trong kho dữ liệu. Hãy đặt câu hỏi về bệnh, triệu chứng, thuốc, xét nghiệm, gene hoặc nghiên cứu.</p><p class="msg-meta mb-0">Chế độ trích xuất có kiểm chứng · không chẩn đoán</p>`);
  void greeting;

  let busy = false;
  async function ask(question) {
    if (busy || !question.trim()) return;
    busy = true;
    addMsg('user', esc(question));
    const pending = addMsg('bot', '<div class="loading-inline"><span class="typing"><span></span><span></span><span></span></span> Đang truy xuất kho dữ liệu…</div>');
    try {
      const result = await postJson('/api/assistant', { question });
      pending.innerHTML = `${renderAiBlocks(result.blocks)}<div class="msg-meta">${esc(result.disclaimer || '')}</div>`;
    } catch (err) {
      pending.innerHTML = `<p class="mb-0">${esc(err.message)}</p>`;
    } finally {
      busy = false;
      log.scrollTop = log.scrollHeight;
    }
  }
  document.getElementById('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const question = input.value;
    input.value = '';
    ask(question);
  });
  document.getElementById('promptChips').addEventListener('click', e => {
    const btn = e.target.closest('[data-q]');
    if (btn) ask(btn.dataset.q);
  });
  if (initial) ask(initial);
}

function renderAiBlocks(blocks) {
  return (blocks || []).map(b => {
    switch (b.type) {
      case 'heading': return `<div class="block-heading">${esc(b.text)}</div>`;
      case 'subheading': return `<div class="block-subheading">${esc(b.text)}</div>`;
      case 'p': return `<p>${esc(b.text)}</p>`;
      case 'codes': return `<div class="block-codes">${b.items.map(x => `<span class="code-chip">${esc(x)}</span>`).join('')}</div>`;
      case 'list': return `<ul class="block-list">${b.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
      case 'facts': return `<dl class="block-facts">${b.items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
      case 'callout': return `<div class="block-callout ${esc(b.tone || 'info')}">${esc(b.text)}</div>`;
      case 'table': return `<div class="table-wrap"><table class="data"><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'sources': return `<div class="block-sources"><strong>Nguồn tham khảo</strong><ul style="margin:.3rem 0 0;padding-left:1.1rem">${b.items.map(s => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>` : esc(s.label)}${s.license ? ` · ${esc(s.license)}` : ''}${s.retrievedAt ? ` · truy xuất ${esc(fmtDate(s.retrievedAt))}` : ''}</li>`).join('')}</ul></div>`;
      default: return '';
    }
  }).join('');
}

export async function viewAdmin() {
  setActiveNav('admin');
  let data;
  try { data = await getJson('/api/admin/overview'); }
  catch (err) {
    render(`${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Trung tâm dữ liệu' }])}
      <div class="card card-pad-lg">${callout('danger', 'Không có quyền quản trị', `${esc(err.message)}. Đặt biến môi trường ADMIN_TOKEN và gửi header X-Admin-Token, hoặc truy cập từ máy cục bộ.`)}</div>`);
    return;
  }
  const s = data.stats;
  const quality = data.quality;
  let polling = null;
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Trung tâm quản lý dữ liệu' }])}
    ${pageHead({
      kicker: 'Data Management Center', title: 'Trung tâm quản lý dữ liệu',
      lead: 'Số liệu thật từ cơ sở dữ liệu, trạng thái từng nguồn, nhật ký đồng bộ và kiểm tra chất lượng. Tác vụ đồng bộ chạy ở tiến trình nền phía máy chủ, không chạy trong trình duyệt.',
      actions: `<button class="btn btn-outline btn-sm" id="refreshAdmin">Làm mới</button><a class="btn btn-outline btn-sm" href="/api/admin/export">Xuất metadata</a><a class="btn btn-outline btn-sm" href="/api/export/diseases.csv">Xuất CSV bệnh</a>`
    })}
    <div class="stat-grid">
      ${[['Tổng số bệnh', s.counts.diseases], ['Triệu chứng', s.counts.symptoms], ['Thuốc', s.counts.drugs], ['Xét nghiệm', s.counts.labs], ['Giải phẫu', s.counts.anatomy], ['Vi sinh', s.counts.organisms], ['Gene', s.counts.genes], ['Mã ICD-10-CM', s.counts.icdCodes], ['Pathway', s.counts.pathways], ['Protein', s.counts.proteins], ['Liên kết bệnh–triệu chứng', s.counts.diseaseSymptoms], ['Liên kết gene–bệnh', s.counts.diseaseGenes]].map(([l, v]) => `
        <div class="stat-card"><div class="sv">${fmt(v)}</div><div class="sl">${l}</div></div>`).join('')}
    </div>
    <div class="grid grid-2 mt-2">
      <div class="card card-pad-lg">
        <div class="flex between wrap center"><h2 style="font-size:1.15rem">Nguồn dữ liệu</h2><span class="tiny muted">DB ${(data.database.sizeBytes / 1048576).toFixed(1)} MB · ${esc(data.database.engine)}</span></div>
        <p class="small muted">Đồng bộ thủ công theo từng nguồn. Tác vụ chạy nền, có thể bị gián đoạn và chạy lại.</p>
        <div>${s.sources.map(src => `
          <div class="source-row">
            <div><div class="src-name">${esc(src.name)}</div><div class="src-sub">${esc(src.license_name)} · ${fmt(src.record_count)} bản ghi</div></div>
            <div class="tiny">${statusPill(src.status)}</div>
            <div class="tiny muted">${src.last_success_at ? esc(fmtDate(src.last_success_at)) : 'Chưa đồng bộ'}</div>
            <div><button class="btn btn-outline btn-sm" data-sync="${esc(src.slug)}">Đồng bộ</button></div>
          </div>`).join('')}
        </div>
        <div class="flex gap-1 wrap mt-2">
          <button class="btn btn-primary btn-sm" data-sync="reindex">Lập lại chỉ mục tìm kiếm</button>
          <a class="btn btn-outline btn-sm" href="https://github.com" target="_blank" rel="noopener noreferrer">Hướng dẫn import</a>
        </div>
        <p class="tiny muted mt-1">Nguồn thiếu API key cần cấu hình biến môi trường trên máy chủ (xem README). Không có key giả trong mã nguồn.</p>
      </div>
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Kiểm tra chất lượng dữ liệu</h2>
        <div class="stack">
          <div class="flex between small"><span>Bệnh thiếu định nghĩa</span><strong>${fmt(quality.missingDefinition)}</strong></div>
          <div class="flex between small"><span>Bệnh chưa có liên kết triệu chứng</span><strong>${fmt(quality.missingSymptoms)}</strong></div>
          <div class="flex between small"><span>Bệnh chưa phân loại (nhóm “Khác”)</span><strong>${fmt(quality.unclassified)}</strong></div>
          <div class="flex between small"><span>Triệu chứng không liên kết bệnh</span><strong>${fmt(quality.orphanSymptoms)}</strong></div>
          <div class="flex between small"><span>Nhóm tên bệnh trùng</span><strong>${fmt(quality.duplicateNames.length)}</strong></div>
          <div class="flex between small"><span>Mã định danh dùng cho nhiều bệnh</span><strong>${fmt(quality.duplicateIdentifiers.length)}</strong></div>
        </div>
        ${quality.duplicateNames.length ? `<details class="mt-1"><summary class="small">Xem tên trùng</summary><ul class="small">${quality.duplicateNames.slice(0, 10).map(d => `<li>${esc(d.name)} (${d.c})</li>`).join('')}</ul></details>` : ''}
        ${callout('info', 'Cách xử lý', 'Các bản ghi thiếu dữ liệu được giữ nguyên và hiển thị “Chưa có dữ liệu đáng tin cậy”, không tự điền nội dung y khoa.')}
      </div>
    </div>
    <div class="card card-pad-lg mt-2">
      <h2 style="font-size:1.15rem">Tác vụ đồng bộ gần đây</h2>
      <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Nguồn</th><th>Trạng thái</th><th>Bắt đầu</th><th>Xử lý</th><th>Ghi</th><th>Bỏ qua</th><th>Lỗi</th><th>Thông điệp</th></tr></thead><tbody>
        ${data.jobs.map(j => `<tr><td class="num">${j.id}</td><td>${esc(j.source_slug)}</td><td>${statusPill(j.status === 'success' ? 'ready' : j.status === 'running' ? 'syncing' : 'failed')}</td><td class="tiny">${esc(j.started_at ? new Date(j.started_at).toLocaleString('vi-VN') : '—')}</td><td class="num">${fmt(j.records_seen)}</td><td class="num">${fmt(j.records_upserted)}</td><td class="num">${fmt(j.records_skipped)}</td><td class="num">${fmt(j.error_count)}</td><td class="tiny">${esc(j.message || '')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card card-pad-lg mt-2">
      <h2 style="font-size:1.15rem">Nhật ký hoạt động</h2>
      <div class="log-list">${data.logs.map(l => `<div class="log-line log-${esc(l.level)}">[${esc(new Date(l.created_at).toLocaleString('vi-VN'))}] ${esc((l.source_slug || 'system').toUpperCase())} · ${esc(l.message)}</div>`).join('') || '<div class="log-line">Chưa có nhật ký.</div>'}</div>
    </div>
  `);
  document.getElementById('refreshAdmin').addEventListener('click', () => viewAdmin());
  document.querySelectorAll('[data-sync]').forEach(btn => btn.addEventListener('click', async () => {
    const source = btn.dataset.sync;
    btn.disabled = true;
    btn.textContent = 'Đang chạy…';
    try {
      const res = await postJson('/api/admin/sync', { source });
      toast(res.message || 'Đã khởi chạy tác vụ nền');
      polling = setTimeout(() => viewAdmin(), 4000);
    } catch (err) {
      toast(`Không chạy được: ${err.message}`);
      btn.disabled = false;
      btn.textContent = 'Đồng bộ';
    }
  }));
  void polling;
}

export async function viewAbout(params) {
  setActiveNav('about');
  const stats = await getStats();
  const c = stats.counts;
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Phương pháp, giấy phép & miễn trừ' }])}
    ${pageHead({ kicker: 'About & Sources', title: 'Phương pháp, nguồn dữ liệu và giới hạn', lead: 'Trang này công bố cách dữ liệu được nhập, giấy phép của từng nguồn, phạm vi bao phủ thực tế và những phần chưa được triển khai. Không có số liệu minh họa.' })}
    <div class="grid grid-2">
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Nguồn dữ liệu đã tích hợp</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>Nguồn</th><th>Giấy phép</th><th>Bản ghi</th><th>Trạng thái</th></tr></thead><tbody>
          ${stats.sources.map(s => `<tr><td>${safeExternal(s.homepage, s.name)}<div class="tiny muted">${esc(s.description || '')}</div></td><td class="tiny">${esc(s.license_name)}</td><td class="num">${fmt(s.record_count)}</td><td>${statusPill(s.status)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="tiny muted mt-1">Giấy phép chi tiết và URL được lưu trong bảng <span class="mono">sources</span>; mỗi bản ghi có trường nguồn và ngày lấy dữ liệu.</p>
      </div>
      <div class="card card-pad-lg">
        <h2 style="font-size:1.15rem">Phạm vi bao phủ thực tế</h2>
        <div class="stack">
          <div class="flex between small"><span>Bệnh</span><strong>${fmt(c.diseases)}</strong></div>
          <div class="flex between small"><span>Triệu chứng / kiểu hình</span><strong>${fmt(c.symptoms)}</strong></div>
          <div class="flex between small"><span>Liên kết bệnh – triệu chứng</span><strong>${fmt(c.diseaseSymptoms)}</strong></div>
          <div class="flex between small"><span>Thuốc / sản phẩm</span><strong>${fmt(c.drugs)}</strong></div>
          <div class="flex between small"><span>Cấu trúc giải phẫu</span><strong>${fmt(c.anatomy)}</strong></div>
          <div class="flex between small"><span>Tác nhân vi sinh</span><strong>${fmt(c.organisms)}</strong></div>
          <div class="flex between small"><span>Gene</span><strong>${fmt(c.genes)}</strong></div>
          <div class="flex between small"><span>Xét nghiệm</span><strong>${fmt(c.labs)}</strong></div>
        </div>
        ${callout('warn', 'Không phải toàn bộ y học', `Kho dữ liệu hiện có ${fmt(c.diseases)} bản ghi bệnh và chưa bao phủ toàn bộ mọi bệnh đã được ghi nhận trên thế giới. Số liệu được cập nhật từ lần đồng bộ gần nhất: ${stats.lastSync ? esc(fmtDate(stats.lastSync)) : 'chưa có'}.`)}
      </div>
    </div>
    <div class="card card-pad-lg mt-2">
      <h2 style="font-size:1.15rem">Phương pháp</h2>
      <ol class="small">
        <li><strong>Nhập dữ liệu có kiểm soát:</strong> mỗi nguồn có bộ chuyển đổi riêng, ghi nhật ký số bản ghi xử lý/ghi/bỏ qua/lỗi. Dữ liệu được chuẩn hóa theo mã định danh (MONDO, ORPHA, HPO, NDC, TaxID).</li>
        <li><strong>Chống trùng lặp:</strong> khóa duy nhất theo mã nguồn (MONDO ID, ORPHA code, NDC, TaxID, HPO ID), không dùng tên bệnh làm khóa chính.</li>
        <li><strong>Tìm kiếm:</strong> SQLite FTS5 với văn bản đã chuẩn hóa bỏ dấu tiếng Việt, xếp hạng BM25, gợi ý tiền tố và tìm gần đúng bằng trigram.</li>
        <li><strong>Trợ lý AI:</strong> truy xuất bản ghi và trả lời trích xuất có nguồn; từ chối trả lời khi không có dữ liệu. Không có mô hình ngôn ngữ tự do nào được phép bịa nội dung y khoa.</li>
        <li><strong>Không suy đoán:</strong> trường thiếu dữ liệu hiển thị “Chưa có dữ liệu đáng tin cậy”; không dùng một khoảng tham chiếu xét nghiệm chung cho mọi người.</li>
      </ol>
    </div>
    <div class="card card-pad-lg mt-2">
      <h2 style="font-size:1.15rem">Những phần chưa triển khai</h2>
      <ul class="small">
        <li><strong>Tài khoản người dùng:</strong> chưa có đăng ký/đăng nhập, danh sách yêu thích hay ghi chú cá nhân.</li>
        <li><strong>Đa ngôn ngữ dữ liệu:</strong> giao diện tiếng Việt; tên bệnh hiển thị song song tiếng Anh và tên khoa học. Một số bệnh và triệu chứng phổ biến có nhãn tiếng Việt do nền tảng biên tập, được lưu ở trạng thái <span class="mono">machine_draft</span> trong bảng <span class="mono">translations</span> và luôn hiển thị kèm nhãn “chưa xác thực”. Chưa có bản dịch chính thức cho toàn bộ danh mục.</li>
        <li><strong>ICD-11:</strong> chưa kết nối do yêu cầu đăng ký và điều khoản truy cập của WHO. Mã ICD-10 và ICD-11 (khi nguồn MONDO cung cấp) được hiển thị khi có.</li>
        <li><strong>Nhãn thuốc:</strong> tải theo từng sản phẩm khi mở trang; không lưu sẵn toàn bộ kho nhãn.</li>
      </ul>
    </div>
    <div class="card card-pad-lg mt-2">
      ${callout('danger', 'Miễn trừ trách nhiệm y khoa', 'This platform is for educational and informational purposes only. It does not replace professional medical advice, diagnosis, or treatment. Nền tảng không cung cấp chẩn đoán, không kê đơn và không đưa ra phác đồ điều trị cá nhân. Trong trường hợp cấp cứu, hãy liên hệ ngay dịch vụ cấp cứu tại địa phương.')}
    </div>
  `);
}

export function viewNotFound() {
  setActiveNav('');
  render(`
    ${breadcrumb([{ label: 'Trang chủ', href: '#/' }, { label: 'Không tìm thấy' }])}
    <div class="empty-state"><div class="es-icon">⚕</div><strong>Không tìm thấy trang</strong><p>Đường dẫn không tồn tại hoặc dữ liệu đã thay đổi.</p><a class="btn btn-primary" href="#/">Về trang chủ</a></div>
  `);
}
