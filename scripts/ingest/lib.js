'use strict';
/**
 * Shared ingestion utilities: HTTP with redirects/retry/rate limiting,
 * cache files, OBO parsing and job bookkeeping.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { ROOT, recordLog } = require('../../server/db');

const CACHE_DIR = path.join(ROOT, 'data', 'cache');
const USER_AGENT = 'GlobalMedicalEncyclopedia/2.0 (educational; contact: admin@example.org)';

function ensureCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestOnce(url, { timeout = 90000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const client = new URL(url).protocol === 'http:' ? http : https;
    const req = client.get(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve({ redirect: next });
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error(`Timeout sau ${timeout}ms: ${url}`)));
  });
}

async function httpGet(url, { timeout = 120000, retries = 3, headers = {}, binary = false, label = '' } = {}) {
  let current = url;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let redirects = 0;
      while (redirects < 6) {
        const res = await requestOnce(current, { timeout, headers });
        if (res.redirect) { current = res.redirect; redirects++; continue; }
        if (res.status >= 400) {
          const text = res.body.subarray(0, 300).toString('utf8').replace(/\s+/g, ' ');
          throw new Error(`HTTP ${res.status} ${text}`);
        }
        return binary ? res.body : res.body.toString('utf8');
      }
      throw new Error('Quá nhiều chuyển hướng');
    } catch (err) {
      if (attempt === retries) throw new Error(`${label || url}: ${err.message}`);
      await sleep(700 * attempt * attempt);
    }
  }
}

async function httpJson(url, opts = {}) {
  const text = await httpGet(url, opts);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON không hợp lệ từ ${url}: ${text.slice(0, 200)}`);
  }
}

function cachePath(name) {
  ensureCache();
  return path.join(CACHE_DIR, name);
}

/** Download once; reuse cached copy for a number of hours unless force is set. */
async function download(url, name, { force = false, maxAgeHours = 24, label = '' } = {}) {
  const file = cachePath(name);
  if (!force && fs.existsSync(file)) {
    const age = (Date.now() - fs.statSync(file).mtimeMs) / 3600000;
    if (age <= maxAgeHours) {
      return { file, cached: true, size: fs.statSync(file).size };
    }
  }
  const buf = await httpGet(url, { binary: true, label: label || name });
  fs.writeFileSync(file, buf);
  return { file, cached: false, size: buf.length };
}

/** Minimal OBO 1.4 parser. Returns arrays of term stanzas. */
function parseObo(text) {
  const terms = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  let stanza = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' ) { current = null; continue; }
    if (line.startsWith('[') && line.endsWith(']')) {
      stanza = line.slice(1, -1);
      if (stanza === 'Term') current = { xrefs: [], synonyms: [], isA: [], altIds: [], intersections: [], properties: [], subsets: [] };
      else current = null;
      if (current) terms.push(current);
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(': ');
    if (idx < 0) {
      if (line.startsWith('is_obsolete')) current.obsolete = true;
      continue;
    }
    const key = line.slice(0, idx);
    const value = line.slice(idx + 2);
    switch (key) {
      case 'id': current.id = value.trim(); break;
      case 'name': current.name = value.trim(); break;
      case 'def': {
        const m = value.match(/^"(.*?)"\s*(\[.*\])?/s);
        if (m) current.def = m[1].replace(/\\"/g, '"').trim();
        current.defXrefs = m && m[2] ? m[2] : '';
        break;
      }
      case 'comment': current.comment = value.replace(/^"|"$/g, ''); break;
      case 'synonym': {
        const m = value.match(/^"(.*?)"\s+(EXACT|BROAD|NARROW|RELATED)\s*(.*)$/s);
        if (m) {
          const langMatch = m[3].match(/\b(?:lang|language)=([a-zA-Z-]+)/);
          current.synonyms.push({ name: m[1].replace(/\\"/g, '"').trim(), scope: m[2], lang: langMatch ? langMatch[1].toLowerCase() : 'en' });
        }
        break;
      }
      case 'xref': current.xrefs.push(value.split('{')[0].trim()); break;
      case 'alt_id': current.altIds.push(value.trim()); break;
      case 'is_a': current.isA.push(value.split('{')[0].trim()); break;
      case 'intersection_of': current.intersections.push(value.split('{')[0].trim()); break;
      case 'subset': current.subsets.push(value.trim()); break;
      case 'property_value': case 'relationship': current.properties.push(value.split('{')[0].trim()); break;
      case 'is_obsolete': current.obsolete = true; break;
      case 'replaced_by': current.replacedBy = value.trim(); break;
      default: break;
    }
  }
  return terms;
}

function xrefValues(term, prefixes) {
  const out = new Map();
  for (const x of term.xrefs) {
    const [scheme, ...rest] = x.split(':');
    const upper = scheme.toUpperCase();
    if (prefixes.includes(upper)) {
      const val = rest.join(':').trim();
      if (!out.has(upper)) out.set(upper, []);
      if (val && !out.get(upper).includes(val)) out.get(upper).push(val);
    }
  }
  return out;
}

function shortHash(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 12);
}

function startJob(db, sourceSlug, message = '') {
  const started = new Date().toISOString();
  db.prepare('INSERT INTO data_import_jobs (source_slug, status, started_at, message) VALUES (?, ?, ?, ?)')
    .run(sourceSlug, 'running', started, message);
  const id = db.prepare('SELECT id FROM data_import_jobs WHERE source_slug = ? ORDER BY id DESC LIMIT 1').get(sourceSlug).id;
  db.prepare("UPDATE sources SET status = 'syncing' WHERE slug = ?").run(sourceSlug);
  recordLog(db, id, sourceSlug, 'info', `Bắt đầu đồng bộ: ${message || sourceSlug}`);
  return id;
}

function updateJob(db, jobId, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE data_import_jobs SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map(k => fields[k]), jobId);
}

function finishJob(db, jobId, sourceSlug, status, counters = {}, message = '') {
  const finished = new Date().toISOString();
  updateJob(db, jobId, {
    status,
    finished_at: finished,
    records_seen: counters.seen || 0,
    records_upserted: counters.upserted || 0,
    records_skipped: counters.skipped || 0,
    error_count: counters.errors || 0,
    message
  });
  if (status === 'success') {
    db.prepare("UPDATE sources SET status = 'ready', last_success_at = ?, retrieved_at = ? WHERE slug = ?")
      .run(finished, finished, sourceSlug);
  } else {
    db.prepare("UPDATE sources SET status = ? WHERE slug = ?").run(status, sourceSlug);
  }
  recordLog(db, jobId, sourceSlug, status === 'success' ? 'info' : 'error', message || status);
}

/** Simple concurrency pool. */
async function pool(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

module.exports = {
  CACHE_DIR, USER_AGENT, httpGet, httpJson, download, parseObo, xrefValues,
  shortHash, startJob, finishJob, updateJob, pool, sleep, cachePath, recordLog
};
