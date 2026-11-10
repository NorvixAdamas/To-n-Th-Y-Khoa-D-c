'use strict';
/**
 * Central SQLite layer for the Global Medical Encyclopedia.
 * Uses Node's built-in SQLite (node:sqlite) so there are no native build steps.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.MEDENC_DB || path.join(ROOT, 'data', 'medical.db');

function open(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 15000;');
  return db;
}

/** Fold Vietnamese/Unicode text to a diacritic-free, lowercase, space separated form. */
function fold(input) {
  if (!input) return '';
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(input, suffix) {
  const base = fold(input).replace(/\s+/g, '-').slice(0, 90) || 'entry';
  return suffix ? `${base}-${String(suffix).toLowerCase().replace(/[^a-z0-9]+/g, '')}` : base;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  homepage TEXT,
  api_url TEXT,
  license_name TEXT,
  license_url TEXT,
  attribution TEXT,
  country TEXT,
  description TEXT,
  retrieved_at TEXT,
  last_success_at TEXT,
  status TEXT DEFAULT 'not_synced',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name_vi TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description TEXT,
  parent_id INTEGER,
  sort_order INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS diseases (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_vi TEXT,
  name_vi_status TEXT,
  scientific_name TEXT,
  definition TEXT,
  definition_source TEXT,
  category_id INTEGER REFERENCES categories(id),
  mondo_id TEXT UNIQUE,
  orphanet_code TEXT,
  doid TEXT,
  icd10 TEXT,
  icd11 TEXT,
  umls TEXT,
  omim TEXT,
  mesh TEXT,
  snomed TEXT,
  ncit TEXT,
  gard TEXT,
  inheritance TEXT,
  onset TEXT,
  prevalence TEXT,
  epidemiology TEXT,
  source_slug TEXT,
  source_url TEXT,
  retrieved_at TEXT,
  updated_at TEXT,
  verification TEXT DEFAULT 'source_verified',
  is_rare INTEGER DEFAULT 0,
  search_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_diseases_category ON diseases(category_id);
CREATE INDEX IF NOT EXISTS idx_diseases_name ON diseases(name_en);
CREATE INDEX IF NOT EXISTS idx_diseases_orphanet_lookup ON diseases(orphanet_code);
CREATE INDEX IF NOT EXISTS idx_diseases_doid ON diseases(doid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_diseases_orphanet ON diseases(orphanet_code);
CREATE INDEX IF NOT EXISTS idx_diseases_rarity ON diseases(is_rare);

CREATE TABLE IF NOT EXISTS disease_identifiers (
  id INTEGER PRIMARY KEY,
  disease_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  source_slug TEXT,
  UNIQUE(disease_id, scheme, value)
);
CREATE INDEX IF NOT EXISTS idx_disease_identifiers_value ON disease_identifiers(scheme, value);

CREATE TABLE IF NOT EXISTS disease_synonyms (
  id INTEGER PRIMARY KEY,
  disease_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lang TEXT DEFAULT 'en',
  scope TEXT,
  source_slug TEXT,
  UNIQUE(disease_id, name, lang)
);
CREATE INDEX IF NOT EXISTS idx_synonyms_name ON disease_synonyms(name);

CREATE TABLE IF NOT EXISTS disease_parents (
  disease_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  PRIMARY KEY(disease_id, parent_id)
);

CREATE TABLE IF NOT EXISTS symptoms (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  hpo_id TEXT UNIQUE,
  name_en TEXT NOT NULL,
  name_vi TEXT,
  name_vi_status TEXT,
  definition TEXT,
  synonyms TEXT,
  organ_system TEXT,
  parent_hpo TEXT,
  source_slug TEXT,
  source_url TEXT,
  search_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_symptoms_name ON symptoms(name_en);

CREATE TABLE IF NOT EXISTS disease_symptoms (
  disease_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  symptom_id INTEGER NOT NULL REFERENCES symptoms(id) ON DELETE CASCADE,
  frequency_text TEXT,
  frequency_ratio REAL,
  onset TEXT,
  evidence TEXT,
  source_slug TEXT,
  PRIMARY KEY(disease_id, symptom_id)
);
CREATE INDEX IF NOT EXISTS idx_ds_symptom ON disease_symptoms(symptom_id);

CREATE TABLE IF NOT EXISTS anatomy (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  uberon_id TEXT UNIQUE,
  name_en TEXT NOT NULL,
  name_vi TEXT,
  name_vi_status TEXT,
  definition TEXT,
  parent_uberon TEXT,
  systems TEXT,
  part_of TEXT,
  source_slug TEXT,
  source_url TEXT,
  search_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_anatomy_name ON anatomy(name_en);

CREATE TABLE IF NOT EXISTS drugs (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  product_ndc TEXT UNIQUE,
  brand_name TEXT,
  generic_name TEXT,
  active_ingredients TEXT,
  dosage_form TEXT,
  route TEXT,
  marketing_category TEXT,
  labeler TEXT,
  country TEXT,
  product_type TEXT,
  packaging TEXT,
  pharm_class TEXT,
  application_number TEXT,
  dea_schedule TEXT,
  source_slug TEXT,
  source_url TEXT,
  retrieved_at TEXT,
  search_text TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_genes_symbol ON genes(symbol);
CREATE INDEX IF NOT EXISTS idx_drugs_generic ON drugs(generic_name);
CREATE INDEX IF NOT EXISTS idx_drugs_form ON drugs(dosage_form);
CREATE INDEX IF NOT EXISTS idx_drugs_labeler ON drugs(labeler);

CREATE TABLE IF NOT EXISTS drug_labels (
  drug_id INTEGER PRIMARY KEY REFERENCES drugs(id) ON DELETE CASCADE,
  set_id TEXT,
  effective_time TEXT,
  indications TEXT,
  contraindications TEXT,
  warnings TEXT,
  adverse_reactions TEXT,
  drug_interactions TEXT,
  dosage_admin TEXT,
  source_url TEXT,
  fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS laboratory_tests (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_vi TEXT,
  name_vi_status TEXT,
  purpose TEXT,
  specimen TEXT,
  method TEXT,
  unit TEXT,
  reference_note TEXT,
  clinical_significance TEXT,
  related_conditions TEXT,
  source_slug TEXT,
  source_url TEXT,
  retrieved_at TEXT,
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS microorganisms (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  taxid INTEGER UNIQUE,
  name_scientific TEXT NOT NULL,
  name_common TEXT,
  rank TEXT,
  lineage TEXT,
  kingdom TEXT,
  gram_stain TEXT,
  genome_size TEXT,
  source_slug TEXT,
  source_url TEXT,
  retrieved_at TEXT,
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS microorganism_diseases (
  microorganism_id INTEGER NOT NULL REFERENCES microorganisms(id) ON DELETE CASCADE,
  disease_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  source_slug TEXT,
  PRIMARY KEY(microorganism_id, disease_id)
);

CREATE TABLE IF NOT EXISTS genes (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  chromosome TEXT,
  location TEXT,
  gene_id TEXT UNIQUE,
  summary TEXT,
  organism TEXT DEFAULT 'Homo sapiens',
  source_slug TEXT,
  source_url TEXT,
  retrieved_at TEXT,
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS disease_genes (
  disease_id INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
  gene_id INTEGER NOT NULL REFERENCES genes(id) ON DELETE CASCADE,
  association_type TEXT,
  source_slug TEXT,
  PRIMARY KEY(disease_id, gene_id)
);

CREATE TABLE IF NOT EXISTS medical_articles (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  pmid TEXT,
  doi TEXT,
  title TEXT,
  authors TEXT,
  journal TEXT,
  year TEXT,
  abstract TEXT,
  is_open_access INTEGER DEFAULT 0,
  license TEXT,
  url TEXT,
  fetched_at TEXT,
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_articles_pmid ON medical_articles(pmid);

CREATE TABLE IF NOT EXISTS research_cache (
  query_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  query TEXT NOT NULL,
  total INTEGER,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_trials (
  id INTEGER PRIMARY KEY,
  nct_id TEXT UNIQUE NOT NULL,
  title TEXT,
  status TEXT,
  conditions TEXT,
  interventions TEXT,
  phases TEXT,
  sponsor TEXT,
  enrollment INTEGER,
  start_date TEXT,
  completion_date TEXT,
  countries TEXT,
  summary TEXT,
  url TEXT,
  fetched_at TEXT,
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS gene_aliases (
  id INTEGER PRIMARY KEY,
  gene_id INTEGER NOT NULL REFERENCES genes(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  source_slug TEXT,
  UNIQUE(gene_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_gene_aliases_alias ON gene_aliases(alias);

CREATE TABLE IF NOT EXISTS pathways (
  id INTEGER PRIMARY KEY,
  reactome_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  species TEXT,
  url TEXT,
  source_slug TEXT DEFAULT 'reactome',
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS gene_pathways (
  gene_id INTEGER NOT NULL REFERENCES genes(id) ON DELETE CASCADE,
  pathway_id INTEGER NOT NULL REFERENCES pathways(id) ON DELETE CASCADE,
  evidence TEXT,
  source_slug TEXT DEFAULT 'reactome',
  PRIMARY KEY(gene_id, pathway_id)
);
CREATE INDEX IF NOT EXISTS idx_gene_pathways_pathway ON gene_pathways(pathway_id);

CREATE TABLE IF NOT EXISTS proteins (
  id INTEGER PRIMARY KEY,
  uniprot_id TEXT UNIQUE NOT NULL,
  gene_id INTEGER REFERENCES genes(id) ON DELETE SET NULL,
  gene_symbol TEXT,
  name TEXT,
  organism TEXT DEFAULT 'Homo sapiens',
  length INTEGER,
  function TEXT,
  subcellular TEXT,
  url TEXT,
  source_slug TEXT DEFAULT 'uniprot',
  retrieved_at TEXT,
  search_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_proteins_gene ON proteins(gene_id);

CREATE TABLE IF NOT EXISTS icd_codes (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  chapter TEXT,
  billable INTEGER DEFAULT 0,
  source_slug TEXT DEFAULT 'icd10cm',
  source_url TEXT,
  search_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_icd_code ON icd_codes(code);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  created_at TEXT,
  UNIQUE(entity_type, entity_id, lang, field)
);

CREATE TABLE IF NOT EXISTS data_import_jobs (
  id INTEGER PRIMARY KEY,
  source_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  records_seen INTEGER DEFAULT 0,
  records_upserted INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  message TEXT,
  checkpoint TEXT
);

CREATE TABLE IF NOT EXISTS data_update_logs (
  id INTEGER PRIMARY KEY,
  job_id INTEGER,
  source_slug TEXT,
  level TEXT,
  message TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_job ON data_update_logs(job_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  title,
  subtitle,
  body,
  tokenize = 'unicode61 remove_diacritics 1'
);
CREATE TABLE IF NOT EXISTS search_docs (
  doc_rowid INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  UNIQUE(entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_search_docs_entity ON search_docs(entity_type, entity_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fuzzy USING fts5(
  title,
  tokenize = 'trigram'
);
CREATE TABLE IF NOT EXISTS search_fuzzy_docs (
  doc_rowid INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  UNIQUE(entity_type, entity_id)
);
`;

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function init(db) {
  db.exec(SCHEMA);
  // Additive migrations must keep existing databases usable.
  ensureColumn(db, 'genes', 'ncbi_gene_id', 'TEXT');
  ensureColumn(db, 'genes', 'gene_type', 'TEXT');
  ensureColumn(db, 'genes', 'aliases', 'TEXT');
  ensureColumn(db, 'genes', 'db_xrefs', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_genes_ncbi ON genes(ncbi_gene_id) WHERE ncbi_gene_id IS NOT NULL');
  seedCategories(db);
  seedSources(db);
  // These are queried live by the server rather than bulk-ingested.
  for (const slug of ['pubmed', 'europepmc', 'clinicaltrials', 'crossref', 'openalex']) {
    db.prepare("UPDATE sources SET status='ready' WHERE slug=? AND status='not_synced'").run(slug);
  }
  setMeta(db, 'schema_version', '2.1.0');
}

const CATEGORY_SEED = [
  ['infectious', 'Bệnh truyền nhiễm', 'Infectious disease', 'Bệnh do vi khuẩn, virus, nấm, ký sinh trùng và prion gây ra.', 10],
  ['non_communicable', 'Bệnh không lây nhiễm', 'Non-communicable disease', 'Bệnh mạn tính không lây từ người sang người.', 20],
  ['rare', 'Bệnh hiếm gặp', 'Rare disease', 'Bệnh có tỷ lệ mắc thấp theo định nghĩa của nguồn dữ liệu.', 30],
  ['genetic', 'Bệnh di truyền', 'Genetic disease', 'Bệnh do biến thể gen hoặc bất thường di truyền.', 40],
  ['cancer', 'Ung thư và khối u', 'Cancer and neoplasm', 'Bệnh tân sinh ác tính và lành tính.', 50],
  ['cardiovascular', 'Bệnh tim mạch', 'Cardiovascular disease', 'Bệnh của tim và hệ tuần hoàn.', 60],
  ['nervous', 'Bệnh thần kinh', 'Nervous system disease', 'Bệnh của hệ thần kinh trung ương và ngoại biên.', 70],
  ['mental', 'Bệnh tâm thần', 'Psychiatric disorder', 'Rối loạn tâm thần và hành vi.', 80],
  ['respiratory', 'Bệnh hô hấp', 'Respiratory disease', 'Bệnh của đường hô hấp và phổi.', 90],
  ['digestive', 'Bệnh tiêu hóa', 'Digestive system disease', 'Bệnh của ống tiêu hóa, gan, mật và tụy.', 100],
  ['endocrine', 'Bệnh nội tiết', 'Endocrine disease', 'Bệnh của tuyến nội tiết và chuyển hóa.', 110],
  ['immune', 'Bệnh miễn dịch', 'Immune system disease', 'Rối loạn miễn dịch bẩm sinh và mắc phải.', 120],
  ['autoimmune', 'Bệnh tự miễn', 'Autoimmune disease', 'Bệnh do miễn dịch tấn công mô của cơ thể.', 130],
  ['skin', 'Bệnh da liễu', 'Skin disease', 'Bệnh của da, tóc, móng và niêm mạc.', 140],
  ['musculoskeletal', 'Bệnh cơ xương khớp', 'Musculoskeletal disease', 'Bệnh của xương, khớp, cơ và mô liên kết.', 150],
  ['female_reproductive', 'Bệnh phụ khoa', 'Female reproductive system disease', 'Bệnh của hệ sinh sản nữ.', 160],
  ['male_reproductive', 'Bệnh nam khoa', 'Male reproductive system disease', 'Bệnh của hệ sinh sản nam.', 170],
  ['pediatric', 'Bệnh nhi khoa', 'Pediatric disease', 'Bệnh khởi phát ở trẻ em và sơ sinh.', 180],
  ['geriatric', 'Bệnh lão khoa', 'Geriatric disease', 'Bệnh gắn với quá trình lão hóa.', 190],
  ['eye', 'Bệnh về mắt', 'Eye disease', 'Bệnh của mắt và phần phụ.', 200],
  ['ent', 'Bệnh tai mũi họng', 'Ear, nose and throat disease', 'Bệnh của tai, mũi, họng và thanh quản.', 210],
  ['urinary', 'Bệnh thận và tiết niệu', 'Renal and urinary disease', 'Bệnh của thận và đường tiết niệu.', 220],
  ['hematologic', 'Bệnh huyết học', 'Hematologic disease', 'Bệnh của máu và cơ quan tạo máu.', 230],
  ['occupational', 'Bệnh nghề nghiệp', 'Occupational disease', 'Bệnh do phơi nhiễm môi trường lao động.', 240],
  ['parasitic', 'Bệnh do ký sinh trùng', 'Parasitic disease', 'Bệnh do ký sinh trùng gây ra.', 250],
  ['bacterial', 'Bệnh do vi khuẩn', 'Bacterial infection', 'Bệnh do vi khuẩn gây ra.', 260],
  ['viral', 'Bệnh do virus', 'Viral infection', 'Bệnh do virus gây ra.', 270],
  ['fungal', 'Bệnh do nấm', 'Fungal infection', 'Bệnh do nấm gây ra.', 280],
  ['syndrome', 'Hội chứng và rối loạn khác', 'Syndrome and other disorder', 'Hội chứng và rối loạn chưa xếp vào nhóm chuyên biệt.', 290],
  ['other', 'Khác', 'Other', 'Bản ghi chưa ánh xạ được vào nhóm chuyên khoa.', 900]
];

const SOURCE_SEED = [
  {
    slug: 'mondo', name: 'MONDO Disease Ontology', homepage: 'https://mondo.monarchinitiative.org/',
    api_url: 'https://purl.obolibrary.org/obo/mondo.obo', license_name: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Monarch Initiative — Mondo Disease Ontology',
    country: 'Global', description: 'Danh mục bệnh hợp nhất, mã định danh và phân cấp bệnh.'
  },
  {
    slug: 'hpo', name: 'Human Phenotype Ontology (HPO)', homepage: 'https://hpo.jax.org/',
    api_url: 'https://purl.obolibrary.org/obo/hp.obo', license_name: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Human Phenotype Ontology Consortium',
    country: 'Global', description: 'Thuật ngữ kiểu hình và liên kết bệnh – triệu chứng.'
  },
  {
    slug: 'orphadata', name: 'Orphanet / Orphadata', homepage: 'https://www.orphadata.com/',
    api_url: 'https://www.orphadata.com/data/xml/en_product1.xml', license_name: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Orphanet — INSERM US14',
    country: 'Global', description: 'Bệnh hiếm, gene liên quan, dịch tễ và kiểu hình.'
  },
  {
    slug: 'uberon', name: 'Uberon Anatomy Ontology', homepage: 'https://uberon.github.io/',
    api_url: 'https://purl.obolibrary.org/obo/uberon-basic.obo', license_name: 'CC BY 3.0',
    license_url: 'https://creativecommons.org/licenses/by/3.0/', attribution: 'Uberon multi-species anatomy ontology',
    country: 'Global', description: 'Thuật ngữ giải phẫu và quan hệ bộ phận.'
  },
  {
    slug: 'openfda', name: 'openFDA — NDC Directory', homepage: 'https://open.fda.gov/apis/',
    api_url: 'https://api.fda.gov/drug/ndc.json', license_name: 'Public domain (CC0)',
    license_url: 'https://open.fda.gov/license/', attribution: 'U.S. Food and Drug Administration — openFDA',
    country: 'United States', description: 'Danh mục sản phẩm thuốc, hoạt chất, dạng bào chế, nhà sản xuất.'
  },
  {
    slug: 'dailymed', name: 'DailyMed (NLM)', homepage: 'https://dailymed.nlm.nih.gov/',
    api_url: 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json', license_name: 'Public domain (U.S. Government)',
    license_url: 'https://www.nlm.nih.gov/copyright.html', attribution: 'U.S. National Library of Medicine — DailyMed',
    country: 'United States', description: 'Nhãn thuốc chính thức: chỉ định, chống chỉ định, cảnh báo, tác dụng phụ.'
  },
  {
    slug: 'ncbi_taxonomy', name: 'NCBI Taxonomy', homepage: 'https://www.ncbi.nlm.nih.gov/taxonomy',
    api_url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=taxonomy', license_name: 'Public domain (U.S. Government)',
    license_url: 'https://www.ncbi.nlm.nih.gov/home/about/policies/', attribution: 'NCBI Taxonomy Database',
    country: 'Global', description: 'Phân loại sinh học của tác nhân gây bệnh.'
  },
  {
    slug: 'pubmed', name: 'PubMed — NCBI', homepage: 'https://pubmed.ncbi.nlm.nih.gov/',
    api_url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', license_name: 'NLM Terms and Conditions',
    license_url: 'https://www.nlm.nih.gov/databases/download/terms_and_conditions.html', attribution: 'U.S. National Library of Medicine',
    country: 'Global', description: 'Tìm kiếm bài báo khoa học, PMID, DOI, abstract.'
  },
  {
    slug: 'europepmc', name: 'Europe PMC', homepage: 'https://europepmc.org/',
    api_url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search', license_name: 'Per-record licence (see article)',
    license_url: 'https://europepmc.org/about', attribution: 'Europe PMC — EMBL-EBI',
    country: 'Global', description: 'Bài báo y khoa, trạng thái Open Access và liên kết tài liệu.'
  },
  {
    slug: 'clinicaltrials', name: 'ClinicalTrials.gov', homepage: 'https://clinicaltrials.gov/',
    api_url: 'https://clinicaltrials.gov/api/v2/studies', license_name: 'Public domain (U.S. Government)',
    license_url: 'https://clinicaltrials.gov/about-site/terms-conditions', attribution: 'U.S. National Library of Medicine — ClinicalTrials.gov',
    country: 'Global', description: 'Thử nghiệm lâm sàng, trạng thái tuyển bệnh, địa điểm, nhà tài trợ.'
  },
  {
    slug: 'medlineplus', name: 'MedlinePlus (NLM)', homepage: 'https://medlineplus.gov/',
    api_url: 'https://wsearch.nlm.nih.gov/ws/query', license_name: 'Public domain (U.S. Government)',
    license_url: 'https://medlineplus.gov/about/using/usingcontent/', attribution: 'U.S. National Library of Medicine — MedlinePlus',
    country: 'United States', description: 'Nội dung giáo dục sức khỏe và thông tin xét nghiệm y khoa.'
  },
  {
    slug: 'ncbi_gene', name: 'NCBI Gene', homepage: 'https://www.ncbi.nlm.nih.gov/gene/',
    api_url: 'https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz', license_name: 'Public domain (U.S. Government)',
    license_url: 'https://www.ncbi.nlm.nih.gov/home/about/policies/', attribution: 'NCBI Gene Database',
    country: 'Global', description: 'Thông tin gene, vị trí nhiễm sắc thể, tên đầy đủ, aliases và mã GeneID.'
  },
  {
    slug: 'doid', name: 'Human Disease Ontology (DOID)', homepage: 'https://disease-ontology.org/',
    api_url: 'https://purl.obolibrary.org/obo/doid.obo', license_name: 'CC0 1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'Human Disease Ontology Consortium',
    country: 'Global', description: 'Ontology bệnh người, định nghĩa, synonym và cross-reference.'
  },
  {
    slug: 'icd10cm', name: 'ICD-10-CM (CMS/NCHS)', homepage: 'https://www.cms.gov/medicare/coding-billing/icd-10-codes',
    api_url: 'https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip', license_name: 'Public domain (U.S. Government)',
    license_url: 'https://www.cms.gov/about-cms/web-policies-important-links/website-policies', attribution: 'Centers for Medicare & Medicaid Services — ICD-10-CM',
    country: 'United States', description: 'Bộ mã ICD-10-CM và mô tả chính thức dùng cho tra cứu mã bệnh.'
  },
  {
    slug: 'reactome', name: 'Reactome', homepage: 'https://reactome.org/',
    api_url: 'https://reactome.org/download/current/', license_name: 'CC0 1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'Reactome Consortium',
    country: 'Global', description: 'Con đường sinh học và liên kết gene–pathway của người.'
  },
  {
    slug: 'uniprot', name: 'UniProt Knowledgebase', homepage: 'https://www.uniprot.org/',
    api_url: 'https://rest.uniprot.org/uniprotkb/search', license_name: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'UniProt Consortium',
    country: 'Global', description: 'Protein người đã review, chức năng và vị trí tế bào.'
  },
  {
    slug: 'openalex', name: 'OpenAlex', homepage: 'https://openalex.org/',
    api_url: 'https://api.openalex.org/works', license_name: 'CC0 1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'OurResearch — OpenAlex',
    country: 'Global', description: 'Chỉ mục công trình khoa học mở, dùng để tìm nghiên cứu trực tiếp.'
  },
  {
    slug: 'crossref', name: 'Crossref', homepage: 'https://www.crossref.org/',
    api_url: 'https://api.crossref.org/works', license_name: 'Metadata mở — giấy phép theo từng bản ghi',
    license_url: 'https://www.crossref.org/community/terms-of-use/', attribution: 'Crossref',
    country: 'Global', description: 'DOI và metadata bài báo khoa học; nội dung/giấy phép theo từng nhà xuất bản.'
  }
];

function seedCategories(db) {
  const stmt = db.prepare(
    'INSERT INTO categories (slug, name_vi, name_en, description, sort_order) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(slug) DO UPDATE SET name_vi=excluded.name_vi, name_en=excluded.name_en, description=excluded.description, sort_order=excluded.sort_order'
  );
  for (const c of CATEGORY_SEED) stmt.run(c[0], c[1], c[2], c[3], c[4]);
}

function seedSources(db) {
  const stmt = db.prepare(
    `INSERT INTO sources (slug, name, homepage, api_url, license_name, license_url, attribution, country, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET name=excluded.name, homepage=excluded.homepage, api_url=excluded.api_url,
       license_name=excluded.license_name, license_url=excluded.license_url, attribution=excluded.attribution,
       country=excluded.country, description=excluded.description`
  );
  for (const s of SOURCE_SEED) {
    stmt.run(s.slug, s.name, s.homepage, s.api_url, s.license_name, s.license_url, s.attribution, s.country, s.description);
  }
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/** Replace the search documents for one entity type in bulk. */
function indexEntities(db, entityType, rows) {
  db.prepare('DELETE FROM search_docs WHERE entity_type = ?').run(entityType);
  const insertDoc = db.prepare('INSERT INTO search_docs (entity_type, entity_id) VALUES (?, ?)');
  const insertIdx = db.prepare('INSERT INTO search_index (rowid, title, subtitle, body) VALUES (?, ?, ?, ?)');
  for (const r of rows) {
    const info = insertDoc.run(entityType, r.id);
    insertIdx.run(info.lastInsertRowid, fold(r.title), fold(r.subtitle || ''), fold(r.body || ''));
  }
}

const SEARCH_ENTITIES = ['disease', 'symptom', 'drug', 'anatomy', 'organism', 'lab', 'gene', 'trial'];

function rebuildSearch(db, log = () => {}) {
  db.exec('DELETE FROM search_index');
  db.exec('DELETE FROM search_docs');
  db.exec('DELETE FROM search_fuzzy');
  db.exec('DELETE FROM search_fuzzy_docs');

  const sources = {
    disease: {
      sql: `SELECT d.id, d.name_en AS title, COALESCE(d.name_vi,'') AS vi,
              COALESCE(d.definition,'') AS def, COALESCE(d.mondo_id,'') AS code,
              COALESCE(c.name_vi,'') AS cat,
              (SELECT group_concat(name, ' | ') FROM disease_synonyms s WHERE s.disease_id = d.id) AS syns
            FROM diseases d LEFT JOIN categories c ON c.id = d.category_id`,
      subtitle: r => [r.vi, r.code, r.cat].filter(Boolean).join(' · '),
      body: r => [r.def, r.syns].filter(Boolean).join(' ')
    },
    symptom: {
      sql: `SELECT s.id, s.name_en AS title, COALESCE(s.name_vi,'') AS vi, COALESCE(s.definition,'') AS def,
              COALESCE(s.hpo_id,'') AS code, COALESCE(s.synonyms,'') AS syns, COALESCE(s.organ_system,'') AS sys
            FROM symptoms s`,
      subtitle: r => [r.vi, r.code, r.sys].filter(Boolean).join(' · '),
      body: r => [r.def, r.syns].filter(Boolean).join(' ')
    },
    drug: {
      sql: `SELECT id, COALESCE(brand_name, generic_name) AS title, COALESCE(generic_name,'') AS vi,
              COALESCE(active_ingredients,'') AS ing, COALESCE(dosage_form,'') AS form,
              COALESCE(labeler,'') AS lab, COALESCE(product_ndc,'') AS code
            FROM drugs`,
      subtitle: r => [r.vi, r.form, r.lab].filter(Boolean).join(' · '),
      body: r => [r.ing, r.code, r.lab].filter(Boolean).join(' ')
    },
    anatomy: {
      sql: `SELECT id, name_en AS title, COALESCE(name_vi,'') AS vi, COALESCE(definition,'') AS def,
              COALESCE(uberon_id,'') AS code, COALESCE(systems,'') AS sys FROM anatomy`,
      subtitle: r => [r.vi, r.code, r.sys].filter(Boolean).join(' · '),
      body: r => r.def || ''
    },
    organism: {
      sql: `SELECT id, name_scientific AS title, COALESCE(name_common,'') AS vi, COALESCE(lineage,'') AS lin,
              COALESCE(rank,'') AS rank, COALESCE(kingdom,'') AS kingdom FROM microorganisms`,
      subtitle: r => [r.vi, r.rank, r.kingdom].filter(Boolean).join(' · '),
      body: r => r.lin || ''
    },
    lab: {
      sql: `SELECT id, name_en AS title, COALESCE(name_vi,'') AS vi, COALESCE(purpose,'') AS purpose,
              COALESCE(clinical_significance,'') AS sig FROM laboratory_tests`,
      subtitle: r => r.vi || '',
      body: r => [r.purpose, r.sig].filter(Boolean).join(' ')
    },
    gene: {
      sql: `SELECT id, symbol AS title, COALESCE(name,'') AS nm, COALESCE(summary,'') AS sum,
              COALESCE(chromosome,'') AS chr, COALESCE(location,'') AS loc,
              COALESCE(gene_type,'') AS typ, COALESCE(aliases,'') AS aliases,
              COALESCE(db_xrefs,'') AS xrefs, COALESCE(ncbi_gene_id,'') AS nid FROM genes`,
      subtitle: r => [r.nm, r.chr, r.loc, r.typ].filter(Boolean).join(' · '),
      body: r => [r.sum, r.aliases, r.xrefs].filter(Boolean).join(' ')
    },
    trial: {
      sql: `SELECT id, title, COALESCE(conditions,'') AS cond, COALESCE(interventions,'') AS intv,
              COALESCE(nct_id,'') AS nct, COALESCE(summary,'') AS summary FROM clinical_trials`,
      subtitle: r => [r.nct, r.cond].filter(Boolean).join(' · '),
      body: r => [r.intv, r.summary].filter(Boolean).join(' ')
    }
  };

  const insertDoc = db.prepare('INSERT INTO search_docs (entity_type, entity_id) VALUES (?, ?)');
  const insertIdx = db.prepare('INSERT INTO search_index (rowid, title, subtitle, body) VALUES (?, ?, ?, ?)');
  const insertFuzzyDoc = db.prepare('INSERT INTO search_fuzzy_docs (entity_type, entity_id) VALUES (?, ?)');
  const insertFuzzy = db.prepare('INSERT INTO search_fuzzy (rowid, title) VALUES (?, ?)');

  for (const [type, cfg] of Object.entries(sources)) {
    const rows = db.prepare(cfg.sql).all();
    db.exec('BEGIN');
    for (const r of rows) {
      const title = r.title || '';
      const subtitle = cfg.subtitle(r);
      const info = insertDoc.run(type, r.id);
      insertIdx.run(info.lastInsertRowid, fold(title), fold(subtitle), fold(cfg.body(r)));
      const fInfo = insertFuzzyDoc.run(type, r.id);
      insertFuzzy.run(fInfo.lastInsertRowid, fold(title));
    }
    db.exec('COMMIT');
    log(`Đã lập chỉ mục ${rows.length.toLocaleString('vi-VN')} ${type}`);
  }
}

function recordLog(db, jobId, sourceSlug, level, message) {
  db.prepare('INSERT INTO data_update_logs (job_id, source_slug, level, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(jobId || null, sourceSlug || null, level, message, new Date().toISOString());
}

module.exports = {
  ROOT, DB_PATH, open, fold, slugify, init, SCHEMA, CATEGORY_SEED, SOURCE_SEED,
  setMeta, getMeta, indexEntities, rebuildSearch, recordLog, SEARCH_ENTITIES
};
