'use strict';
/**
 * UniProt Knowledgebase — reviewed human proteins (CC BY 4.0).
 * The stream endpoint returns a TSV with accession, primary gene, protein name,
 * length, function and subcellular location. Proteins are linked by symbol.
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { download, startJob, finishJob, recordLog } = require('./lib');

const URL = 'https://rest.uniprot.org/uniprotkb/stream?query=organism_id%3A9606%20AND%20reviewed%3Atrue&format=tsv&fields=accession,gene_primary,protein_name,length,cc_function,cc_subcellular_location';

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim() || null;
}

async function run({ force = false } = {}) {
  const conn = db.open();
  db.init(conn);
  const jobId = startJob(conn, 'uniprot', 'Tải UniProt reviewed human proteins');
  try {
    const file = await download(URL, 'uniprot_human.tsv', { force, maxAgeHours: 168, label: 'UniProt human' });
    const lines = fs.readFileSync(file.file, 'utf8').split(/\r?\n/);
    const header = lines.shift().split('\t');
    const col = Object.fromEntries(header.map((h, i) => [h, i]));
    const findGene = conn.prepare('SELECT id FROM genes WHERE symbol=? LIMIT 1');
    const upsert = conn.prepare(`
      INSERT INTO proteins (uniprot_id, gene_id, gene_symbol, name, organism, length, function, subcellular,
        url, source_slug, retrieved_at, search_text)
      VALUES (?, ?, ?, ?, 'Homo sapiens', ?, ?, ?, ?, 'uniprot', ?, ?)
      ON CONFLICT(uniprot_id) DO UPDATE SET gene_id=excluded.gene_id, gene_symbol=excluded.gene_symbol,
        name=excluded.name, length=excluded.length, function=excluded.function,
        subcellular=excluded.subcellular, url=excluded.url, retrieved_at=excluded.retrieved_at, search_text=excluded.search_text
    `);
    const now = new Date().toISOString();
    let seen = 0, upserted = 0, linked = 0, errors = 0;
    conn.exec('BEGIN');
    for (const line of lines) {
      if (!line) continue;
      const cols = line.split('\t');
      if (cols.length < 4) continue;
      const accession = clean(cols[col.Entry]);
      if (!accession || accession === 'Entry') continue;
      seen++;
      try {
        const genes = clean(cols[col['Gene Names (primary)']])?.split(/\s+/).filter(Boolean) || [];
        const symbol = genes[0] || null;
        const gene = symbol ? findGene.get(symbol) : null;
        const name = clean(cols[col['Protein names']]);
        const length = Number(cols[col.Length]) || null;
        const fn = clean(cols[col['Function [CC]']]);
        const sub = clean(cols[col['Subcellular location [CC]']]);
        upsert.run(accession, gene?.id || null, symbol, name, length, fn, sub,
          `https://www.uniprot.org/uniprotkb/${accession}/entry`, now,
          db.fold([accession, symbol, name, fn, sub].filter(Boolean).join(' ')));
        if (gene) linked++;
        upserted++;
      } catch (err) {
        errors++;
        if (errors <= 5) recordLog(conn, jobId, 'uniprot', 'error', `${accession}: ${err.message}`);
      }
    }
    conn.exec('COMMIT');
    db.setMeta(conn, 'uniprot_proteins', conn.prepare('SELECT COUNT(*) AS c FROM proteins').get().c);
    finishJob(conn, jobId, 'uniprot', 'success', { seen, upserted, skipped: seen - upserted, errors },
      `UniProt: ${upserted.toLocaleString('vi-VN')} protein người, ${linked.toLocaleString('vi-VN')} liên kết gene`);
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
    recordLog(conn, jobId, 'uniprot', 'error', err.message);
    finishJob(conn, jobId, 'uniprot', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };
if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('UniProt xong')).catch(err => { console.error(err); process.exit(1); });
}
