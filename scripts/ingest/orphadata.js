'use strict';
/**
 * Orphanet / Orphadata ingestion (CC BY 4.0).
 * Files: en_product1 (disorders), en_product4 (HPO phenotypes), en_product6 (genes),
 *        en_product3 (inheritance), en_product9_prev (prevalence) when available.
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { download, httpGet, startJob, finishJob, recordLog } = require('./lib');

const BASE = 'https://www.orphadata.com/data/xml/';

function clean(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function first(block, re) {
  const m = block.match(re);
  return m ? clean(m[1]) : null;
}

function all(block, re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return [...block.matchAll(new RegExp(re.source, flags))].map(m => clean(m[1]));
}

/** Stream a large XML file, yielding '<Disorder ...>...</Disorder>' blocks. */
async function forEachDisorder(file, callback) {
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let buf = '';
  let count = 0;
  for await (const chunk of stream) {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('<Disorder ')) >= 0) {
      const end = buf.indexOf('</Disorder>', idx);
      if (end < 0) { buf = buf.slice(idx); break; }
      const block = buf.slice(idx, end + '</Disorder>'.length);
      buf = buf.slice(end + '</Disorder>'.length);
      count++;
      callback(block, count);
    }
    if (buf.length > 2_000_000) buf = buf.slice(-2000);
  }
  return count;
}

function frequencyToText(name) {
  if (!name) return null;
  const m = name.match(/\((\d+)\s*-\s*(\d+)%\)/);
  if (m) return `${name}`;
  return name;
}

async function run({ force = false } = {}) {
  const conn = db.open();
  const jobId = startJob(conn, 'orphadata', 'Tải Orphadata');
  try {
    const product1 = await download(`${BASE}en_product1.xml`, 'orphadata_product1.xml', { force, maxAgeHours: 168, label: 'Orphadata product1' });
    recordLog(conn, jobId, 'orphadata', 'info', `en_product1 ${(product1.size / 1048576).toFixed(1)} MB`);

    const upsert = conn.prepare(`
      INSERT INTO diseases (slug, name_en, definition, definition_source, category_id, orphanet_code,
        icd10, umls, omim, source_slug, source_url, retrieved_at, updated_at, verification, is_rare, search_text)
      VALUES (?, ?, ?, ?, (SELECT id FROM categories WHERE slug='rare'), ?, ?, NULL, NULL, 'orphadata', ?, ?, ?, 'source_verified', 1, ?)
      ON CONFLICT(orphanet_code) DO UPDATE SET
        name_en=COALESCE(diseases.name_en, excluded.name_en),
        definition=COALESCE(diseases.definition, excluded.definition),
        icd10=COALESCE(diseases.icd10, excluded.icd10),
        updated_at=excluded.updated_at, is_rare=1,
        search_text=excluded.search_text
    `);
    const getDisease = conn.prepare('SELECT id, name_en FROM diseases WHERE orphanet_code = ?');
    const insSyn = conn.prepare('INSERT OR IGNORE INTO disease_synonyms (disease_id, name, lang, scope, source_slug) VALUES (?, ?, ?, ?, ?)');
    const insIdent = conn.prepare('INSERT OR IGNORE INTO disease_identifiers (disease_id, scheme, value, source_slug) VALUES (?, ?, ?, ?)');
    const insCatMap = conn.prepare('SELECT id FROM categories WHERE slug = ?');

    let seen = 0, upserted = 0;
    const now = new Date().toISOString();
    conn.exec('BEGIN');
    seen = await forEachDisorder(product1.file, (block) => {
      const code = first(block, /<OrphaCode>(\d+)<\/OrphaCode>/);
      const name = first(block, /<Name lang="en">(.*?)<\/Name>/);
      if (!code || !name) return;
      const definition = all(block, /<Definition lang="en">(.*?)<\/Definition>/).join(' ');
      const synonyms = all(block, /<Synonym lang="en">(.*?)<\/Synonym>/).filter(s => s && s !== name).slice(0, 40);
      const expert = first(block, /<ExpertLink lang="en">(.*?)<\/ExpertLink>/);
      const group = first(block, /<DisorderGroup[^>]*>\s*<Name lang="en">(.*?)<\/Name>/);
      const refs = [...block.matchAll(/<Source>(.*?)<\/Source>\s*<Reference>(.*?)<\/Reference>/g)]
        .map(m => ({ source: clean(m[1]), ref: clean(m[2]) }));
      const icd10 = refs.find(r => /^ICD-10$/i.test(r.source));
      const omim = refs.find(r => /OMIM/i.test(r.source));

      upsert.run(
        db.slugify(name, 'orphanet' + code), name, definition || null,
        definition ? 'Orphanet — Orphadata (CC BY 4.0)' : null,
        code, icd10 ? icd10.ref : null, expert || `${BASE}en_product1.xml`, now, now,
        db.fold([name, definition, synonyms.join(' '), group].filter(Boolean).join(' '))
      );
      const row = getDisease.get(code);
      if (!row) return;
      upserted++;
      for (const syn of synonyms) insSyn.run(row.id, syn, 'en', 'exact', 'orphadata');
      if (icd10) insIdent.run(row.id, 'icd10', icd10.ref, 'orphadata');
      if (omim) insIdent.run(row.id, 'omim', omim.ref, 'orphadata');
      insIdent.run(row.id, 'orphanet', code, 'orphadata');
      void insCatMap;
    });
    conn.exec('COMMIT');
    recordLog(conn, jobId, 'orphadata', 'info', `Đã nhập ${upserted}/${seen} bệnh hiếm từ Orphanet`);

    // ---- Phenotypes (en_product4) ----
    const symptomByHpo = conn.prepare('SELECT id FROM symptoms WHERE hpo_id = ?');
    const insSymptom = conn.prepare(`INSERT INTO symptoms (slug, hpo_id, name_en, source_slug, source_url, search_text)
      VALUES (?, ?, ?, 'orphadata', ?, ?) ON CONFLICT(hpo_id) DO NOTHING`);
    const link = conn.prepare(`INSERT INTO disease_symptoms (disease_id, symptom_id, frequency_text, evidence, source_slug)
      VALUES (?, ?, ?, ?, 'orphadata')
      ON CONFLICT(disease_id, symptom_id) DO UPDATE SET frequency_text=COALESCE(excluded.frequency_text, disease_symptoms.frequency_text)`);

    let phenotypeLinks = 0;
    try {
      if (process.env.SKIP_ORPHA_PHENO) {
        recordLog(conn, jobId, 'orphadata', 'info', 'Bỏ qua en_product4 theo cấu hình SKIP_ORPHA_PHENO');
        throw Object.assign(new Error('skip'), { skip: true });
      }
      const product4 = await download(`${BASE}en_product4.xml`, 'orphadata_product4.xml', { force, maxAgeHours: 168, label: 'Orphadata product4' });
      recordLog(conn, jobId, 'orphadata', 'info', `en_product4 ${(product4.size / 1048576).toFixed(1)} MB`);
      let disorderCount = 0;
      conn.exec('BEGIN');
      disorderCount = await forEachDisorder(product4.file, (block) => {
        const code = first(block, /<OrphaCode>(\d+)<\/OrphaCode>/);
        if (!code) return;
        const row = getDisease.get(code);
        if (!row) return;
        for (const m of block.matchAll(/<HPODisorderAssociation [^>]*>(.*?)<\/HPODisorderAssociation>/gs)) {
          const assoc = m[1];
          const hpoId = first(assoc, /<HPOId>(HP:\d+)<\/HPOId>/);
          const term = first(assoc, /<HPOTerm>(.*?)<\/HPOTerm>/);
          const freq = first(assoc, /<HPOFrequency[^>]*>\s*<Name lang="en">(.*?)<\/Name>/);
          if (!hpoId || !term) continue;
          let sym = symptomByHpo.get(hpoId);
          if (!sym) {
            insSymptom.run(db.slugify(term, hpoId.replace(':', '')), hpoId, term, `https://hpo.jax.org/browse/term/${hpoId}`, db.fold(term));
            sym = symptomByHpo.get(hpoId);
          }
          if (sym) {
            link.run(row.id, sym.id, frequencyToText(freq), 'Orphanet clinical phenotype annotation');
            phenotypeLinks++;
          }
        }
      });
      conn.exec('COMMIT');
      recordLog(conn, jobId, 'orphadata', 'info', `Kiểu hình: ${phenotypeLinks} liên kết từ ${disorderCount} bệnh Orphanet`);
    } catch (err) {
      if (!err.skip) {
        try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
        recordLog(conn, jobId, 'orphadata', 'error', `Bỏ qua en_product4: ${err.message}`);
      }
    }

    // ---- Genes (en_product6) ----
    let geneLinks = 0;
    try {
      const product6 = await download(`${BASE}en_product6.xml`, 'orphadata_product6.xml', { force, maxAgeHours: 168, label: 'Orphadata product6' });
      recordLog(conn, jobId, 'orphadata', 'info', `en_product6 ${(product6.size / 1048576).toFixed(1)} MB`);
      const upsertGene = conn.prepare(`
        INSERT INTO genes (slug, symbol, name, gene_id, source_slug, source_url, retrieved_at, search_text)
        VALUES (?, ?, ?, ?, 'orphadata', ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET name=COALESCE(excluded.name, genes.name), search_text=excluded.search_text
      `);
      const getGene = conn.prepare('SELECT id FROM genes WHERE symbol = ?');
      const linkGene = conn.prepare(`INSERT OR IGNORE INTO disease_genes (disease_id, gene_id, association_type, source_slug) VALUES (?, ?, ?, 'orphadata')`);
      const nowIso = new Date().toISOString();
      conn.exec('BEGIN');
      await forEachDisorder(product6.file, (block) => {
        const code = first(block, /<OrphaCode>(\d+)<\/OrphaCode>/);
        if (!code) return;
        const row = getDisease.get(code);
        if (!row) return;
        for (const g of block.matchAll(/<DisorderGeneAssociation>(.*?)<\/DisorderGeneAssociation>/gs)) {
          const assoc = g[1];
          const symbol = first(assoc, /<Symbol>(.*?)<\/Symbol>/);
          if (!symbol) continue;
          const geneName = first(assoc, /<Gene id="\d+">\s*<Name lang="en">(.*?)<\/Name>/);
          const hgnc = first(assoc, /<Source>HGNC<\/Source>\s*<Reference>(.*?)<\/Reference>/);
          const validation = first(assoc, /<SourceOfValidation>(.*?)<\/SourceOfValidation>/);
          upsertGene.run(db.slugify(symbol, symbol), symbol, geneName, hgnc || null,
            `https://www.orpha.net/en/disease/gene/${encodeURIComponent(symbol)}`, nowIso,
            db.fold([symbol, geneName].filter(Boolean).join(' ')));
          const gRow = getGene.get(symbol);
          if (gRow) {
            linkGene.run(row.id, gRow.id, validation ? `Orphanet · ${validation}` : 'Orphanet gene-disease association');
            geneLinks++;
          }
        }
      });
      conn.exec('COMMIT');
      recordLog(conn, jobId, 'orphadata', 'info', `Gene: ${geneLinks} liên kết gen–bệnh`);
    } catch (err) {
      try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
      recordLog(conn, jobId, 'orphadata', 'error', `Bỏ qua en_product6: ${err.message}`);
    }

    // ---- Inheritance (en_product3) ----
    let inheritanceCount = 0;
    try {
      const product3 = await download(`${BASE}en_product3.xml`, 'orphadata_product3.xml', { force, maxAgeHours: 168, label: 'Orphadata product3' });
      const setInheritance = conn.prepare(`UPDATE diseases SET inheritance = ? WHERE id = ? AND (inheritance IS NULL OR inheritance = '')`);
      conn.exec('BEGIN');
      await forEachDisorder(product3.file, (block) => {
        const code = first(block, /<OrphaCode>(\d+)<\/OrphaCode>/);
        if (!code) return;
        const row = getDisease.get(code);
        if (!row) return;
        const modes = all(block, /<Name lang="en">([^<]*(?:inheritance|inherited|Dominant|Recessive|X-linked|Mitochondrial|Genetic anticipation|Multigenic|Sporadic)[^<]*)<\/Name>/i);
        if (modes.length) { setInheritance.run([...new Set(modes)].join(' | '), row.id); inheritanceCount++; }
      });
      conn.exec('COMMIT');
      recordLog(conn, jobId, 'orphadata', 'info', `Di truyền: cập nhật ${inheritanceCount} bệnh`);
    } catch (err) {
      try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
      recordLog(conn, jobId, 'orphadata', 'error', `Bỏ qua en_product3: ${err.message}`);
    }

    // ---- Prevalence (en_product9_prev) ----
    let prevalenceCount = 0;
    try {
      const product9 = await download(`${BASE}en_product9_prev.xml`, 'orphadata_product9.xml', { force, maxAgeHours: 168, label: 'Orphadata product9' });
      const setPrev = conn.prepare(`UPDATE diseases SET prevalence = ? WHERE id = ?`);
      conn.exec('BEGIN');
      await forEachDisorder(product9.file, (block) => {
        const code = first(block, /<OrphaCode>(\d+)<\/OrphaCode>/);
        if (!code) return;
        const row = getDisease.get(code);
        if (!row) return;
        const entries = [];
        for (const m of block.matchAll(/<Prevalence [^>]*>(.*?)<\/Prevalence>/gs)) {
          const p = m[1];
          const cls = first(p, /<PrevalenceClass[^>]*>\s*<Name lang="en">(.*?)<\/Name>/);
          const geo = first(p, /<PrevalenceGeographicArea[^>]*>\s*<Name lang="en">(.*?)<\/Name>/);
          const type = first(p, /<PrevalenceType[^>]*>\s*<Name lang="en">(.*?)<\/Name>/);
          const val = first(p, /<ValMoy>(.*?)<\/ValMoy>/);
          if (cls || val) entries.push([cls, type, geo, val ? `${val} (trung bình)` : null].filter(Boolean).join(' · '));
        }
        if (entries.length) { setPrev.run([...new Set(entries)].join(' ; '), row.id); prevalenceCount++; }
      });
      conn.exec('COMMIT');
      recordLog(conn, jobId, 'orphadata', 'info', `Dịch tễ: cập nhật ${prevalenceCount} bệnh`);
    } catch (err) {
      try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
      recordLog(conn, jobId, 'orphadata', 'error', `Bỏ qua en_product9_prev: ${err.message}`);
    }

    db.setMeta(conn, 'orphadata_retrieved_at', new Date().toISOString());
    db.setMeta(conn, 'orphadata_gene_links', geneLinks);
    finishJob(conn, jobId, 'orphadata', 'success',
      { seen, upserted, skipped: seen - upserted, errors: 0 },
      `Orphanet: ${upserted} bệnh, ${phenotypeLinks} liên kết kiểu hình, ${geneLinks} liên kết gene`);
  } catch (err) {
    recordLog(conn, jobId, 'orphadata', 'error', err.message);
    finishJob(conn, jobId, 'orphadata', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

void httpGet;
module.exports = { run };

if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('Orphadata xong')).catch(err => { console.error(err); process.exit(1); });
}
