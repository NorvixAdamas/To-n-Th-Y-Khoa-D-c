'use strict';
/**
 * NCBI Gene ingestion — full Homo sapiens gene_info (public domain).
 * Adds GeneID, official symbol, full name, chromosome, location, aliases and xrefs.
 * Existing Orphanet gene rows are enriched rather than duplicated.
 */
const fs = require('node:fs');
const zlib = require('node:zlib');
const db = require('../../server/db');
const { download, startJob, finishJob, recordLog } = require('./lib');

const URL = 'https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz';

function clean(value) {
  const v = String(value || '').trim();
  return !v || v === '-' ? null : v;
}

async function run({ force = false } = {}) {
  const conn = db.open();
  db.init(conn);
  const jobId = startJob(conn, 'ncbi_gene', 'Tải NCBI Gene Homo sapiens');
  try {
    const file = await download(URL, 'ncbi_gene_info.gz', { force, maxAgeHours: 168, label: 'NCBI Gene' });
    const text = zlib.gunzipSync(fs.readFileSync(file.file)).toString('utf8');
    const lines = text.split(/\r?\n/);
    const header = lines.shift().replace(/^#/, '').split('\t');
    const col = Object.fromEntries(header.map((name, i) => [name, i]));

    const upsert = conn.prepare(`
      INSERT INTO genes (slug, symbol, name, chromosome, location, gene_id, summary, organism,
        source_slug, source_url, retrieved_at, search_text, ncbi_gene_id, gene_type, aliases, db_xrefs)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, 'Homo sapiens', 'ncbi_gene', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        name=COALESCE(genes.name, excluded.name),
        chromosome=COALESCE(genes.chromosome, excluded.chromosome),
        location=COALESCE(genes.location, excluded.location),
        ncbi_gene_id=excluded.ncbi_gene_id,
        gene_type=excluded.gene_type,
        aliases=excluded.aliases,
        db_xrefs=excluded.db_xrefs,
        source_url=excluded.source_url,
        retrieved_at=excluded.retrieved_at,
        search_text=excluded.search_text,
        source_slug=CASE WHEN genes.source_slug = 'orphadata' THEN genes.source_slug ELSE 'ncbi_gene' END
    `);
    const getGene = conn.prepare('SELECT id FROM genes WHERE symbol = ?');
    const insAlias = conn.prepare(`INSERT OR IGNORE INTO gene_aliases (gene_id, alias, source_slug)
      VALUES (?, ?, 'ncbi_gene')`);

    const now = new Date().toISOString();
    let seen = 0, upserted = 0, skipped = 0, errors = 0, aliasCount = 0;
    conn.exec('BEGIN');
    for (const line of lines) {
      if (!line) continue;
      const cols = line.split('\t');
      if (cols[col.tax_id] !== '9606') continue;
      seen++;
      try {
        const symbol = clean(cols[col.Symbol]);
        const geneId = clean(cols[col.GeneID]);
        if (!symbol || !geneId) { skipped++; continue; }
        const synonyms = clean(cols[col.Synonyms]);
        const description = clean(cols[col.description]);
        const fullName = clean(cols[col.Full_name_from_nomenclature_authority]);
        const aliases = [...new Set([synonyms?.split('|'), cols[col.Other_designations]?.split('|')]
          .flat().map(clean).filter(Boolean))].slice(0, 80);
        const xrefs = clean(cols[col.dbXrefs])?.split('|').filter(Boolean).slice(0, 80) || [];
        upsert.run(
          db.slugify(symbol, geneId), symbol, description || fullName || symbol,
          clean(cols[col.chromosome]), clean(cols[col.map_location]),
          `https://www.ncbi.nlm.nih.gov/gene/${geneId}`, now,
          db.fold([symbol, description, fullName, aliases.join(' '), xrefs.join(' ')].filter(Boolean).join(' ')),
          geneId, clean(cols[col.type_of_gene]), aliases.join(' | ') || null, xrefs.join(' | ') || null
        );
        const row = getGene.get(symbol);
        if (row) {
          for (const alias of aliases.slice(0, 50)) {
            insAlias.run(row.id, alias);
            aliasCount++;
          }
        }
        upserted++;
      } catch (err) {
        errors++;
        if (errors <= 8) recordLog(conn, jobId, 'ncbi_gene', 'error', `${cols[col.Symbol] || '?'}: ${err.message}`);
      }
    }
    conn.exec('COMMIT');
    db.setMeta(conn, 'ncbi_gene_count', conn.prepare('SELECT COUNT(*) AS c FROM genes').get().c);
    finishJob(conn, jobId, 'ncbi_gene', 'success', { seen, upserted, skipped, errors },
      `NCBI Gene: ${upserted.toLocaleString('vi-VN')} gene người, ${aliasCount.toLocaleString('vi-VN')} alias`);
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
    recordLog(conn, jobId, 'ncbi_gene', 'error', err.message);
    finishJob(conn, jobId, 'ncbi_gene', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };
if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('NCBI Gene xong')).catch(err => { console.error(err); process.exit(1); });
}
