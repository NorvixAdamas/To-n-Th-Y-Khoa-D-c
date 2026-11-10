'use strict';
/**
 * Global Medical Encyclopedia — HTTP API + static application server.
 * Node built-ins only (node:http, node:sqlite). No secrets are sent to the browser.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const q = require('./queries');
const dbm = require('./db');
dbm.init(q.db);
const external = require('./external');
const assistant = require('./assistant');

const ROOT = path.resolve(__dirname, '..');
const ENV_PORT = Number(process.env.PORT);
const PORT = Number.isFinite(ENV_PORT) && ENV_PORT > 0 ? ENV_PORT : 8787;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const INGEST_SCRIPTS = {
  mondo: 'scripts/ingest/mondo.js',
  hpo: 'scripts/ingest/hpo.js',
  orphadata: 'scripts/ingest/orphadata.js',
  uberon: 'scripts/ingest/uberon.js',
  openfda: 'scripts/ingest/openfda.js',
  doid: 'scripts/ingest/doid.js',
  ncbi_gene: 'scripts/ingest/ncbi-gene.js',
  icd10cm: 'scripts/ingest/icd10cm.js',
  reactome: 'scripts/ingest/reactome.js',
  uniprot: 'scripts/ingest/uniprot.js',
  taxonomy: 'scripts/ingest/taxonomy.js',
  labs: 'scripts/ingest/labs.js',
  reindex: 'scripts/ingest/reindex.js'
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.wasm': 'application/wasm'
};

const DENY_DIRS = ['data', 'server', 'scripts', 'node_modules', '.git', '.freebuff', '.qodo'];

const rateBuckets = new Map();
function rateLimit(ip, limit, windowMs = 60000) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

function securityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
}

function sendJson(req, res, status, payload, cacheSeconds = 0) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'x-api-version': '2.0' };
  headers['cache-control'] = cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : 'no-store';
  const acceptsGzip = req && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (body.length > 1024 && acceptsGzip) {
    const gz = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'Accept-Encoding';
    headers['content-length'] = gz.length;
    res.writeHead(status, headers);
    return res.end(gz);
  }
  headers['content-length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

function sendError(res, status, message, code = 'error') {
  sendJson(null, res, status, { error: message, code });
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Dữ liệu gửi lên quá lớn')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function adminAllowed(req) {
  if (ADMIN_TOKEN) {
    const supplied = req.headers['x-admin-token'];
    return typeof supplied === 'string' && supplied.length === ADMIN_TOKEN.length && supplied === ADMIN_TOKEN;
  }
  return isLoopback(req);
}

function pagination(url) {
  const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page') || 1) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get('pageSize') || 24) || 24));
  return { page, pageSize };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function streamCsv(res, rows, headers) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="diseases-${new Date().toISOString().slice(0, 10)}.csv"`,
    'cache-control': 'no-store',
    ...SECURITY_HEADERS
  });
  res.write('\uFEFF' + headers.join(',') + '\n');
  for (const row of rows) res.write(headers.map(h => csvEscape(row[h])).join(',') + '\n');
  res.end();
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;
  const ip = req.socket.remoteAddress || 'unknown';
  const isAssistant = p.startsWith('/assistant');
  const bucketKey = `${ip}:${isAssistant ? 'assistant' : 'api'}`;
  if (!rateLimit(bucketKey, isAssistant ? 20 : 400)) {
    return sendError(res, 429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau một phút.', 'rate_limited');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return sendError(res, 403, 'Yêu cầu khác origin bị từ chối.', 'forbidden');
      } catch { return sendError(res, 403, 'Origin không hợp lệ.', 'forbidden'); }
    }
  }

  if (p === '/health') return sendJson(req, res, 200, { status: 'ok', time: new Date().toISOString(), node: process.version });
  if (p === '/stats') return sendJson(req, res, 200, q.stats(), 60);
  if (p === '/sources') return sendJson(req, res, 200, { sources: q.sources() }, 120);
  if (p === '/categories') return sendJson(req, res, 200, { categories: q.stats().categories }, 120);

  if (p === '/search') {
    return sendJson(req, res, 200, q.search({
      q: url.searchParams.get('q') || '',
      type: url.searchParams.get('type') || '',
      ...pagination(url)
    }), 20);
  }
  if (p === '/suggest') {
    return sendJson(req, res, 200, { suggestions: q.suggest(url.searchParams.get('q') || '', 8) }, 30);
  }

  if (p === '/diseases') {
    return sendJson(req, res, 200, q.listDiseases({
      q: url.searchParams.get('q') || '',
      category: url.searchParams.get('category') || '',
      rare: url.searchParams.get('rare') || '',
      sort: url.searchParams.get('sort') || 'name',
      ...pagination(url)
    }), 30);
  }
  if (p.startsWith('/diseases/')) {
    const slug = decodeURIComponent(p.slice('/diseases/'.length));
    const data = q.getDisease(slug);
    if (!data) return sendError(res, 404, 'Không tìm thấy bệnh trong kho dữ liệu.', 'not_found');
    return sendJson(req, res, 200, data, 300);
  }

  if (p === '/symptoms') {
    return sendJson(req, res, 200, q.listSymptoms({
      q: url.searchParams.get('q') || '',
      system: url.searchParams.get('system') || '',
      ...pagination(url)
    }), 30);
  }
  if (p.startsWith('/symptoms/')) {
    const data = q.getSymptom(decodeURIComponent(p.slice('/symptoms/'.length)));
    if (!data) return sendError(res, 404, 'Không tìm thấy triệu chứng.', 'not_found');
    return sendJson(req, res, 200, data, 300);
  }

  if (p === '/anatomy') {
    return sendJson(req, res, 200, q.listAnatomy({
      q: url.searchParams.get('q') || '', system: url.searchParams.get('system') || '', ...pagination(url)
    }), 60);
  }
  if (p.startsWith('/anatomy/')) {
    const data = q.getAnatomy(decodeURIComponent(p.slice('/anatomy/'.length)));
    if (!data) return sendError(res, 404, 'Không tìm thấy cấu trúc giải phẫu.', 'not_found');
    return sendJson(req, res, 200, data, 300);
  }

  if (p === '/drugs') {
    return sendJson(req, res, 200, q.listDrugs({
      q: url.searchParams.get('q') || '',
      ingredient: url.searchParams.get('ingredient') || '',
      form: url.searchParams.get('form') || '',
      labeler: url.searchParams.get('labeler') || '',
      ...pagination(url)
    }), 30);
  }
  if (p.startsWith('/drugs/')) {
    const data = q.getDrug(decodeURIComponent(p.slice('/drugs/'.length)));
    if (!data) return sendError(res, 404, 'Không tìm thấy thuốc.', 'not_found');
    try { data.label = await external.getDrugLabel(data); } catch { /* label stays cached/null */ }
    return sendJson(req, res, 200, data, 120);
  }

  if (p === '/labs') return sendJson(req, res, 200, q.listLabs({ q: url.searchParams.get('q') || '', ...pagination(url) }), 60);
  if (p.startsWith('/labs/')) {
    const data = q.getLab(decodeURIComponent(p.slice('/labs/'.length)));
    if (!data) return sendError(res, 404, 'Không tìm thấy xét nghiệm.', 'not_found');
    return sendJson(req, res, 200, data, 300);
  }

  if (p === '/organisms') {
    return sendJson(req, res, 200, q.listOrganisms({
      q: url.searchParams.get('q') || '', kingdom: url.searchParams.get('kingdom') || '', ...pagination(url)
    }), 30);
  }
  if (p.startsWith('/organisms/')) {
    const data = q.getOrganism(decodeURIComponent(p.slice('/organisms/'.length)));
    if (!data) return sendError(res, 404, 'Không tìm thấy tác nhân gây bệnh.', 'not_found');
    return sendJson(req, res, 200, data, 300);
  }

  if (p === '/codes') return sendJson(req, res, 200, q.listCodes({
    q: url.searchParams.get('q') || '', chapter: url.searchParams.get('chapter') || '', ...pagination(url)
  }), 60);

  if (p === '/genes') return sendJson(req, res, 200, q.listGenes({ q: url.searchParams.get('q') || '', ...pagination(url) }), 30);
  if (p.startsWith('/genes/')) {
    const data = q.getGene(decodeURIComponent(p.slice('/genes/'.length)));
    if (!data) return sendError(res, 404, 'Không tìm thấy gene.', 'not_found');
    return sendJson(req, res, 200, data, 300);
  }

  if (p === '/research') {
    try {
      const data = await external.researchSearch({
        q: url.searchParams.get('q') || '',
        source: url.searchParams.get('source') || 'all',
        openAccess: url.searchParams.get('openAccess') === '1',
        year: url.searchParams.get('year') || '',
        sort: url.searchParams.get('sort') || 'relevance',
        page: Number(url.searchParams.get('page') || 1) || 1,
        pageSize: Math.min(50, Number(url.searchParams.get('pageSize') || 20) || 20)
      });
      return sendJson(req, res, 200, data, 30);
    } catch (err) {
      return sendError(res, 502, `Không truy vấn được nguồn nghiên cứu: ${err.message}`, 'upstream_error');
    }
  }

  if (p === '/trials') {
    try {
      const data = await external.trialSearch({
        q: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || '',
        country: url.searchParams.get('country') || '',
        page: Number(url.searchParams.get('page') || 1) || 1,
        pageSize: Math.min(50, Number(url.searchParams.get('pageSize') || 15) || 15),
        pageToken: url.searchParams.get('pageToken') || ''
      });
      return sendJson(req, res, 200, data, 30);
    } catch (err) {
      return sendError(res, 502, `Không truy vấn được ClinicalTrials.gov: ${err.message}`, 'upstream_error');
    }
  }

  if (p === '/assistant' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message, 'bad_request'); }
    if (!body.question || typeof body.question !== 'string') return sendError(res, 400, 'Thiếu câu hỏi.', 'bad_request');
    const result = await assistant.answer(body.question);
    return sendJson(req, res, 200, result);
  }

  if (p.startsWith('/export/disease/')) {
    const slug = decodeURIComponent(p.slice('/export/disease/'.length)).replace(/\.json$/, '');
    const data = q.getDisease(slug);
    if (!data) return sendError(res, 404, 'Không tìm thấy bệnh.', 'not_found');
    res.setHeader('content-disposition', `attachment; filename="${slug}.json"`);
    return sendJson(req, res, 200, { exportedAt: new Date().toISOString(), license: 'Dữ liệu tuân theo giấy phép của từng nguồn', record: data });
  }
  if (p === '/export/diseases.csv') {
    if (!adminAllowed(req)) return sendError(res, 403, 'Cần quyền quản trị để xuất toàn bộ dữ liệu.', 'forbidden');
    const rows = q.db.prepare(`SELECT d.mondo_id, d.orphanet_code, d.slug, d.name_en, d.name_vi, c.slug AS category_slug,
        d.icd10, d.definition, d.inheritance, d.prevalence, d.source_slug, d.retrieved_at
      FROM diseases d LEFT JOIN categories c ON c.id=d.category_id ORDER BY d.name_en`).iterate();
    return streamCsv(res, rows, ['mondo_id', 'orphanet_code', 'slug', 'name_en', 'name_vi', 'category_slug', 'icd10', 'definition', 'inheritance', 'prevalence', 'source_slug', 'retrieved_at']);
  }

  /* -------- Admin -------- */
  if (p.startsWith('/admin')) {
    if (!adminAllowed(req)) return sendError(res, 403, 'Cần quyền quản trị. Đặt ADMIN_TOKEN hoặc truy cập từ máy cục bộ.', 'forbidden');
    if (p === '/admin/overview') {
      const stats = q.stats();
      return sendJson(req, res, 200, {
        stats, jobs: q.jobs(20), logs: q.logs(40), quality: q.quality(),
        database: {
          path: 'data/medical.db', engine: 'SQLite (WAL)',
          sizeBytes: fs.existsSync(path.join(ROOT, 'data', 'medical.db')) ? fs.statSync(path.join(ROOT, 'data', 'medical.db')).size : 0,
          walBytes: fs.existsSync(path.join(ROOT, 'data', 'medical.db-wal')) ? fs.statSync(path.join(ROOT, 'data', 'medical.db-wal')).size : 0
        },
        adminTokenConfigured: Boolean(ADMIN_TOKEN), loopback: isLoopback(req)
      });
    }
    if (p === '/admin/quality') return sendJson(req, res, 200, q.quality());
    if (p === '/admin/logs') return sendJson(req, res, 200, { logs: q.logs(200, url.searchParams.get('job') ? Number(url.searchParams.get('job')) : null) });
    if (p === '/admin/jobs') return sendJson(req, res, 200, { jobs: q.jobs(50) });
    if (p === '/admin/export') {
      const payload = {
        exportedAt: new Date().toISOString(),
        schemaVersion: '2.1.0',
        stats: q.stats().counts,
        sources: q.sources(),
        categories: q.stats().categories,
        jobs: q.jobs(50),
        note: 'Bản xuất cấu hình và metadata. Dùng /api/export/diseases.csv để xuất toàn bộ bệnh.'
      };
      res.setHeader('content-disposition', `attachment; filename="medical-encyclopedia-metadata-${Date.now()}.json"`);
      return sendJson(req, res, 200, payload);
    }
    if (p === '/admin/sync' && method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message, 'bad_request'); }
      const source = String(body.source || '');
      const script = INGEST_SCRIPTS[source];
      if (!script) return sendError(res, 400, `Nguồn không hợp lệ. Hỗ trợ: ${Object.keys(INGEST_SCRIPTS).join(', ')}`, 'bad_request');
      const child = spawn(process.execPath, [script, ...(body.force ? ['--force'] : [])], {
        cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true
      });
      child.unref();
      return sendJson(req, res, 202, { started: true, source, pid: child.pid, message: 'Tác vụ đồng bộ đã được khởi chạy ở tiến trình nền. Theo dõi trong nhật ký.' });
    }
  }

  return sendError(res, 404, 'Không tìm thấy endpoint.', 'not_found');
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const normalized = path.normalize(pathname).replace(/^([/\\])+/, '');
  const first = normalized.split(/[/\\]/)[0];
  if (DENY_DIRS.includes(first)) return sendError(res, 404, 'Not found', 'not_found');
  const filePath = path.join(ROOT, normalized);
  if (!filePath.startsWith(ROOT)) return sendError(res, 403, 'Forbidden', 'forbidden');
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (!path.extname(filePath)) {
        const indexPath = path.join(ROOT, 'index.html');
        if (fs.existsSync(indexPath)) return fs.createReadStream(indexPath).pipe(res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME['.html'] }));
      }
      return sendError(res, 404, 'Not found', 'not_found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
      ...SECURITY_HEADERS
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  securityHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204, SECURITY_HEADERS); return res.end(); }
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendError(res, 400, 'URL không hợp lệ', 'bad_request'); }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(err => {
      console.error('[api]', err);
      if (!res.headersSent) sendError(res, 500, 'Lỗi máy chủ nội bộ.', 'internal_error');
      else res.end();
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method not allowed', 'method_not_allowed');
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Global Medical Encyclopedia đang chạy tại http://${HOST}:${PORT}`);
  const counts = q.counts();
  console.log(`Dữ liệu: ${counts.diseases} bệnh · ${counts.symptoms} triệu chứng · ${counts.drugs} thuốc · ${counts.labs} xét nghiệm · ${counts.organisms} tác nhân · ${counts.genes} gene`);
});

server.on('error', err => {
  console.error('Không thể khởi động máy chủ:', err.message);
  process.exit(1);
});
