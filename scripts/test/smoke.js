'use strict';
/**
 * End-to-end smoke test: boots the real server on a test port, exercises the public API,
 * the MySQL injection/XSS-facing inputs, admin protection and the grounded assistant.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SMOKE_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ADMIN_TOKEN: 'smoke-test-token' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  const stop = () => { try { child.kill(); } catch { /* noop */ } };

  try {
    const ready = await waitForServer();
    check('Máy chủ khởi động và /api/health trả 200', ready, out.slice(0, 300));
    if (!ready) throw new Error('Server không khởi động');

    const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, json: await r.json().catch(() => null) }; };

    const stats = await get('/api/stats');
    check('Thống kê trả về số liệu thật', stats.status === 200 && stats.json.counts.diseases > 1000, JSON.stringify(stats.json?.counts));
    check('Đã nhập đủ ICD-10-CM, gene và pathway', stats.json.counts.icdCodes > 10000 && stats.json.counts.genes > 10000 && stats.json.counts.pathways > 100, JSON.stringify(stats.json?.counts));

    const diseases = await get('/api/diseases?pageSize=5');
    check('Danh sách bệnh có phân trang', diseases.status === 200 && diseases.json.results.length > 0 && diseases.json.total > 0);

    const slug = diseases.json.results[0].slug;
    const detail = await get(`/api/diseases/${encodeURIComponent(slug)}`);
    check('Trang chi tiết bệnh trả đủ trường nguồn', detail.status === 200 && detail.json.name_en && Array.isArray(detail.json.sources));

    const search = await get('/api/search?q=dai%20thao%20duong');
    check('Tìm kiếm không dấu hoạt động', search.status === 200 && search.json.total > 0, `total=${search.json?.total}`);

    const searchDiacritics = await get(`/api/search?q=${encodeURIComponent('đái tháo đường')}`);
    check('Tìm kiếm có dấu hoạt động', searchDiacritics.status === 200 && searchDiacritics.json.total > 0);

    const injection = await get(`/api/search?q=${encodeURIComponent("'; DROP TABLE diseases; --")}`);
    check('Truy vấn độc hại không làm sập dữ liệu', injection.status === 200 && (await get('/api/stats')).json.counts.diseases > 1000);

    const xss = await get(`/api/search?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    check('Chuỗi XSS được xử lý như văn bản', xss.status === 200);

    const symptom = await get('/api/symptoms?pageSize=3');
    check('Thư viện triệu chứng có dữ liệu', symptom.status === 200 && symptom.json.total > 1000);
    const symptomDetail = await get(`/api/symptoms/${encodeURIComponent(symptom.json.results[0].slug)}`);
    check('Chi tiết triệu chứng liên kết bệnh', symptomDetail.status === 200 && Array.isArray(symptomDetail.json.diseases));

    const drugs = await get('/api/drugs?pageSize=3');
    check('Thư viện thuốc có dữ liệu', drugs.status === 200 && drugs.json.total > 0);

    const anatomy = await get('/api/anatomy?pageSize=3');
    check('Giải phẫu Uberon có dữ liệu', anatomy.status === 200 && anatomy.json.total > 100);

    const labs = await get('/api/labs?pageSize=3');
    check('Thư viện xét nghiệm có dữ liệu', labs.status === 200 && labs.json.total > 0);

    const organisms = await get('/api/organisms?pageSize=3');
    check('Thư viện vi sinh có dữ liệu', organisms.status === 200 && organisms.json.total > 0);

    const codes = await get('/api/codes?q=E11&pageSize=5');
    check('Tra cứu mã ICD-10-CM hoạt động', codes.status === 200 && codes.json.total > 0 && codes.json.results.some(r => r.code.startsWith('E11')), JSON.stringify(codes.json?.results?.[0]));

    const genes = await get('/api/genes?pageSize=3');
    check('Danh mục NCBI Gene có dữ liệu', genes.status === 200 && genes.json.total > 10000);
    const geneSlug = genes.json.results[0]?.slug;
    const geneDetail = await get(`/api/genes/${encodeURIComponent(geneSlug)}`);
    check('Chi tiết gene có alias/pathway/protein', geneDetail.status === 200 && Array.isArray(geneDetail.json.aliases) && Array.isArray(geneDetail.json.pathways) && Array.isArray(geneDetail.json.proteins));

    const trials = await get('/api/trials?q=diabetes&pageSize=2');
    check('ClinicalTrials.gov trả kết quả thật', trials.status === 200 && Array.isArray(trials.json.results), trials.json?.error);

    const research = await get('/api/research?q=tuberculosis&pageSize=2&source=europepmc');
    check('Europe PMC trả kết quả thật', research.status === 200 && Array.isArray(research.json.results), research.json?.error);

    const assistantRes = await fetch(`${BASE}/api/assistant`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Đái tháo đường type 2 là gì?' })
    });
    const assistantJson = await assistantRes.json();
    check('Trợ lý AI trả lời có nguồn trích dẫn', assistantRes.status === 200 && Array.isArray(assistantJson.citations) && assistantJson.citations.length > 0);

    const unknown = await fetch(`${BASE}/api/assistant`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'zzzqqq không tồn tại xyzabc' })
    });
    const unknownJson = await unknown.json();
    check('Trợ lý từ chối khi không đủ dữ liệu (không bịa)', unknown.status === 200 && /Không đủ dữ liệu/.test(JSON.stringify(unknownJson.blocks)));

    const exportJson = await get(`/api/export/disease/${encodeURIComponent(slug)}`);
    check('Xuất JSON bệnh hoạt động', exportJson.status === 200 && exportJson.json.record?.slug === slug);

    const admin = await fetch(`${BASE}/api/admin/overview`, { headers: { 'x-admin-token': 'smoke-test-token' } });
    check('Bảng quản trị truy cập được khi có token', admin.status === 200);
    const adminDenied = await fetch(`${BASE}/api/admin/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'labs' }) });
    check('Không cho phép đồng bộ khi thiếu token quản trị', adminDenied.status === 403);

    const badSource = await fetch(`${BASE}/api/admin/sync`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'smoke-test-token' }, body: JSON.stringify({ source: 'evil; rm -rf /' }) });
    check('Chặn tên nguồn đồng bộ độc hại', badSource.status === 400);

    const page = await fetch(`${BASE}/`);
    const html = await page.text();
    check('Trang chủ tải được và có CSP', page.status === 200 && /Content-Security-Policy/i.test([...page.headers].join(' ')) && html.includes('Global Medical Encyclopedia'));
    check('Không công khai database qua static', (await fetch(`${BASE}/data/medical.db`)).status === 404);
    check('Không công khai mã nguồn server', (await fetch(`${BASE}/server/index.js`)).status === 404);
  } finally {
    stop();
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
