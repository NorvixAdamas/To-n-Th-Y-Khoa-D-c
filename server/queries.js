'use strict';
/** Data access layer for the public API. All medical text comes from ingested sources. */
const dbm = require('./db');
const { fold } = dbm;

const db = dbm.open();

function one(sql, ...params) { return db.prepare(sql).get(...params) || null; }
function all(sql, ...params) { return db.prepare(sql).all(...params); }
function run(sql, ...params) { return db.prepare(sql).run(...params); }

/* ------------------------------------------------------------------ */
/* Sources & stats                                                     */
/* ------------------------------------------------------------------ */

const COUNT_TABLES = [
  ['diseases', 'diseases'], ['symptoms', 'symptoms'], ['drugs', 'drugs'],
  ['anatomy', 'anatomy'], ['laboratory_tests', 'labs'], ['microorganisms', 'organisms'],
  ['genes', 'genes'], ['medical_articles', 'articles'], ['clinical_trials', 'trials'],
  ['icd_codes', 'icdCodes'], ['pathways', 'pathways'], ['proteins', 'proteins'], ['gene_aliases', 'geneAliases']
];

function counts() {
  const out = {};
  for (const [table, key] of COUNT_TABLES) {
    try { out[key] = one(`SELECT COUNT(*) AS c FROM ${table}`).c; } catch { out[key] = 0; }
  }
  out.diseaseSymptoms = one('SELECT COUNT(*) AS c FROM disease_symptoms').c;
  out.diseaseGenes = one('SELECT COUNT(*) AS c FROM disease_genes').c;
  out.organismDiseases = one('SELECT COUNT(*) AS c FROM microorganism_diseases').c;
  out.synonyms = one('SELECT COUNT(*) AS c FROM disease_synonyms').c;
  out.identifiers = one('SELECT COUNT(*) AS c FROM disease_identifiers').c;
  out.translations = one('SELECT COUNT(*) AS c FROM translations').c;
  out.importJobs = one('SELECT COUNT(*) AS c FROM data_import_jobs').c;
  return out;
}

function sources() {
  const rows = all(`SELECT * FROM sources ORDER BY name`);
  const countsBySource = {};
  for (const r of rows) countsBySource[r.slug] = 0;
  const tally = (sql, slug) => { for (const r of all(sql)) countsBySource[r.source_slug] = (countsBySource[r.source_slug] || 0) + r.c; };
  tally('SELECT source_slug, COUNT(*) c FROM diseases GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM symptoms GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM drugs GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM anatomy GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM laboratory_tests GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM microorganisms GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM genes GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM disease_identifiers WHERE source_slug IS NOT NULL GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM icd_codes GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM pathways GROUP BY source_slug');
  tally('SELECT source_slug, COUNT(*) c FROM proteins GROUP BY source_slug');
  return rows.map(r => ({ ...r, record_count: countsBySource[r.slug] || 0 }));
}

function stats() {
  const c = counts();
  const categories = all(`SELECT c.*, COUNT(d.id) AS disease_count FROM categories c
    LEFT JOIN diseases d ON d.category_id = c.id GROUP BY c.id ORDER BY c.sort_order`);
  const last = one(`SELECT last_success_at AS at FROM sources WHERE last_success_at IS NOT NULL ORDER BY last_success_at DESC LIMIT 1`);
  const rare = one('SELECT COUNT(*) AS c FROM diseases WHERE is_rare = 1').c;
  const linkedDiseases = one('SELECT COUNT(DISTINCT disease_id) AS c FROM disease_symptoms').c;
  const translated = one('SELECT COUNT(*) AS c FROM diseases WHERE name_vi IS NOT NULL').c;
  return {
    counts: c, categories, rare, linkedDiseases, translated,
    lastSync: last ? last.at : null,
    coverage: {
      symptomCoverage: c.diseases ? Math.round((linkedDiseases / c.diseases) * 1000) / 10 : 0,
      vietnameseCoverage: c.diseases ? Math.round((translated / c.diseases) * 1000) / 10 : 0
    },
    sources: sources(),
    disclaimer: 'Nền tảng chỉ phục vụ mục đích giáo dục và thông tin. Không thay thế tư vấn, chẩn đoán hoặc điều trị y khoa chuyên nghiệp.'
  };
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const ENTITY_META = {
  disease: { label: 'Bệnh học', route: '#/diseases/' },
  symptom: { label: 'Triệu chứng', route: '#/symptoms/' },
  drug: { label: 'Thuốc', route: '#/drugs/' },
  anatomy: { label: 'Giải phẫu', route: '#/anatomy/' },
  organism: { label: 'Vi sinh', route: '#/organisms/' },
  lab: { label: 'Xét nghiệm', route: '#/labs/' },
  gene: { label: 'Gene', route: '#/genes/' },
  trial: { label: 'Thử nghiệm', route: '#/trials/' }
};

function escapeFts(token) {
  return token.replace(/["*]/g, '');
}

function ftsQuery(q) {
  const tokens = fold(q).split(' ').filter(t => t.length > 0);
  if (!tokens.length) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${escapeFts(t)}*` : escapeFts(t))).join(' ');
}

function hydrate(type, ids) {
  if (!ids.length) return new Map();
  const marks = ids.map(() => '?').join(',');
  const map = new Map();
  const grab = (sql) => { for (const r of all(sql, ...ids)) map.set(r.id, r); };
  switch (type) {
    case 'disease':
      grab(`SELECT d.id, d.slug, d.name_en, d.name_vi, d.mondo_id, d.orphanet_code, d.icd10,
              d.definition, d.is_rare, c.name_vi AS category_vi, c.slug AS category_slug
            FROM diseases d LEFT JOIN categories c ON c.id=d.category_id WHERE d.id IN (${marks})`);
      break;
    case 'symptom':
      grab(`SELECT id, slug, hpo_id, name_en, name_vi, organ_system, definition FROM symptoms WHERE id IN (${marks})`);
      break;
    case 'drug':
      grab(`SELECT id, slug, product_ndc, brand_name, generic_name, active_ingredients, dosage_form, route, labeler FROM drugs WHERE id IN (${marks})`);
      break;
    case 'anatomy':
      grab(`SELECT id, slug, uberon_id, name_en, definition, systems FROM anatomy WHERE id IN (${marks})`);
      break;
    case 'organism':
      grab(`SELECT id, slug, taxid, name_scientific, name_common, rank, kingdom, lineage FROM microorganisms WHERE id IN (${marks})`);
      break;
    case 'lab':
      grab(`SELECT id, slug, name_en, purpose, reference_note FROM laboratory_tests WHERE id IN (${marks})`);
      break;
    case 'gene':
      grab(`SELECT id, slug, symbol, name, chromosome, location, ncbi_gene_id, gene_type, aliases FROM genes WHERE id IN (${marks})`);
      break;
    case 'trial':
      grab(`SELECT id, nct_id, title, status, conditions, phases, sponsor FROM clinical_trials WHERE id IN (${marks})`);
      break;
    default: break;
  }
  return map;
}

function shapeHit(type, row) {
  const meta = ENTITY_META[type] || { label: type, route: '#' };
  const common = { type, typeLabel: meta.label, url: meta.route };
  if (!row) return null;
  switch (type) {
    case 'disease':
      return {
        ...common, id: row.id, slug: row.slug, title: row.name_en,
        titleVi: row.name_vi, subtitle: [row.category_vi, row.mondo_id].filter(Boolean).join(' · '),
        snippet: row.definition ? row.definition.slice(0, 220) : null,
        codes: [row.mondo_id, row.orphanet_code && `ORPHA:${row.orphanet_code}`, row.icd10 && `ICD-10:${row.icd10}`].filter(Boolean),
        badge: row.is_rare ? 'Bệnh hiếm' : null
      };
    case 'symptom':
      return { ...common, id: row.id, slug: row.slug, title: row.name_en, titleVi: row.name_vi, subtitle: [row.organ_system, row.hpo_id].filter(Boolean).join(' · '), snippet: row.definition ? row.definition.slice(0, 220) : null, codes: [row.hpo_id].filter(Boolean) };
    case 'drug':
      return { ...common, id: row.id, slug: row.slug, title: row.brand_name || row.generic_name, titleVi: row.generic_name, subtitle: [row.dosage_form, row.labeler].filter(Boolean).join(' · '), snippet: row.active_ingredients ? `Hoạt chất: ${row.active_ingredients}` : null, codes: [row.product_ndc && `NDC ${row.product_ndc}`].filter(Boolean) };
    case 'anatomy':
      return { ...common, id: row.id, slug: row.slug, title: row.name_en, subtitle: [row.systems, row.uberon_id].filter(Boolean).join(' · '), snippet: row.definition ? row.definition.slice(0, 220) : null, codes: [row.uberon_id].filter(Boolean) };
    case 'organism':
      return { ...common, id: row.id, slug: row.slug, title: row.name_scientific, titleVi: row.name_common, subtitle: [row.rank, row.kingdom].filter(Boolean).join(' · '), snippet: row.lineage ? row.lineage.slice(0, 220) : null, codes: [row.taxid && `TaxID ${row.taxid}`].filter(Boolean) };
    case 'lab':
      return { ...common, id: row.id, slug: row.slug, title: row.name_en, subtitle: 'Xét nghiệm y khoa', snippet: row.purpose ? row.purpose.slice(0, 220) : null, codes: [] };
    case 'gene':
      return { ...common, id: row.id, slug: row.slug, title: row.symbol, titleVi: row.name, subtitle: [row.chromosome && `NST ${row.chromosome}`, row.location, row.gene_type].filter(Boolean).join(' · '), snippet: row.aliases ? `Alias: ${row.aliases}` : null, codes: [row.ncbi_gene_id && `NCBI Gene ${row.ncbi_gene_id}`].filter(Boolean) };
    case 'trial':
      return { ...common, id: row.id, slug: row.nct_id, title: row.title, subtitle: [row.nct_id, row.status, row.phases].filter(Boolean).join(' · '), snippet: row.conditions, codes: [row.nct_id].filter(Boolean) };
    default:
      return { ...common, id: row.id, title: row.name_en || row.title, subtitle: '', snippet: null, codes: [] };
  }
}

function search({ q, type, page = 1, pageSize = 20, fuzzy = true }) {
  const query = ftsQuery(q);
  const offset = (Math.max(1, page) - 1) * pageSize;
  if (!query) return { query: q, total: 0, page, pageSize, results: [], suggestions: [], mode: 'empty' };
  const typeFilter = type && ENTITY_META[type] ? type : null;
  let rows = [];
  let mode = 'exact';
  try {
    const sql = `SELECT sd.entity_type, sd.entity_id, bm25(search_index, 8.0, 4.0, 1.0) AS score
      FROM search_index JOIN search_docs sd ON sd.doc_rowid = search_index.rowid
      WHERE search_index MATCH ? ${typeFilter ? 'AND sd.entity_type = ?' : ''}
      ORDER BY score LIMIT ? OFFSET ?`;
    rows = typeFilter ? all(sql, query, typeFilter, pageSize, offset) : all(sql, query, pageSize, offset);
  } catch (err) {
    rows = [];
  }
  if (!rows.length && fuzzy) {
    const norm = fold(q);
    if (norm.length >= 3) {
      try {
        const sql = `SELECT sd.entity_type, sd.entity_id, 0 AS score
          FROM search_fuzzy JOIN search_fuzzy_docs sd ON sd.doc_rowid = search_fuzzy.rowid
          WHERE search_fuzzy MATCH ? ${typeFilter ? 'AND sd.entity_type = ?' : ''} LIMIT ? OFFSET ?`;
        rows = typeFilter ? all(sql, `"${norm.replace(/"/g, '')}"`, typeFilter, pageSize, offset) : all(sql, `"${norm.replace(/"/g, '')}"`, pageSize, offset);
        if (rows.length) mode = 'fuzzy';
      } catch { rows = []; }
    }
  }
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.entity_type)) grouped.set(r.entity_type, []);
    grouped.get(r.entity_type).push(r.entity_id);
  }
  const maps = new Map();
  for (const [t, ids] of grouped) maps.set(t, hydrate(t, ids));
  const results = rows.map(r => shapeHit(r.entity_type, maps.get(r.entity_type).get(r.entity_id))).filter(Boolean);

  let total = results.length;
  try {
    const countSql = `SELECT COUNT(*) AS c FROM search_index JOIN search_docs sd ON sd.doc_rowid = search_index.rowid
      WHERE search_index MATCH ? ${typeFilter ? 'AND sd.entity_type = ?' : ''}`;
    total = typeFilter ? one(countSql, query, typeFilter).c : one(countSql, query).c;
    if (mode === 'fuzzy') total = results.length;
  } catch { /* keep results length */ }

  return { query: q, total, page, pageSize, results, mode, types: Object.fromEntries([...grouped].map(([k, v]) => [k, v.length])) };
}

function suggest(q, limit = 8) {
  const norm = fold(q);
  if (!norm) return [];
  const tokens = norm.split(' ');
  const last = tokens.pop();
  const prefix = [...tokens, `${last}*`].join(' ');
  const rows = [];
  try {
    for (const r of all(`SELECT sd.entity_type, sd.entity_id FROM search_index JOIN search_docs sd ON sd.doc_rowid=search_index.rowid
      WHERE search_index MATCH ? ORDER BY rank LIMIT ?`, prefix, limit)) rows.push(r);
  } catch { /* ignore */ }
  if (rows.length < limit && norm.length >= 3) {
    try {
      for (const r of all(`SELECT sd.entity_type, sd.entity_id FROM search_fuzzy JOIN search_fuzzy_docs sd ON sd.doc_rowid=search_fuzzy.rowid
        WHERE search_fuzzy MATCH ? LIMIT ?`, `"${norm}"`, limit)) {
        if (!rows.find(x => x.entity_type === r.entity_type && x.entity_id === r.entity_id)) rows.push(r);
      }
    } catch { /* ignore */ }
  }
  const out = [];
  for (const r of rows.slice(0, limit)) {
    const hit = shapeHit(r.entity_type, hydrate(r.entity_type, [r.entity_id]).get(r.entity_id));
    if (hit) out.push({ title: hit.title, subtitle: hit.subtitle, type: hit.type, typeLabel: hit.typeLabel, url: hit.url + hit.slug });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Diseases                                                            */
/* ------------------------------------------------------------------ */

function listDiseases({ q, category, rare, page = 1, pageSize = 24, sort = 'name' }) {
  const where = [];
  const params = [];
  if (category) { where.push('c.slug = ?'); params.push(category); }
  if (rare === '1' || rare === true) where.push('d.is_rare = 1');
  const offset = (Math.max(1, page) - 1) * pageSize;
  let join = '';
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = 'JOIN search_docs sd ON sd.entity_id = d.id AND sd.entity_type = \'disease\' JOIN search_index si ON si.rowid = sd.doc_rowid';
      where.push('search_index MATCH ?');
      params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = sort === 'recent' ? 'ORDER BY d.updated_at DESC, d.name_en' : sort === 'symptoms' ? 'ORDER BY symptom_count DESC, d.name_en' : 'ORDER BY d.name_en';
  const rows = all(`SELECT d.id, d.slug, d.name_en, d.name_vi, d.mondo_id, d.orphanet_code, d.icd10, d.is_rare,
      c.name_vi AS category_vi, c.slug AS category_slug,
      (SELECT COUNT(*) FROM disease_symptoms ds WHERE ds.disease_id=d.id) AS symptom_count,
      substr(COALESCE(d.definition,''),1,240) AS excerpt
    FROM diseases d LEFT JOIN categories c ON c.id=d.category_id ${join} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM diseases d LEFT JOIN categories c ON c.id=d.category_id ${join} ${whereSql}`, ...params).c;
  return { total, page, pageSize, results: rows };
}

function getDisease(slug) {
  const d = one(`SELECT d.*, c.name_vi AS category_vi, c.name_en AS category_en, c.slug AS category_slug
    FROM diseases d LEFT JOIN categories c ON c.id=d.category_id WHERE d.slug = ? OR d.mondo_id = ? OR d.orphanet_code = ? LIMIT 1`, slug, slug, slug);
  if (!d) return null;
  const identifiers = all('SELECT scheme, value, source_slug FROM disease_identifiers WHERE disease_id = ? ORDER BY scheme', d.id);
  const synonyms = all('SELECT name, lang, scope, source_slug FROM disease_synonyms WHERE disease_id = ? ORDER BY scope, name LIMIT 80', d.id);
  const symptoms = all(`SELECT s.id, s.slug, s.hpo_id, s.name_en, s.name_vi, s.organ_system,
      ds.frequency_text, ds.frequency_ratio, ds.onset, ds.evidence, ds.source_slug
    FROM disease_symptoms ds JOIN symptoms s ON s.id = ds.symptom_id
    WHERE ds.disease_id = ? ORDER BY COALESCE(ds.frequency_ratio, -1) DESC, s.name_en LIMIT 120`, d.id);
  const genes = all(`SELECT g.symbol, g.name, g.chromosome, g.location, g.ncbi_gene_id, dg.association_type, g.slug
    FROM disease_genes dg JOIN genes g ON g.id=dg.gene_id WHERE dg.disease_id=? ORDER BY g.symbol`, d.id);
  const organisms = all(`SELECT m.slug, m.name_scientific, m.name_common, m.rank, m.taxid, m.kingdom
    FROM microorganism_diseases md JOIN microorganisms m ON m.id=md.microorganism_id WHERE md.disease_id=? LIMIT 20`, d.id);
  const parents = all(`SELECT p.id, p.slug, p.name_en, p.mondo_id FROM disease_parents dp JOIN diseases p ON p.id=dp.parent_id WHERE dp.disease_id=? LIMIT 12`, d.id);
  const children = all(`SELECT ch.id, ch.slug, ch.name_en, ch.mondo_id FROM disease_parents dp JOIN diseases ch ON ch.id=dp.disease_id WHERE dp.parent_id=? LIMIT 12`, d.id);
  const related = all(`SELECT DISTINCT r.id, r.slug, r.name_en, r.orphanet_code, COUNT(*) AS shared
    FROM disease_symptoms a JOIN disease_symptoms b ON b.symptom_id=a.symptom_id AND b.disease_id!=a.disease_id
    JOIN diseases r ON r.id=b.disease_id WHERE a.disease_id=? GROUP BY r.id ORDER BY shared DESC LIMIT 8`, d.id);
  return { ...d, identifiers, synonyms, symptoms, genes, organisms, parents, children, related, sources: sourcesForDisease(d) };
}

function sourcesForDisease(d) {
  const list = [];
  if (d.mondo_id) list.push({ slug: 'mondo', label: 'MONDO Disease Ontology', url: `https://monarchinitiative.org/${d.mondo_id}`, license: 'CC BY 4.0' });
  if (d.orphanet_code) list.push({ slug: 'orphadata', label: 'Orphanet / Orphadata', url: `https://www.orpha.net/en/disease/detail/${d.orphanet_code}`, license: 'CC BY 4.0' });
  const symptomSources = all(`SELECT DISTINCT ds.source_slug FROM disease_symptoms ds WHERE ds.disease_id=?`, d.id).map(r => r.source_slug);
  if (symptomSources.includes('hpo')) list.push({ slug: 'hpo', label: 'Human Phenotype Ontology', url: 'https://hpo.jax.org/', license: 'CC BY 4.0' });
  if (symptomSources.includes('orphadata')) list.push({ slug: 'orphadata_phenotypes', label: 'Orphadata phenotypes', url: 'https://www.orphadata.com/', license: 'CC BY 4.0' });
  if (d.doid) list.push({ slug: 'doid', label: 'Human Disease Ontology (DOID)', url: `https://disease-ontology.org/term/DOID:${d.doid}/`, license: 'CC0 1.0' });
  if (d.icd10) list.push({ slug: 'icd10cm', label: 'ICD-10-CM (CMS)', url: 'https://www.cms.gov/medicare/coding-billing/icd-10-codes', license: 'Public domain' });
  if (all('SELECT 1 AS x FROM disease_genes WHERE disease_id=? LIMIT 1', d.id).length) list.push({ slug: 'orphadata', label: 'Orphanet gene-disease associations', url: 'https://www.orpha.net/', license: 'CC BY 4.0' });
  return list;
}

/* ------------------------------------------------------------------ */
/* Symptoms                                                            */
/* ------------------------------------------------------------------ */

function listSymptoms({ q, system, page = 1, pageSize = 30 }) {
  const where = [];
  const params = [];
  if (system) { where.push('s.organ_system = ?'); params.push(system); }
  let join = '';
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = "JOIN search_docs sd ON sd.entity_id=s.id AND sd.entity_type='symptom' JOIN search_index si ON si.rowid=sd.doc_rowid";
      where.push('search_index MATCH ?'); params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT s.id, s.slug, s.hpo_id, s.name_en, s.name_vi, s.organ_system, s.definition,
      (SELECT COUNT(*) FROM disease_symptoms ds WHERE ds.symptom_id=s.id) AS disease_count
    FROM symptoms s ${join} ${whereSql} ORDER BY disease_count DESC, s.name_en LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM symptoms s ${join} ${whereSql}`, ...params).c;
  const systems = all(`SELECT organ_system AS name, COUNT(*) AS c FROM symptoms WHERE organ_system IS NOT NULL GROUP BY organ_system ORDER BY c DESC LIMIT 40`);
  return { total, page, pageSize, results: rows, systems };
}

function getSymptom(slug) {
  const s = one('SELECT * FROM symptoms WHERE slug=? OR hpo_id=? LIMIT 1', slug, slug);
  if (!s) return null;
  const diseases = all(`SELECT d.id, d.slug, d.name_en, d.name_vi, d.orphanet_code, d.is_rare,
      ds.frequency_text, ds.evidence, ds.source_slug, c.name_vi AS category_vi
    FROM disease_symptoms ds JOIN diseases d ON d.id=ds.disease_id LEFT JOIN categories c ON c.id=d.category_id
    WHERE ds.symptom_id=? ORDER BY COALESCE(ds.frequency_ratio,-1) DESC, d.name_en LIMIT 100`, s.id);
  const cooccurring = all(`SELECT s2.id, s2.slug, s2.name_en, s2.name_vi, s2.hpo_id, s2.organ_system, COUNT(*) AS shared
    FROM disease_symptoms a JOIN disease_symptoms b ON b.disease_id=a.disease_id AND b.symptom_id!=a.symptom_id
    JOIN symptoms s2 ON s2.id=b.symptom_id WHERE a.symptom_id=? GROUP BY s2.id ORDER BY shared DESC LIMIT 16`, s.id);
  return { ...s, diseases, cooccurring, sources: [{ label: s.source_slug === 'orphadata' ? 'Orphanet / Orphadata' : 'Human Phenotype Ontology (HPO)', url: s.source_url, license: 'CC BY 4.0' }] };
}

/* ------------------------------------------------------------------ */
/* Anatomy                                                             */
/* ------------------------------------------------------------------ */

function listAnatomy({ q, system, page = 1, pageSize = 30 }) {
  const where = [];
  const params = [];
  if (system) { where.push('systems = ?'); params.push(system); }
  let join = '';
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = "JOIN search_docs sd ON sd.entity_id=anatomy.id AND sd.entity_type='anatomy' JOIN search_index si ON si.rowid=sd.doc_rowid";
      where.push('search_index MATCH ?'); params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT anatomy.id, anatomy.slug, anatomy.uberon_id, anatomy.name_en, anatomy.systems,
      substr(COALESCE(anatomy.definition,''),1,240) AS excerpt
    FROM anatomy ${join} ${whereSql} ORDER BY anatomy.name_en LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM anatomy ${join} ${whereSql}`, ...params).c;
  const systems = all(`SELECT systems AS name, COUNT(*) AS c FROM anatomy WHERE systems IS NOT NULL GROUP BY systems ORDER BY c DESC LIMIT 30`);
  return { total, page, pageSize, results: rows, systems };
}

function getAnatomy(slug) {
  const a = one('SELECT * FROM anatomy WHERE slug=? OR uberon_id=? LIMIT 1', slug, slug);
  if (!a) return null;
  const children = all('SELECT slug, name_en, uberon_id FROM anatomy WHERE parent_uberon=? LIMIT 40', a.uberon_id);
  const parent = a.parent_uberon ? one('SELECT slug, name_en, uberon_id FROM anatomy WHERE uberon_id=?', a.parent_uberon) : null;
  return { ...a, children, parent, sources: [{ label: 'Uberon Anatomy Ontology', url: `https://www.ebi.ac.uk/ols4/ontologies/uberon`, license: 'CC BY 3.0' }] };
}

/* ------------------------------------------------------------------ */
/* Drugs                                                               */
/* ------------------------------------------------------------------ */

function listDrugs({ q, ingredient, form, labeler, page = 1, pageSize = 24 }) {
  const where = [];
  const params = [];
  if (ingredient) { where.push('active_ingredients LIKE ?'); params.push(`%${ingredient}%`); }
  if (form) { where.push('dosage_form = ?'); params.push(form); }
  if (labeler) { where.push('labeler = ?'); params.push(labeler); }
  let join = '';
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = "JOIN search_docs sd ON sd.entity_id=drugs.id AND sd.entity_type='drug' JOIN search_index si ON si.rowid=sd.doc_rowid";
      where.push('search_index MATCH ?'); params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT drugs.id, drugs.slug, drugs.product_ndc, drugs.brand_name, drugs.generic_name,
      drugs.active_ingredients, drugs.dosage_form, drugs.route, drugs.labeler, drugs.marketing_category
    FROM drugs ${join} ${whereSql} ORDER BY COALESCE(brand_name, generic_name) LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM drugs ${join} ${whereSql}`, ...params).c;
  const forms = all(`SELECT dosage_form AS name, COUNT(*) AS c FROM drugs WHERE dosage_form IS NOT NULL GROUP BY dosage_form ORDER BY c DESC LIMIT 25`);
  const labelers = all(`SELECT labeler AS name, COUNT(*) AS c FROM drugs WHERE labeler IS NOT NULL GROUP BY labeler ORDER BY c DESC LIMIT 25`);
  return { total, page, pageSize, results: rows, forms, labelers };
}

function getDrug(slug) {
  const d = one('SELECT * FROM drugs WHERE slug=? OR product_ndc=? LIMIT 1', slug, slug);
  if (!d) return null;
  const label = one('SELECT * FROM drug_labels WHERE drug_id=?', d.id);
  const alternatives = d.generic_name
    ? all(`SELECT slug, brand_name, product_ndc, dosage_form, labeler FROM drugs WHERE generic_name=? AND id!=? LIMIT 8`, d.generic_name, d.id)
    : [];
  return { ...d, label, alternatives, sources: [
    { label: 'openFDA NDC Directory', url: d.source_url, license: 'Public domain' },
    { label: 'DailyMed (nhãn thuốc, khi có)', url: 'https://dailymed.nlm.nih.gov/', license: 'Public domain' }
  ] };
}

/* ------------------------------------------------------------------ */
/* Labs, organisms, genes                                              */
/* ------------------------------------------------------------------ */

function listLabs({ q, page = 1, pageSize = 30 }) {
  let join = '';
  const where = [];
  const params = [];
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = "JOIN search_docs sd ON sd.entity_id=laboratory_tests.id AND sd.entity_type='lab' JOIN search_index si ON si.rowid=sd.doc_rowid";
      where.push('search_index MATCH ?'); params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT laboratory_tests.id, laboratory_tests.slug, laboratory_tests.name_en, laboratory_tests.name_vi,
      substr(COALESCE(laboratory_tests.purpose,''),1,260) AS excerpt, laboratory_tests.source_url
    FROM laboratory_tests ${join} ${whereSql} ORDER BY name_en LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM laboratory_tests ${join} ${whereSql}`, ...params).c;
  return { total, page, pageSize, results: rows };
}

function getLab(slug) {
  const l = one('SELECT * FROM laboratory_tests WHERE slug=? LIMIT 1', slug);
  if (!l) return null;
  return { ...l, sources: [{ label: 'MedlinePlus — U.S. National Library of Medicine', url: l.source_url, license: 'Public domain' }] };
}

function listOrganisms({ q, kingdom, page = 1, pageSize = 30 }) {
  const where = [];
  const params = [];
  if (kingdom) { where.push('kingdom = ?'); params.push(kingdom); }
  let join = '';
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = "JOIN search_docs sd ON sd.entity_id=microorganisms.id AND sd.entity_type='organism' JOIN search_index si ON si.rowid=sd.doc_rowid";
      where.push('search_index MATCH ?'); params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT microorganisms.id, microorganisms.slug, microorganisms.taxid, microorganisms.name_scientific,
      microorganisms.name_common, microorganisms.rank, microorganisms.kingdom,
      (SELECT COUNT(*) FROM microorganism_diseases md WHERE md.microorganism_id=microorganisms.id) AS disease_count
    FROM microorganisms ${join} ${whereSql} ORDER BY name_scientific LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM microorganisms ${join} ${whereSql}`, ...params).c;
  const kingdoms = all(`SELECT kingdom AS name, COUNT(*) AS c FROM microorganisms WHERE kingdom IS NOT NULL GROUP BY kingdom ORDER BY c DESC`);
  return { total, page, pageSize, results: rows, kingdoms };
}

function getOrganism(slug) {
  const m = one('SELECT * FROM microorganisms WHERE slug=? OR taxid=? LIMIT 1', slug, slug);
  if (!m) return null;
  const diseases = all(`SELECT d.slug, d.name_en, d.name_vi, d.orphanet_code, md.source_slug
    FROM microorganism_diseases md JOIN diseases d ON d.id=md.disease_id WHERE md.microorganism_id=? ORDER BY d.name_en LIMIT 60`, m.id);
  return { ...m, diseases, sources: [{ label: 'NCBI Taxonomy', url: m.source_url, license: 'Public domain' }, { label: 'MONDO (liên kết tác nhân)', url: 'https://monde.monarchinitiative.org/', license: 'CC BY 4.0' }] };
}

function listGenes({ q, page = 1, pageSize = 30 }) {
  let join = '';
  const where = [];
  const params = [];
  if (q && fold(q).length > 1) {
    const fq = ftsQuery(q);
    if (fq) {
      join = "JOIN search_docs sd ON sd.entity_id=genes.id AND sd.entity_type='gene' JOIN search_index si ON si.rowid=sd.doc_rowid";
      where.push('search_index MATCH ?'); params.push(fq);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT genes.id, genes.slug, genes.symbol, genes.name, genes.chromosome, genes.location,
      genes.ncbi_gene_id, genes.gene_type, genes.source_slug,
      (SELECT COUNT(*) FROM disease_genes dg WHERE dg.gene_id=genes.id) AS disease_count
    FROM genes ${join} ${whereSql} ORDER BY symbol LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM genes ${join} ${whereSql}`, ...params).c;
  return { total, page, pageSize, results: rows };
}

function getGene(slug) {
  const g = one('SELECT * FROM genes WHERE slug=? OR symbol=? OR ncbi_gene_id=? LIMIT 1', slug, slug, slug);
  if (!g) return null;
  const diseases = all(`SELECT d.slug, d.name_en, d.name_vi, d.orphanet_code, dg.association_type
    FROM disease_genes dg JOIN diseases d ON d.id=dg.disease_id WHERE dg.gene_id=? ORDER BY d.name_en LIMIT 60`, g.id);
  const aliases = all('SELECT alias FROM gene_aliases WHERE gene_id=? ORDER BY alias LIMIT 120', g.id).map(r => r.alias);
  const pathways = all(`SELECT p.reactome_id, p.name, p.url, gp.evidence
    FROM gene_pathways gp JOIN pathways p ON p.id=gp.pathway_id WHERE gp.gene_id=? ORDER BY p.name LIMIT 80`, g.id);
  const proteins = all(`SELECT uniprot_id, name, length, function, subcellular, url
    FROM proteins WHERE gene_id=? ORDER BY uniprot_id LIMIT 20`, g.id);
  const sources = [{ label: 'Orphanet gene-disease associations', url: 'https://www.orpha.net/', license: 'CC BY 4.0' }];
  if (g.ncbi_gene_id) sources.push({ label: 'NCBI Gene', url: g.source_url || `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}`, license: 'Public domain' });
  if (pathways.length) sources.push({ label: 'Reactome pathways', url: 'https://reactome.org/', license: 'CC0 1.0' });
  if (proteins.length) sources.push({ label: 'UniProt reviewed proteins', url: 'https://www.uniprot.org/', license: 'CC BY 4.0' });
  return { ...g, diseases, aliases, pathways, proteins, sources };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

function listCodes({ q = '', chapter = '', page = 1, pageSize = 50 }) {
  const where = [];
  const params = [];
  if (chapter) { where.push('chapter = ?'); params.push(chapter); }
  if (q && q.trim()) { where.push('(code LIKE ? OR title LIKE ?)'); params.push(`${q.trim()}%`, `%${q.trim()}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = all(`SELECT code, title, chapter FROM icd_codes ${whereSql} ORDER BY code LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = one(`SELECT COUNT(*) AS c FROM icd_codes ${whereSql}`, ...params).c;
  const chapters = all('SELECT chapter, COUNT(*) AS c FROM icd_codes GROUP BY chapter ORDER BY chapter');
  return { total, page, pageSize, results: rows, chapters };
}

function jobs(limit = 30) {
  return all('SELECT * FROM data_import_jobs ORDER BY id DESC LIMIT ?', limit);
}

function logs(limit = 80, jobId) {
  return jobId
    ? all('SELECT * FROM data_update_logs WHERE job_id=? ORDER BY id DESC LIMIT ?', jobId, limit)
    : all('SELECT * FROM data_update_logs ORDER BY id DESC LIMIT ?', limit);
}

function quality() {
  const dupes = all(`SELECT lower(name_en) AS name, COUNT(*) AS c FROM diseases GROUP BY lower(name_en) HAVING c > 1 ORDER BY c DESC LIMIT 20`);
  const missingDefinition = one("SELECT COUNT(*) AS c FROM diseases WHERE definition IS NULL OR definition = ''").c;
  const missingSymptoms = one('SELECT COUNT(*) AS c FROM diseases WHERE id NOT IN (SELECT disease_id FROM disease_symptoms)').c;
  const missingCategory = one("SELECT COUNT(*) AS c FROM diseases d JOIN categories c ON c.id=d.category_id WHERE c.slug='other'").c;
  const orphanSymptoms = one('SELECT COUNT(*) AS c FROM symptoms WHERE id NOT IN (SELECT symptom_id FROM disease_symptoms)').c;
  const duplicateIdentifiers = all(`SELECT scheme, value, COUNT(DISTINCT disease_id) AS c FROM disease_identifiers
    GROUP BY scheme, value HAVING c > 1 ORDER BY c DESC LIMIT 20`);
  return {
    duplicateNames: dupes, missingDefinition, missingSymptoms, unclassified: missingCategory,
    orphanSymptoms, duplicateIdentifiers,
    totalDiseases: one('SELECT COUNT(*) AS c FROM diseases').c
  };
}

module.exports = {
  db, one, all, run, stats, sources, counts, search, suggest, ENTITY_META,
  listDiseases, getDisease, listSymptoms, getSymptom, listAnatomy, getAnatomy,
  listDrugs, getDrug, listLabs, getLab, listOrganisms, getOrganism, listGenes, getGene, listCodes,
  jobs, logs, quality, fold
};
