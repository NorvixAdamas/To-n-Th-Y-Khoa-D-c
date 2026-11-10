'use strict';
/**
 * MONDO Disease Ontology ingestion.
 * Source: https://purl.obolibrary.org/obo/mondo.obo (CC BY 4.0)
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../server/db');
const { download, parseObo, xrefValues, startJob, finishJob, recordLog } = require('./lib');

const CATEGORY_LABELS = {
  // label (exactly as used by MONDO) -> category slug. Resolved at runtime, never hardcoded IDs.
  'infectious disease': 'infectious',
  'disease by infectious agent': 'infectious',
  'bacterial infectious disease': 'bacterial',
  'viral infectious disease': 'viral',
  'fungal infectious disease': 'fungal',
  'parasitic infectious disease': 'parasitic',
  'cardiovascular disorder': 'cardiovascular',
  'cardiovascular disease': 'cardiovascular',
  'nervous system disorder': 'nervous',
  'nervous system disease': 'nervous',
  'psychiatric disorder': 'mental',
  'mental disorder': 'mental',
  'respiratory system disease': 'respiratory',
  'respiratory disease': 'respiratory',
  'respiratory system disorder': 'respiratory',
  'lower respiratory tract disorder': 'respiratory',
  'digestive system disease': 'digestive',
  'digestive system disorder': 'digestive',
  'mouth disorder': 'digestive',
  'endocrine system disease': 'endocrine',
  'endocrine system disorder': 'endocrine',
  'metabolic disease': 'endocrine',
  'immune system disease': 'immune',
  'immune system disorder': 'immune',
  'autoimmune disease': 'autoimmune',
  'skin disease': 'skin',
  'skin disorder': 'skin',
  'integumentary system disorder': 'skin',
  'musculoskeletal system disease': 'musculoskeletal',
  'musculoskeletal disorder': 'musculoskeletal',
  'musculoskeletal system disorder': 'musculoskeletal',
  'skeletal muscle disorder': 'musculoskeletal',
  'connective tissue disorder': 'musculoskeletal',
  'female reproductive system disease': 'female_reproductive',
  'female reproductive disorder': 'female_reproductive',
  'female reproductive system disorder': 'female_reproductive',
  'male reproductive system disease': 'male_reproductive',
  'male reproductive disorder': 'male_reproductive',
  'male reproductive system disorder': 'male_reproductive',
  'eye disease': 'eye',
  'eye disorder': 'eye',
  'disorder of visual system': 'eye',
  'inherited retinal dystrophy': 'eye',
  'otolaryngologic disease': 'ent',
  'ear disease': 'ent',
  'auditory system disorder': 'ent',
  'urinary system disease': 'urinary',
  'urinary system disorder': 'urinary',
  'renal disease': 'urinary',
  'hematologic disease': 'hematologic',
  'hematological disease': 'hematologic',
  'hematologic disorder': 'hematologic',
  'hereditary disease': 'genetic',
  'genetic disease': 'genetic',
  'inherited disease susceptibility': 'genetic',
  'cancer': 'cancer',
  'cancer or benign tumor': 'cancer',
  'neoplasm': 'cancer',
  'syndromic disease': 'syndrome',
  'developmental defect during embryogenesis': 'pediatric',
  'disease': 'other'
};

const ID_SCHEMES = ['ICD10CM', 'ICD10', 'ICD10WHO', 'ICD9', 'DOID', 'ORPHANET', 'UMLS', 'OMIM', 'MESH', 'SCTID', 'NCIT', 'GARD', 'EFO', 'MEDGEN', 'ICD11'];

function normalizeScheme(scheme) {
  const map = {
    ICD10CM: 'icd10', ICD10: 'icd10', ICD10WHO: 'icd10', ICD9: 'icd9', DOID: 'doid', ORPHANET: 'orphanet',
    UMLS: 'umls', OMIM: 'omim', MESH: 'mesh', SCTID: 'snomed', NCIT: 'ncit', GARD: 'gard', EFO: 'efo',
    MEDGEN: 'medgen', ICD11: 'icd11'
  };
  return map[scheme] || scheme.toLowerCase();
}

function stripCurie(id) {
  return id.includes(':') ? id.split(':')[1] : id;
}

async function run({ force = false } = {}) {
  const jobId = startJob(db.open(), 'mondo', 'Tải MONDO ontology');
  const conn = db.open();
  try {
    const { file, size, cached } = await download('https://purl.obolibrary.org/obo/mondo.obo', 'mondo.obo', { force, maxAgeHours: 48, label: 'MONDO' });
    recordLog(conn, jobId, 'mondo', 'info', `Tệp MONDO ${(size / 1048576).toFixed(1)} MB (${cached ? 'cache' : 'tải mới'})`);
    const text = fs.readFileSync(file, 'utf8');
    const terms = parseObo(text).filter(t => t.id && t.name && !t.obsolete);
    recordLog(conn, jobId, 'mondo', 'info', `Đọc ${terms.length} thuật ngữ bệnh không lỗi thời`);

    const byId = new Map(terms.map(t => [t.id, t]));
    const idByLabel = new Map();
    for (const t of terms) if (!idByLabel.has(t.name.toLowerCase())) idByLabel.set(t.name.toLowerCase(), t.id);

    const categoryByMondoId = new Map();
    for (const [label, slug] of Object.entries(CATEGORY_LABELS)) {
      const mondoId = idByLabel.get(label);
      if (mondoId) categoryByMondoId.set(mondoId, slug);
    }
    recordLog(conn, jobId, 'mondo', 'info', `Ánh xạ ${categoryByMondoId.size} nhánh phân loại MONDO`);

    const catIds = new Map(conn.prepare('SELECT slug, id FROM categories').all().map(r => [r.slug, r.id]));

    const ANIMAL_NAME = /,\s*(dog|cat|mouse|rat|cattle|pig|horse|sheep|goat|rabbit|guinea pig|hamster|chicken|zebrafish|fish|frog|monkey|primate|fly|worm|nematode|drosophila|yeast|mink|ferret|llama|alpaca|camel|deer|fox|wolf|bird|duck|turkey)\b/i;
    function isHumanDisease(term) {
      if (!term.id.startsWith('MONDO:')) return false;
      if (ANIMAL_NAME.test(term.name) || /non-human animal/i.test(term.name)) return false;
      const inTaxon = (term.properties || []).filter(p => p.startsWith('in_taxon NCBITaxon:'));
      if (inTaxon.length && !inTaxon.some(p => p.includes('NCBITaxon:9606'))) return false;
      const seen = new Set();
      let frontier = [...(term.isA || [])];
      while (frontier.length) {
        const next = [];
        for (const id of frontier) {
          if (seen.has(id)) continue;
          seen.add(id);
          if (id === 'MONDO:0005583') return false;
          const node = byId.get(id);
          if (!node) continue;
          if (ANIMAL_NAME.test(node.name) || /non-human animal/i.test(node.name)) return false;
          next.push(...node.isA);
        }
        frontier = next;
      }
      return true;
    }

    function resolveCategory(term) {
      const seen = new Set();
      let frontier = [term.id];
      let depth = 0;
      while (frontier.length && depth < 25) {
        const next = [];
        for (const id of frontier) {
          if (seen.has(id)) continue;
          seen.add(id);
          if (categoryByMondoId.has(id)) return categoryByMondoId.get(id);
          const node = byId.get(id);
          if (node) next.push(...node.isA);
        }
        frontier = next;
        depth++;
      }
      return 'other';
    }

    const upsert = conn.prepare(`
      INSERT INTO diseases (slug, name_en, definition, definition_source, category_id, mondo_id, orphanet_code,
        doid, icd10, icd11, umls, omim, mesh, snomed, ncit, gard, source_slug, source_url, retrieved_at, updated_at, verification, is_rare, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mondo', ?, ?, ?, 'source_verified', ?, ?)
      ON CONFLICT(mondo_id) DO UPDATE SET
        name_en=excluded.name_en, definition=excluded.definition, definition_source=excluded.definition_source,
        category_id=excluded.category_id, orphanet_code=excluded.orphanet_code, doid=excluded.doid, icd10=excluded.icd10,
        icd11=excluded.icd11, umls=excluded.umls, omim=excluded.omim, mesh=excluded.mesh, snomed=excluded.snomed,
        ncit=excluded.ncit, gard=excluded.gard, retrieved_at=excluded.retrieved_at, updated_at=excluded.updated_at,
        is_rare=excluded.is_rare, search_text=excluded.search_text
    `);
    const getId = conn.prepare('SELECT id FROM diseases WHERE mondo_id = ?');
    const insIdent = conn.prepare('INSERT OR IGNORE INTO disease_identifiers (disease_id, scheme, value, source_slug) VALUES (?, ?, ?, ?)');
    const insSyn = conn.prepare('INSERT OR IGNORE INTO disease_synonyms (disease_id, name, lang, scope, source_slug) VALUES (?, ?, ?, ?, ?)');
    const insParent = conn.prepare('INSERT OR IGNORE INTO disease_parents (disease_id, parent_id) VALUES (?, ?)');

    const now = new Date().toISOString();
    let seen = 0, upserted = 0, skipped = 0, errors = 0;
    const idMap = new Map();

    const nonHumanIds = [];
    conn.exec('BEGIN');
    for (const term of terms) {
      seen++;
      try {
        if (!isHumanDisease(term)) { nonHumanIds.push(term.id); skipped++; continue; }
        const xrefs = xrefValues(term, ID_SCHEMES);
        const get = s => (xrefs.get(s) || [])[0] || null;
        const orphanet = get('ORPHANET');
        const category = resolveCategory(term);
        const slug = db.slugify(term.name, stripCurie(term.id));
        const fetchedMondoId = term.id;

        upsert.run(
          slug, term.name, term.def || null, term.def ? `MONDO (${term.defXrefs || 'định nghĩa nguồn'})` : null,
          catIds.get(category) || catIds.get('other'), fetchedMondoId,
          orphanet, get('DOID'), get('ICD10CM') || get('ICD10'), get('ICD11'),
          get('UMLS'), get('OMIM'), get('MESH'), get('SCTID'), get('NCIT'), get('GARD'),
          `https://monarchinitiative.org/${fetchedMondoId}`, now, now,
          orphanet ? 1 : 0,
          db.fold([term.name, term.def, (term.synonyms || []).map(s => s.name).join(' ')].filter(Boolean).join(' '))
        );
        const row = getId.get(fetchedMondoId);
        if (!row) { skipped++; continue; }
        idMap.set(fetchedMondoId, row.id);
        upserted++;

        for (const [scheme, values] of xrefs) {
          for (const value of values) insIdent.run(row.id, normalizeScheme(scheme), value, 'mondo');
        }
        for (const syn of (term.synonyms || []).slice(0, 40)) {
          if (!syn.name || syn.name.length > 400) continue;
          insSyn.run(row.id, syn.name, syn.lang || 'en', syn.scope, 'mondo');
        }
        for (const parentMondo of term.isA) {
          const parent = idMap.get(parentMondo);
          if (parent) insParent.run(row.id, parent);
        }
        if (orphanet) {
          conn.prepare("INSERT OR IGNORE INTO disease_identifiers (disease_id, scheme, value, source_slug) VALUES (?, 'orphanet', ?, 'mondo')").run(row.id, orphanet);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) recordLog(conn, jobId, 'mondo', 'error', `${term.id}: ${err.message}`);
      }
    }
    conn.exec('COMMIT');

    // Second pass for parent links that were created before their parent row existed.
    conn.exec('BEGIN');
    for (const term of terms) {
      const child = idMap.get(term.id);
      if (!child) continue;
      for (const parentMondo of term.isA) {
        const parent = idMap.get(parentMondo);
        if (parent) insParent.run(child, parent);
      }
    }
    conn.exec('COMMIT');

    // Remove diseases that belong to the non-human animal branch but were imported earlier.
    if (nonHumanIds.length) {
      conn.exec('BEGIN');
      const del = conn.prepare('DELETE FROM diseases WHERE mondo_id = ?');
      for (const id of nonHumanIds) del.run(id);
      conn.exec('COMMIT');
      recordLog(conn, jobId, 'mondo', 'info', `Đã loại ${nonHumanIds.length} bệnh của động vật không phải người`);
    }

    // Extract infectious agents from MONDO logical definitions (disease_has_infectious_agent).
    const agents = new Map();
    for (const term of terms) {
      const diseaseId = idMap.get(term.id);
      if (!diseaseId) continue;
      for (const inter of term.intersections) {
        const taxMatch = inter.match(/disease_has_infectious_agent NCBITaxon:(\d+)/);
        if (taxMatch) {
          const taxid = Number(taxMatch[1]);
          if (!agents.has(taxid)) agents.set(taxid, new Set());
          agents.get(taxid).add(diseaseId);
        }
      }
    }
    const agentFile = path.join(__dirname, '..', '..', 'data', 'cache', 'mondo-agents.json');
    fs.writeFileSync(agentFile, JSON.stringify([...agents].map(([taxid, ids]) => ({ taxid, diseases: [...ids] }))));
    recordLog(conn, jobId, 'mondo', 'info', `Trích xuất ${agents.size} tác nhân gây bệnh từ logical definition`);

    db.setMeta(conn, 'mondo_retrieved_at', now);
    db.setMeta(conn, 'mondo_term_count', upserted);
    db.setMeta(conn, 'mondo_agent_file', agentFile);
    finishJob(conn, jobId, 'mondo', 'success', { seen, upserted, skipped, errors },
      `Đã nhập ${upserted} bệnh từ MONDO`);
  } catch (err) {
    recordLog(conn, jobId, 'mondo', 'error', err.message);
    finishJob(conn, jobId, 'mondo', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('MONDO xong')).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
