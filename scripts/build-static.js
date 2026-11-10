'use strict';
/**
 * Build the read-only static edition.
 *
 * With data/medical.db present, it exports a fresh snapshot from SQLite.
 * Without the database (for example on Vercel), it copies the committed
 * static-snapshot/ folder. The public site never needs Node or SQLite.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SNAPSHOT = path.join(ROOT, 'static-snapshot');
const SNAPSHOT_DATA = path.join(SNAPSHOT, 'data');
const DB_PATH = process.env.MEDENC_DB || path.join(ROOT, 'data', 'medical.db');
const BUILD_AT = new Date().toISOString();

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function cleanDir(dir) { fs.rmSync(dir, { recursive: true, force: true }); ensureDir(dir); }
function copyDir(from, to) { fs.cpSync(from, to, { recursive: true }); }

function writeGz(dir, name, value) {
  const raw = JSON.stringify(value);
  const gz = zlib.gzipSync(Buffer.from(raw), { level: 9 });
  fs.writeFileSync(path.join(dir, `${name}.json.gz`), gz);
  console.log(`  ${name.padEnd(22)} ${String(value.rows?.length ?? value.length ?? '').padStart(8)} rows  ${(raw.length / 1048576).toFixed(1)} MB raw  ${(gz.length / 1048576).toFixed(1)} MB gzip`);
  return { raw: raw.length, gz: gz.length };
}

function copyFrontend() {
  cleanDir(DIST);
  copyDir(path.join(ROOT, 'js'), path.join(DIST, 'js'));
  copyDir(path.join(ROOT, 'css'), path.join(DIST, 'css'));
  const configPath = path.join(DIST, 'js', 'runtime-config.js');
  const config = fs.readFileSync(configPath, 'utf8')
    .replace('STATIC_MODE = false', 'STATIC_MODE = true')
    .replace("DATA_VERSION = 'dev'", `DATA_VERSION = '${BUILD_AT}'`);
  fs.writeFileSync(configPath, config);
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
  for (const name of ['robots.txt']) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(DIST, name));
  }
}

function useSnapshot() {
  if (!fs.existsSync(SNAPSHOT_DATA) || !fs.readdirSync(SNAPSHOT_DATA).length) {
    throw new Error('Không có data/medical.db và cũng chưa có static-snapshot/data. Hãy chạy build trên máy có database.');
  }
  copyFrontend();
  copyDir(SNAPSHOT_DATA, path.join(DIST, 'data'));
  console.log('Đã dùng static-snapshot/data (không có database local).');
}

function buildSnapshot() {
  const { DatabaseSync } = require('node:sqlite');
  const dbm = require('../server/db');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 15000');
  const fold = dbm.fold;
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params) || null;

  console.log('Đang xuất snapshot từ', DB_PATH);
  cleanDir(SNAPSHOT_DATA);
  let rawTotal = 0;
  let gzTotal = 0;
  const add = (name, value) => {
    const size = writeGz(SNAPSHOT_DATA, name, value);
    rawTotal += size.raw;
    gzTotal += size.gz;
  };

  const sources = all('SELECT * FROM sources ORDER BY name');
  const counts = {};
  for (const [table, key] of [
    ['diseases', 'diseases'], ['symptoms', 'symptoms'], ['drugs', 'drugs'], ['anatomy', 'anatomy'],
    ['laboratory_tests', 'labs'], ['microorganisms', 'organisms'], ['genes', 'genes'],
    ['medical_articles', 'articles'], ['clinical_trials', 'trials'], ['icd_codes', 'icdCodes'],
    ['pathways', 'pathways'], ['proteins', 'proteins'], ['gene_aliases', 'geneAliases'],
    ['disease_symptoms', 'diseaseSymptoms'], ['disease_genes', 'diseaseGenes'],
    ['microorganism_diseases', 'organismDiseases'], ['disease_synonyms', 'synonyms'],
    ['disease_identifiers', 'identifiers'], ['translations', 'translations'], ['data_import_jobs', 'importJobs']
  ]) {
    counts[key] = one(`SELECT COUNT(*) AS c FROM ${table}`).c;
  }
  const rare = one('SELECT COUNT(*) AS c FROM diseases WHERE is_rare = 1').c;
  const linkedDiseases = one('SELECT COUNT(DISTINCT disease_id) AS c FROM disease_symptoms').c;
  const translated = one('SELECT COUNT(*) AS c FROM diseases WHERE name_vi IS NOT NULL').c;
  const categories = all(`SELECT c.*, COUNT(d.id) AS disease_count FROM categories c
    LEFT JOIN diseases d ON d.category_id = c.id GROUP BY c.id ORDER BY c.sort_order`);
  const lastSync = one('SELECT last_success_at AS at FROM sources WHERE last_success_at IS NOT NULL ORDER BY last_success_at DESC LIMIT 1')?.at || null;
  const sourceCounts = Object.fromEntries(sources.map(s => [s.slug, 0]));
  for (const [table, slug] of [
    ['diseases', 'source_slug'], ['symptoms', 'source_slug'], ['drugs', 'source_slug'], ['anatomy', 'source_slug'],
    ['laboratory_tests', 'source_slug'], ['microorganisms', 'source_slug'], ['genes', 'source_slug'],
    ['disease_identifiers', 'source_slug'], ['icd_codes', 'source_slug'], ['pathways', 'source_slug'], ['proteins', 'source_slug']
  ]) {
    for (const r of all(`SELECT ${slug} AS s, COUNT(*) AS c FROM ${table} WHERE ${slug} IS NOT NULL GROUP BY ${slug}`)) {
      sourceCounts[r.s] = (sourceCounts[r.s] || 0) + r.c;
    }
  }
  const catalogue = {
    build: { mode: 'static', builtAt: BUILD_AT, dataAsOf: lastSync, database: path.basename(DB_PATH) },
    counts,
    categories,
    rare,
    linkedDiseases,
    translated,
    lastSync,
    coverage: {
      symptomCoverage: counts.diseases ? Math.round((linkedDiseases / counts.diseases) * 1000) / 10 : 0,
      vietnameseCoverage: counts.diseases ? Math.round((translated / counts.diseases) * 1000) / 10 : 0
    },
    sources: sources.map(s => ({ ...s, record_count: sourceCounts[s.slug] || 0 })),
    disclaimer: 'Nền tảng chỉ phục vụ mục đích giáo dục và thông tin. Không thay thế tư vấn, chẩn đoán hoặc điều trị y khoa chuyên nghiệp.'
  };
  add('catalog', catalogue);

  const diseaseRows = all(`
    SELECT d.id, d.slug, d.name_en, d.name_vi, d.name_vi_status, d.scientific_name,
      d.definition, d.definition_source, d.category_id, d.mondo_id, d.orphanet_code, d.doid,
      d.icd10, d.icd11, d.umls, d.omim, d.mesh, d.snomed, d.ncit, d.gard,
      d.inheritance, d.onset, d.prevalence, d.epidemiology, d.source_slug, d.source_url,
      d.retrieved_at, d.updated_at, d.verification, d.is_rare,
      c.name_vi AS category_vi, c.name_en AS category_en, c.slug AS category_slug,
      (SELECT COUNT(*) FROM disease_symptoms ds WHERE ds.disease_id=d.id) AS symptom_count
    FROM diseases d LEFT JOIN categories c ON c.id=d.category_id
  `);
  const diseaseSynonymRows = all('SELECT disease_id, name FROM disease_synonyms');
  const synonymsByDisease = new Map();
  for (const r of diseaseSynonymRows) {
    if (!synonymsByDisease.has(r.disease_id)) synonymsByDisease.set(r.disease_id, []);
    synonymsByDisease.get(r.disease_id).push(r.name);
  }
  for (const d of diseaseRows) {
    d.search_fold = fold([
      d.name_en, d.name_vi, d.scientific_name, d.mondo_id, d.orphanet_code, d.doid, d.icd10,
      d.definition, ...(synonymsByDisease.get(d.id) || [])
    ].filter(Boolean).join(' '));
  }
  add('diseases', diseaseRows);

  const symptoms = all(`
    SELECT s.id, s.slug, s.hpo_id, s.name_en, s.name_vi, s.name_vi_status, s.definition,
      s.synonyms, s.organ_system, s.parent_hpo, s.source_slug, s.source_url,
      (SELECT COUNT(*) FROM disease_symptoms ds WHERE ds.symptom_id=s.id) AS disease_count
    FROM symptoms s
  `);
  for (const s of symptoms) s.search_fold = fold([s.name_en, s.name_vi, s.hpo_id, s.definition, s.synonyms, s.organ_system].filter(Boolean).join(' '));
  add('symptoms', symptoms);

  const drugs = all(`
    SELECT id, slug, product_ndc, brand_name, generic_name, active_ingredients, dosage_form,
      route, marketing_category, labeler, country, product_type, packaging, pharm_class,
      application_number, dea_schedule, source_slug, source_url, retrieved_at
    FROM drugs
  `);
  for (const d of drugs) d.search_fold = fold([d.brand_name, d.generic_name, d.active_ingredients, d.product_ndc, d.labeler, d.pharm_class].filter(Boolean).join(' '));
  add('drugs', drugs);

  const anatomy = all(`
    SELECT id, slug, uberon_id, name_en, name_vi, name_vi_status, definition, parent_uberon,
      systems, part_of, source_slug, source_url
    FROM anatomy
  `);
  for (const a of anatomy) a.search_fold = fold([a.name_en, a.name_vi, a.uberon_id, a.definition, a.systems].filter(Boolean).join(' '));
  add('anatomy', anatomy);

  const labs = all(`
    SELECT id, slug, name_en, name_vi, name_vi_status, purpose, specimen, method, unit,
      reference_note, clinical_significance, related_conditions, source_slug, source_url, retrieved_at
    FROM laboratory_tests
  `);
  for (const l of labs) l.search_fold = fold([l.name_en, l.name_vi, l.purpose, l.specimen, l.method, l.reference_note, l.related_conditions].filter(Boolean).join(' '));
  add('labs', labs);

  const organisms = all(`
    SELECT m.id, m.slug, m.taxid, m.name_scientific, m.name_common, m.rank, m.lineage,
      m.kingdom, m.gram_stain, m.genome_size, m.source_slug, m.source_url, m.retrieved_at,
      (SELECT COUNT(*) FROM microorganism_diseases md WHERE md.microorganism_id=m.id) AS disease_count
    FROM microorganisms m
  `);
  for (const m of organisms) m.search_fold = fold([m.name_scientific, m.name_common, m.taxid, m.rank, m.kingdom, m.lineage].filter(Boolean).join(' '));
  add('organisms', organisms);

  const genes = all(`
    SELECT g.id, g.slug, g.symbol, g.name, g.chromosome, g.location, g.gene_id,
      g.organism, g.source_slug, g.source_url, g.retrieved_at, g.ncbi_gene_id, g.gene_type,
      (SELECT COUNT(*) FROM disease_genes dg WHERE dg.gene_id=g.id) AS disease_count
    FROM genes g
  `);
  for (const g of genes) g.search_fold = fold([g.symbol, g.name, g.chromosome, g.location, g.ncbi_gene_id, g.gene_type].filter(Boolean).join(' '));
  add('genes', genes);

  const icdCodes = all('SELECT code, title, chapter, billable, source_slug, source_url FROM icd_codes ORDER BY code');
  add('icd', icdCodes);

  const diseaseSymptoms = all(`
    SELECT disease_id, symptom_id, frequency_text, frequency_ratio, onset, evidence, source_slug
    FROM disease_symptoms
  `).map(r => [r.disease_id, r.symptom_id, r.frequency_text, r.frequency_ratio, r.onset, r.evidence, r.source_slug]);
  const diseaseMeta = {
    identifiers: all('SELECT disease_id, scheme, value, source_slug FROM disease_identifiers ORDER BY scheme, value')
      .map(r => [r.disease_id, r.scheme, r.value, r.source_slug]),
    synonyms: all('SELECT disease_id, name, lang, scope, source_slug FROM disease_synonyms ORDER BY scope, name')
      .map(r => [r.disease_id, r.name, r.lang, r.scope, r.source_slug]),
    parents: all('SELECT disease_id, parent_id FROM disease_parents').map(r => [r.disease_id, r.parent_id]),
    diseaseGenes: all(`SELECT dg.disease_id, dg.gene_id, dg.association_type,
        g.slug, g.symbol, g.name, g.chromosome, g.location, g.ncbi_gene_id
      FROM disease_genes dg JOIN genes g ON g.id = dg.gene_id`)
      .map(r => [r.disease_id, r.gene_id, r.association_type, {
        slug: r.slug, symbol: r.symbol, name: r.name, chromosome: r.chromosome,
        location: r.location, ncbi_gene_id: r.ncbi_gene_id
      }]),
    organismDiseases: all('SELECT microorganism_id, disease_id, source_slug FROM microorganism_diseases')
      .map(r => [r.microorganism_id, r.disease_id, r.source_slug])
  };
  add('disease_relations', { diseaseSymptoms, ...diseaseMeta });

  const pathways = all('SELECT id, reactome_id, name, species, url, source_slug FROM pathways ORDER BY name');
  const geneMeta = {
    pathways,
    summaries: all("SELECT id, summary FROM genes WHERE summary IS NOT NULL AND summary <> ''").map(r => [r.id, r.summary]),
    aliases: all('SELECT gene_id, alias FROM gene_aliases ORDER BY alias').map(r => [r.gene_id, r.alias]),
    genePathways: all('SELECT gene_id, pathway_id, evidence FROM gene_pathways').map(r => [r.gene_id, r.pathway_id, r.evidence]),
    diseases: all(`SELECT dg.gene_id, d.slug, d.name_en, d.name_vi, d.orphanet_code, dg.association_type
      FROM disease_genes dg JOIN diseases d ON d.id = dg.disease_id ORDER BY d.name_en`).map(r => ({
        gene_id: r.gene_id, slug: r.slug, name_en: r.name_en, name_vi: r.name_vi,
        orphanet_code: r.orphanet_code, association_type: r.association_type
      })),
    proteins: all(`SELECT gene_id, uniprot_id, name, length, function, subcellular, url
      FROM proteins WHERE gene_id IS NOT NULL`).map(r => [r.gene_id, r.uniprot_id, r.name, r.length, r.function, r.subcellular, r.url])
  };
  add('gene_relations', geneMeta);

  const trials = all('SELECT id, nct_id, title, status, conditions, phases, sponsor FROM clinical_trials');
  const trialById = new Map(trials.map(t => [t.id, t]));
  const maps = {
    disease: new Map(diseaseRows.map(x => [x.id, x])),
    symptom: new Map(symptoms.map(x => [x.id, x])),
    drug: new Map(drugs.map(x => [x.id, x])),
    anatomy: new Map(anatomy.map(x => [x.id, x])),
    organism: new Map(organisms.map(x => [x.id, x])),
    lab: new Map(labs.map(x => [x.id, x])),
    gene: new Map(genes.map(x => [x.id, x])),
    trial: trialById
  };
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
  function shapeHit(type, row, ft, fsx, fb) {
    const meta = ENTITY_META[type] || { label: type, route: '#' };
    if (!row) return null;
    const common = { type, typeLabel: meta.label, url: meta.route };
    if (type === 'disease') return {
      ...common, id: row.id, slug: row.slug, title: row.name_en, titleVi: row.name_vi,
      subtitle: [row.category_vi, row.mondo_id].filter(Boolean).join(' · '),
      snippet: row.definition ? row.definition.slice(0, 220) : null,
      codes: [row.mondo_id, row.orphanet_code && `ORPHA:${row.orphanet_code}`, row.icd10 && `ICD-10:${row.icd10}`].filter(Boolean),
      badge: row.is_rare ? 'Bệnh hiếm' : null
    };
    if (type === 'symptom') return {
      ...common, id: row.id, slug: row.slug, title: row.name_en, titleVi: row.name_vi,
      subtitle: [row.organ_system, row.hpo_id].filter(Boolean).join(' · '),
      snippet: row.definition ? row.definition.slice(0, 220) : null, codes: [row.hpo_id].filter(Boolean)
    };
    if (type === 'drug') return {
      ...common, id: row.id, slug: row.slug, title: row.brand_name || row.generic_name, titleVi: row.generic_name,
      subtitle: [row.dosage_form, row.labeler].filter(Boolean).join(' · '),
      snippet: row.active_ingredients ? `Hoạt chất: ${row.active_ingredients}` : (fb ? fb.slice(0, 220) : null),
      codes: [row.product_ndc && `NDC ${row.product_ndc}`].filter(Boolean)
    };
    if (type === 'anatomy') return {
      ...common, id: row.id, slug: row.slug, title: row.name_en,
      subtitle: [row.systems, row.uberon_id].filter(Boolean).join(' · '),
      snippet: row.definition ? row.definition.slice(0, 220) : null, codes: [row.uberon_id].filter(Boolean)
    };
    if (type === 'organism') return {
      ...common, id: row.id, slug: row.slug, title: row.name_scientific, titleVi: row.name_common,
      subtitle: [row.rank, row.kingdom].filter(Boolean).join(' · '),
      snippet: row.lineage ? row.lineage.slice(0, 220) : null, codes: [row.taxid && `TaxID ${row.taxid}`].filter(Boolean)
    };
    if (type === 'lab') return {
      ...common, id: row.id, slug: row.slug, title: row.name_en, subtitle: 'Xét nghiệm y khoa',
      snippet: row.purpose ? row.purpose.slice(0, 220) : null, codes: []
    };
    if (type === 'gene') return {
      ...common, id: row.id, slug: row.slug, title: row.symbol, titleVi: row.name,
      subtitle: [row.chromosome && `NST ${row.chromosome}`, row.location, row.gene_type].filter(Boolean).join(' · '),
      snippet: fb ? fb.slice(0, 220) : null, codes: [row.ncbi_gene_id && `NCBI Gene ${row.ncbi_gene_id}`].filter(Boolean)
    };
    if (type === 'trial') return {
      ...common, id: row.id, slug: row.nct_id, title: row.title,
      subtitle: [row.nct_id, row.status, row.phases].filter(Boolean).join(' · '),
      snippet: row.conditions, codes: [row.nct_id].filter(Boolean)
    };
    return null;
  }
  const searchRows = all(`
    SELECT sd.entity_type AS type, sd.entity_id AS id, si.title AS ft, si.subtitle AS fs, si.body AS fb
    FROM search_index si JOIN search_docs sd ON sd.doc_rowid = si.rowid
  `);
  const searchDocs = [];
  for (const r of searchRows) {
    // Trials have no static detail page; their dedicated search remains on #/trials.
    if (r.type === 'trial') continue;
    const hit = shapeHit(r.type, maps[r.type]?.get(r.id), r.ft, r.fs, r.fb);
    if (!hit) continue;
    searchDocs.push({
      ...hit,
      xf: fold(r.ft || ''),
      x: fold([r.ft, r.fs, r.fb].filter(Boolean).join(' '))
    });
  }
  add('search_core', searchDocs.filter(d => d.type !== 'gene'));
  add('search_genes', searchDocs.filter(d => d.type === 'gene'));

  // Suggestions are a compact index: all non-gene entities plus genes with a
  // curated disease link, so typing in the header does not download the full
  // 281k-document search snapshot.
  const suggestDocs = searchDocs
    .filter(d => d.type !== 'gene' || (maps.gene.get(d.id)?.disease_count || 0) > 0)
    .map(d => ({
      t: d.title, s: d.subtitle || '', y: d.type, l: d.typeLabel, u: `${d.url}${d.slug}`,
      xf: d.xf, x: fold([d.title, d.subtitle].filter(Boolean).join(' '))
    }));
  add('suggest', suggestDocs);

  console.log(`Tổng snapshot: ${(rawTotal / 1048576).toFixed(1)} MB raw · ${(gzTotal / 1048576).toFixed(1)} MB gzip`);
  db.close();

  copyFrontend();
  copyDir(SNAPSHOT_DATA, path.join(DIST, 'data'));
  console.log('Đã tạo dist/ và static-snapshot/data/.');
}

if (!fs.existsSync(DB_PATH)) {
  useSnapshot();
} else {
  buildSnapshot();
}
