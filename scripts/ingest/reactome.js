'use strict';
/**
 * Reactome pathways and gene-pathway links (CC0).
 * Requires NCBI Gene IDs from the ncbi-gene ingestion step.
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { download, startJob, finishJob, recordLog } = require('./lib');

const PATHWAYS = 'https://reactome.org/download/current/ReactomePathways.txt';
const MAPPINGS = 'https://reactome.org/download/current/NCBI2Reactome_All_Levels.txt';

async function run({ force = false } = {}) {
  const conn = db.open();
  db.init(conn);
  const jobId = startJob(conn, 'reactome', 'Tải Reactome pathways');
  try {
    const [pathFile, mapFile] = await Promise.all([
      download(PATHWAYS, 'reactome_pathways.txt', { force, maxAgeHours: 168, label: 'Reactome pathways' }),
      download(MAPPINGS, 'reactome_ncbi2reactome.txt', { force, maxAgeHours: 168, label: 'Reactome mappings' })
    ]);

    const upsertPathway = conn.prepare(`INSERT INTO pathways (reactome_id, name, species, url, source_slug, search_text)
      VALUES (?, ?, ?, ?, 'reactome', ?)
      ON CONFLICT(reactome_id) DO UPDATE SET name=excluded.name, species=excluded.species,
        url=excluded.url, search_text=excluded.search_text`);
    const getPathway = conn.prepare('SELECT id FROM pathways WHERE reactome_id=?');
    let pathways = 0;
    for (const line of fs.readFileSync(pathFile.file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [id, name, species] = line.split('\t');
      if (!id || !name || !/^Homo sapiens$/i.test((species || '').trim())) continue;
      upsertPathway.run(id.trim(), name.trim(), 'Homo sapiens', `https://reactome.org/content/detail/${id.trim()}`,
        db.fold(`${id} ${name}`));
      pathways++;
    }

    const findGene = conn.prepare('SELECT id FROM genes WHERE ncbi_gene_id=? LIMIT 1');
    const insLink = conn.prepare(`INSERT OR IGNORE INTO gene_pathways (gene_id, pathway_id, evidence, source_slug)
      VALUES (?, ?, ?, 'reactome')`);
    let mappings = 0, linked = 0, unmatched = 0;
    conn.exec('BEGIN');
    for (const line of fs.readFileSync(mapFile.file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 6) continue;
      const [geneId, pathwayId, , , evidence, species] = cols;
      if (!/^Homo sapiens$/i.test((species || '').trim())) continue;
      mappings++;
      const gene = findGene.get(String(geneId).trim());
      const pathway = getPathway.get(String(pathwayId).trim());
      if (!gene || !pathway) { unmatched++; continue; }
      insLink.run(gene.id, pathway.id, evidence || null);
      linked++;
    }
    conn.exec('COMMIT');
    db.setMeta(conn, 'reactome_pathways', pathways);
    db.setMeta(conn, 'reactome_links', linked);
    finishJob(conn, jobId, 'reactome', 'success', { seen: mappings, upserted: linked, skipped: unmatched, errors: 0 },
      `Reactome: ${pathways.toLocaleString('vi-VN')} pathway người, ${linked.toLocaleString('vi-VN')} liên kết gene–pathway`);
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
    recordLog(conn, jobId, 'reactome', 'error', err.message);
    finishJob(conn, jobId, 'reactome', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };
if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('Reactome xong')).catch(err => { console.error(err); process.exit(1); });
}
