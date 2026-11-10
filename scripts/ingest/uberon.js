'use strict';
/**
 * Uberon anatomy ontology ingestion (CC BY 3.0).
 * Used by the Interactive Human Anatomy module for sourced anatomical terms.
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { download, parseObo, startJob, finishJob, recordLog } = require('./lib');

async function run({ force = false } = {}) {
  const conn = db.open();
  const jobId = startJob(conn, 'uberon', 'Tải Uberon ontology');
  try {
    const { file, size } = await download('https://purl.obolibrary.org/obo/uberon.obo', 'uberon.obo', { force, maxAgeHours: 168, label: 'Uberon' });
    recordLog(conn, jobId, 'uberon', 'info', `Tệp Uberon ${(size / 1048576).toFixed(1)} MB`);

    const terms = parseObo(fs.readFileSync(file, 'utf8')).filter(t => t.id && t.name && !t.obsolete && t.id.startsWith('UBERON:'));
    const byId = new Map(terms.map(t => [t.id, t]));

    function systemOf(term) {
      let current = term;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (/\bsystem$/.test(current.name) && current.id !== term.id) return current.name;
        const parents = (current.isA || []).map(id => byId.get(id)).filter(Boolean);
        current = parents[0] || null;
      }
      return null;
    }

    const cats = new Map(conn.prepare('SELECT slug, id FROM categories').all().map(r => [r.slug, r.id]));
    const upsert = conn.prepare(`
      INSERT INTO anatomy (slug, uberon_id, name_en, definition, parent_uberon, systems, part_of, source_slug, source_url, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'uberon', ?, ?)
      ON CONFLICT(uberon_id) DO UPDATE SET name_en=excluded.name_en, definition=excluded.definition,
        parent_uberon=excluded.parent_uberon, systems=excluded.systems, part_of=excluded.part_of, search_text=excluded.search_text
    `);
    const insCat = conn.prepare('INSERT OR IGNORE INTO disease_identifiers (disease_id, scheme, value, source_slug) VALUES (0, ?, ?, ?)');

    let seen = 0, upserted = 0;
    conn.exec('BEGIN');
    for (const t of terms) {
      seen++;
      const partOf = (t.properties || []).filter(p => p.startsWith('part_of ')).map(p => p.split(' ')[1]);
      upsert.run(
        db.slugify(t.name, t.id.replace(':', '')), t.id, t.name, t.def || null,
        (t.isA || [])[0] || null, systemOf(t), partOf.join(', ') || null,
        `https://www.ebi.ac.uk/ols4/ontologies/uberon/classes/http%3A%2F%2Fpurl.obolibrary.org%2Fobo%2F${t.id.replace(':', '_')}`,
        db.fold([t.name, t.def, systemOf(t)].filter(Boolean).join(' '))
      );
      upserted++;
    }
    conn.exec('COMMIT');
    void cats; void insCat;

    db.setMeta(conn, 'uberon_term_count', upserted);
    db.setMeta(conn, 'uberon_retrieved_at', new Date().toISOString());
    finishJob(conn, jobId, 'uberon', 'success', { seen, upserted, skipped: 0, errors: 0 }, `Đã nhập ${upserted.toLocaleString('vi-VN')} thuật ngữ giải phẫu`);
  } catch (err) {
    recordLog(conn, jobId, 'uberon', 'error', err.message);
    finishJob(conn, jobId, 'uberon', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('Uberon xong')).catch(err => { console.error(err); process.exit(1); });
}
