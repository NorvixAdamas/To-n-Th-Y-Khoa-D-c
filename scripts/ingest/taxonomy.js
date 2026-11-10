'use strict';
/**
 * NCBI Taxonomy ingestion for the pathogens referenced by MONDO logical definitions
 * (relationship: disease_has_infectious_agent NCBITaxon:...). Public domain (NCBI).
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../server/db');
const { httpGet, startJob, finishJob, recordLog, pool, sleep, CACHE_DIR } = require('./lib');

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const KINGDOMS = ['Bacteria', 'Viruses', 'Fungi', 'Protozoa', 'Metazoa', 'Archaea'];

function kingdomOf(lineage) {
  if (!lineage) return null;
  const parts = lineage.split(';').map(s => s.trim());
  for (const k of KINGDOMS) if (parts.includes(k)) return k === 'Metazoa' ? 'Metazoa (động vật)' : k;
  if (parts.some(p => /Viruses|viroid/i.test(p))) return 'Viruses';
  return null;
}

async function run() {
  const conn = db.open();
  const jobId = startJob(conn, 'ncbi_taxonomy', 'Lấy phân loại tác nhân gây bệnh');
  try {
    const agentFile = path.join(CACHE_DIR, 'mondo-agents.json');
    if (!fs.existsSync(agentFile)) throw new Error('Chưa có mondo-agents.json — hãy chạy ingest MONDO trước.');
    const agents = JSON.parse(fs.readFileSync(agentFile, 'utf8'));
    const taxids = agents.map(a => a.taxid);
    recordLog(conn, jobId, 'ncbi_taxonomy', 'info', `Có ${taxids.length} taxon từ MONDO`);

    const upsert = conn.prepare(`
      INSERT INTO microorganisms (slug, taxid, name_scientific, name_common, rank, lineage, kingdom, source_slug, source_url, retrieved_at, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ncbi_taxonomy', ?, ?, ?)
      ON CONFLICT(taxid) DO UPDATE SET name_scientific=excluded.name_scientific, name_common=excluded.name_common,
        rank=excluded.rank, lineage=excluded.lineage, kingdom=excluded.kingdom, search_text=excluded.search_text
    `);
    const getMicro = conn.prepare('SELECT id FROM microorganisms WHERE taxid = ?');
    const diseaseExists = conn.prepare('SELECT 1 AS x FROM diseases WHERE id = ?');
    const link = conn.prepare('INSERT OR IGNORE INTO microorganism_diseases (microorganism_id, disease_id, source_slug) VALUES (?, ?, ?)');

    const batches = [];
    for (let i = 0; i < taxids.length; i += 150) batches.push(taxids.slice(i, i + 150));
    let upserted = 0, links = 0, errors = 0;
    const now = new Date().toISOString();
    const diseaseByMondo = new Map();

    await pool(batches, 2, async (batch) => {
      try {
        const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=taxonomy&retmode=xml&id=${batch.join(',')}`;
        const xml = await httpGet(url, { retries: 4, label: 'NCBI taxonomy' });
        const taxa = new Map();
        for (const m of xml.matchAll(/<Taxon>([\s\S]*?)<\/Taxon>/g)) {
          const block = m[1];
          const taxid = (block.match(/<TaxId>(\d+)<\/TaxId>/) || [])[1];
          if (!taxid) continue;
          taxa.set(taxid, {
            scientificname: decodeXml((block.match(/<ScientificName>([\s\S]*?)<\/ScientificName>/) || [])[1] || ''),
            commonname: decodeXml((block.match(/<CommonName>([\s\S]*?)<\/CommonName>/) || [])[1] || ''),
            rank: decodeXml((block.match(/<Rank>([\s\S]*?)<\/Rank>/) || [])[1] || ''),
            lineage: decodeXml((block.match(/<Lineage>([\s\S]*?)<\/Lineage>/) || [])[1] || '')
          });
        }
        conn.exec('BEGIN');
        for (const taxid of batch) {
          const t = taxa.get(String(taxid));
          if (!t || !t.scientificname) { errors++; continue; }
          upsert.run(
            db.slugify(t.scientificname, taxid), Number(taxid), t.scientificname,
            t.commonname || null, t.rank || null,
            t.lineage || null, kingdomOf(t.lineage),
            `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${taxid}`, now,
            db.fold([t.scientificname, t.commonname, t.lineage].filter(Boolean).join(' '))
          );
          const m = getMicro.get(Number(taxid));
          if (m) upserted++;
        }
        conn.exec('COMMIT');
      } catch (err) {
        errors++;
        recordLog(conn, jobId, 'ncbi_taxonomy', 'error', err.message);
      }
      await sleep(400);
    });

    // Link taxa to diseases through MONDO ids captured during MONDO ingestion.
    conn.exec('BEGIN');
    for (const agent of agents) {
      const m = getMicro.get(Number(agent.taxid));
      if (!m) continue;
      for (const diseaseId of agent.diseases) {
        // agent.diseases holds internal disease ids from the MONDO import;
        // ids removed by the human-disease filter no longer exist.
        if (!diseaseExists.get(diseaseId)) continue;
        link.run(m.id, diseaseId, 'mondo');
        links++;
      }
    }
    conn.exec('COMMIT');

    db.setMeta(conn, 'microorganism_count', upserted);
    db.setMeta(conn, 'microorganism_retrieved_at', new Date().toISOString());
    finishJob(conn, jobId, 'ncbi_taxonomy', 'success', { seen: taxids.length, upserted, skipped: taxids.length - upserted, errors },
      `Đã nhập ${upserted} tác nhân gây bệnh, ${links} liên kết tác nhân–bệnh`);
    void diseaseByMondo;
  } catch (err) {
    recordLog(conn, jobId, 'ncbi_taxonomy', 'error', err.message);
    finishJob(conn, jobId, 'ncbi_taxonomy', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => console.log('Taxonomy xong')).catch(err => { console.error(err); process.exit(1); });
}
