'use strict';
/**
 * Human Disease Ontology (DOID) ingestion — CC0.
 * Enriches existing MONDO/Orphanet disease records with DOID cross-references,
 * definitions and synonyms. It never invents a new disease when no match exists.
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { download, parseObo, startJob, finishJob, recordLog } = require('./lib');

const URL = 'https://purl.obolibrary.org/obo/doid.obo';

async function run({ force = false } = {}) {
  const conn = db.open();
  db.init(conn);
  const jobId = startJob(conn, 'doid', 'Tải Human Disease Ontology');
  try {
    const file = await download(URL, 'doid.obo', { force, maxAgeHours: 168, label: 'DOID' });
    const terms = parseObo(fs.readFileSync(file.file, 'utf8')).filter(t => t.id?.startsWith('DOID:') && t.name && !t.obsolete);
    recordLog(conn, jobId, 'doid', 'info', `Đọc ${terms.length} thuật ngữ DOID`);

    const findByIdentifier = conn.prepare("SELECT disease_id FROM disease_identifiers WHERE scheme='doid' AND value=? LIMIT 1");
    const findById = conn.prepare('SELECT id, doid, definition FROM diseases WHERE id=?');
    const findByCode = conn.prepare('SELECT id, doid, definition FROM diseases WHERE doid=? LIMIT 1');
    const update = conn.prepare(`UPDATE diseases SET doid=COALESCE(doid, ?), definition=COALESCE(definition, ?),
      definition_source=COALESCE(definition_source, ?), updated_at=? WHERE id=?`);
    const insIdent = conn.prepare("INSERT OR IGNORE INTO disease_identifiers (disease_id, scheme, value, source_slug) VALUES (?, 'doid', ?, 'doid')");
    const markIdent = conn.prepare("UPDATE disease_identifiers SET source_slug='doid' WHERE disease_id=? AND scheme='doid'");
    const insSyn = conn.prepare("INSERT OR IGNORE INTO disease_synonyms (disease_id, name, lang, scope, source_slug) VALUES (?, ?, ?, ?, 'doid')");
    const insParent = conn.prepare('INSERT OR IGNORE INTO disease_parents (disease_id, parent_id) VALUES (?, ?)');
    const now = new Date().toISOString();

    // First pass: match and enrich. Build a DOID -> disease-id map for parent links.
    const idMap = new Map();
    let matched = 0, defined = 0, synonyms = 0, errors = 0;
    conn.exec('BEGIN');
    for (const term of terms) {
      try {
        const code = term.id;
        const bare = code.replace(/^DOID:/, '');
        const ident = findByIdentifier.get(bare) || findByIdentifier.get(code);
        let row = ident ? findById.get(ident.disease_id) : (findByCode.get(bare) || findByCode.get(code));
        if (!row) continue;
        if (!row.doid) {
          update.run(bare, term.def || null, term.def ? 'Human Disease Ontology (CC0)' : null, now, row.id);
          if (term.def) defined++;
        } else {
          update.run(null, row.definition ? null : (term.def || null), term.def ? 'Human Disease Ontology (CC0)' : null, now, row.id);
          if (!row.definition && term.def) defined++;
        }
        insIdent.run(row.id, bare);
        markIdent.run(row.id);
        idMap.set(code, row.id);
        idMap.set(bare, row.id);
        matched++;
        if (matched % 1000 === 0) recordLog(conn, jobId, 'doid', 'info', `Đã xử lý ${matched} thuật ngữ DOID`);
        for (const syn of (term.synonyms || []).slice(0, 30)) {
          if (!syn.name) continue;
          insSyn.run(row.id, syn.name, syn.lang || 'en', syn.scope || 'exact');
          synonyms++;
        }
      } catch (err) {
        errors++;
        if (errors <= 8) recordLog(conn, jobId, 'doid', 'error', `${term.id}: ${err.message}`);
      }
    }
    // Second pass: parents only when both sides map to real disease rows.
    let parents = 0;
    for (const term of terms) {
      const child = idMap.get(term.id);
      if (!child) continue;
      for (const rawParent of term.isA || []) {
        const parentCode = rawParent.split(/\s+!/)[0].trim();
        const parent = idMap.get(parentCode) || idMap.get(parentCode.replace(/^DOID:/, ''));
        if (parent && parent !== child) { insParent.run(child, parent); parents++; }
      }
    }
    conn.exec('COMMIT');
    db.setMeta(conn, 'doid_linked_terms', matched);
    db.setMeta(conn, 'doid_retrieved_at', now);
    finishJob(conn, jobId, 'doid', 'success', { seen: terms.length, upserted: matched, skipped: terms.length - matched, errors },
      `DOID: liên kết ${matched.toLocaleString('vi-VN')} bệnh, thêm ${defined} định nghĩa, ${synonyms} synonym, ${parents} quan hệ cha`);
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
    recordLog(conn, jobId, 'doid', 'error', err.message);
    finishJob(conn, jobId, 'doid', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };
if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('DOID xong')).catch(err => { console.error(err); process.exit(1); });
}
