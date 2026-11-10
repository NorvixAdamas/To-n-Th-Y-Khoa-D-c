/**
 * Read-only client data layer for the static edition.
 * It replaces the Node/SQLite API with compressed build-time snapshots.
 */

import { DATA_VERSION } from './runtime-config.js';

const DATA_BASE = new URL('../data/', import.meta.url);
const cache = new Map();

function fetchGzipJson(name) {
  if (cache.has(name)) return cache.get(name);
  const promise = (async () => {
    const res = await fetch(new URL(`${name}.json.gz?v=${encodeURIComponent(DATA_VERSION)}`, DATA_BASE), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Không tải được gói dữ liệu ${name} (HTTP ${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let text;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Trình duyệt này không hỗ trợ giải nén dữ liệu tĩnh. Hãy dùng Chrome, Edge, Firefox hoặc Safari mới.');
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(bytes);
    }
    return JSON.parse(text);
  })().catch(err => { cache.delete(name); throw err; });
  cache.set(name, promise);
  return promise;
}

/** Fold Vietnamese text to a diacritic-free, lowercase, searchable form. */
export function fold(input) {
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

function pageResult(rows, page, pageSize) {
  const current = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 24);
  const total = rows.length;
  return { total, page: current, pageSize: size, results: rows.slice((current - 1) * size, current * size) };
}

function byName(a, b) { return String(a || '').localeCompare(String(b || ''), 'en'); }
function textMatch(row, folded) { return !folded || String(row.search_fold || '').includes(folded); }

function countBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].map(([name, c]) => ({ name, c })).sort((a, b) => b.c - a.c || byName(a.name, b.name));
}

/* ------------------------------------------------------------------ */
/* Indexes                                                            */
/* ------------------------------------------------------------------ */

const idx = {};

async function getDiseases() {
  if (!idx.diseases) {
    const rows = await fetchGzipJson('diseases');
    idx.diseases = rows;
    idx.diseaseById = new Map(rows.map(r => [r.id, r]));
    idx.diseaseBySlug = new Map();
    for (const r of rows) {
      for (const key of [r.slug, r.mondo_id, r.orphanet_code]) if (key && !idx.diseaseBySlug.has(key)) idx.diseaseBySlug.set(key, r);
    }
  }
  return idx.diseases;
}

async function getSymptoms() {
  if (!idx.symptoms) {
    const rows = await fetchGzipJson('symptoms');
    idx.symptoms = rows;
    idx.symptomById = new Map(rows.map(r => [r.id, r]));
    idx.symptomBySlug = new Map();
    for (const r of rows) {
      for (const key of [r.slug, r.hpo_id]) if (key && !idx.symptomBySlug.has(key)) idx.symptomBySlug.set(key, r);
    }
  }
  return idx.symptoms;
}

async function getDrugs() {
  if (!idx.drugs) {
    const rows = await fetchGzipJson('drugs');
    idx.drugs = rows;
    idx.drugById = new Map(rows.map(r => [r.id, r]));
    idx.drugBySlug = new Map();
    for (const r of rows) {
      for (const key of [r.slug, r.product_ndc]) if (key && !idx.drugBySlug.has(key)) idx.drugBySlug.set(key, r);
    }
  }
  return idx.drugs;
}

async function getAnatomyRows() {
  if (!idx.anatomy) {
    const rows = await fetchGzipJson('anatomy');
    idx.anatomy = rows;
    idx.anatomyById = new Map(rows.map(r => [r.id, r]));
    idx.anatomyBySlug = new Map();
    for (const r of rows) {
      for (const key of [r.slug, r.uberon_id]) if (key && !idx.anatomyBySlug.has(key)) idx.anatomyBySlug.set(key, r);
    }
  }
  return idx.anatomy;
}

async function getLabs() {
  if (!idx.labs) {
    idx.labs = await fetchGzipJson('labs');
    idx.labById = new Map(idx.labs.map(r => [r.id, r]));
    idx.labBySlug = new Map(idx.labs.map(r => [r.slug, r]));
  }
  return idx.labs;
}

async function getOrganisms() {
  if (!idx.organisms) {
    const rows = await fetchGzipJson('organisms');
    idx.organisms = rows;
    idx.organismById = new Map(rows.map(r => [r.id, r]));
    idx.organismBySlug = new Map();
    for (const r of rows) {
      for (const key of [r.slug, r.taxid && String(r.taxid)]) if (key && !idx.organismBySlug.has(key)) idx.organismBySlug.set(key, r);
    }
  }
  return idx.organisms;
}

async function getGenes() {
  if (!idx.genes) {
    const rows = await fetchGzipJson('genes');
    idx.genes = rows;
    idx.geneById = new Map(rows.map(r => [r.id, r]));
    idx.geneBySlug = new Map();
    for (const r of rows) {
      for (const key of [r.slug, r.symbol, r.ncbi_gene_id]) if (key && !idx.geneBySlug.has(key)) idx.geneBySlug.set(key, r);
    }
  }
  return idx.genes;
}

async function getIcd() {
  if (!idx.icd) idx.icd = await fetchGzipJson('icd');
  return idx.icd;
}

async function getDiseaseRelations() {
  if (idx.diseaseRelations) return idx.diseaseRelations;
  const rows = await fetchGzipJson('disease_relations');
  const byDisease = new Map();
  const bySymptom = new Map();
  for (const r of rows.diseaseSymptoms) {
    if (!byDisease.has(r[0])) byDisease.set(r[0], []);
    if (!bySymptom.has(r[1])) bySymptom.set(r[1], []);
    byDisease.get(r[0]).push(r);
    bySymptom.get(r[1]).push(r);
  }
  const identifiers = new Map();
  for (const r of rows.identifiers) {
    if (!identifiers.has(r[0])) identifiers.set(r[0], []);
    identifiers.get(r[0]).push({ scheme: r[1], value: r[2], source_slug: r[3] });
  }
  const synonyms = new Map();
  for (const r of rows.synonyms) {
    if (!synonyms.has(r[0])) synonyms.set(r[0], []);
    synonyms.get(r[0]).push({ name: r[1], lang: r[2], scope: r[3], source_slug: r[4] });
  }
  const parents = new Map();
  const children = new Map();
  for (const [diseaseId, parentId] of rows.parents) {
    if (!parents.has(diseaseId)) parents.set(diseaseId, []);
    if (!children.has(parentId)) children.set(parentId, []);
    parents.get(diseaseId).push(parentId);
    children.get(parentId).push(diseaseId);
  }
  const diseaseGenes = new Map();
  for (const r of rows.diseaseGenes) {
    if (!diseaseGenes.has(r[0])) diseaseGenes.set(r[0], []);
    diseaseGenes.get(r[0]).push({ gene_id: r[1], association_type: r[2], gene: r[3] || null });
  }
  const organismDiseases = new Map();
  for (const r of rows.organismDiseases) {
    if (!organismDiseases.has(r[0])) organismDiseases.set(r[0], []);
    organismDiseases.get(r[0]).push({ disease_id: r[1], source_slug: r[2] });
  }
  idx.diseaseRelations = { raw: rows, byDisease, bySymptom, identifiers, synonyms, parents, children, diseaseGenes, organismDiseases };
  return idx.diseaseRelations;
}

async function getGeneRelations() {
  if (idx.geneRelations) return idx.geneRelations;
  const rows = await fetchGzipJson('gene_relations');
  const summaries = new Map(rows.summaries);
  const aliases = new Map();
  const diseases = new Map();
  const pathways = new Map();
  const proteins = new Map();
  const pathwayById = new Map(rows.pathways.map(p => [p.id, p]));
  for (const [geneId, alias] of rows.aliases) {
    if (!aliases.has(geneId)) aliases.set(geneId, []);
    aliases.get(geneId).push(alias);
  }
  for (const r of rows.diseases) {
    if (!diseases.has(r.gene_id)) diseases.set(r.gene_id, []);
    diseases.get(r.gene_id).push({
      slug: r.slug, name_en: r.name_en, name_vi: r.name_vi,
      orphanet_code: r.orphanet_code, association_type: r.association_type
    });
  }
  for (const r of rows.genePathways) {
    if (!pathways.has(r[0])) pathways.set(r[0], []);
    pathways.get(r[0]).push({ pathway_id: r[1], evidence: r[2] });
  }
  for (const r of rows.proteins) {
    if (!proteins.has(r[0])) proteins.set(r[0], []);
    proteins.get(r[0]).push({ uniprot_id: r[1], name: r[2], length: r[3], function: r[4], subcellular: r[5], url: r[6] });
  }
  idx.geneRelations = { raw: rows, summaries, aliases, pathways, proteins, pathwayById, diseases };
  return idx.geneRelations;
}

/* ------------------------------------------------------------------ */
/* Stats and lists                                                    */
/* ------------------------------------------------------------------ */

export async function getStats() {
  if (!idx.catalog) idx.catalog = await fetchGzipJson('catalog');
  return idx.catalog;
}

export async function listDiseases({ q = '', category = '', rare = '', page = 1, pageSize = 24, sort = 'name' } = {}) {
  const rows = await getDiseases();
  const folded = fold(q);
  let out = rows.filter(d =>
    (!category || d.category_slug === category) &&
    (!(rare === '1' || rare === true) || d.is_rare) &&
    textMatch(d, folded)
  );
  if (sort === 'recent') out = out.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || byName(a.name_en, b.name_en));
  else if (sort === 'symptoms') out = out.slice().sort((a, b) => (b.symptom_count || 0) - (a.symptom_count || 0) || byName(a.name_en, b.name_en));
  else out = out.slice().sort((a, b) => byName(a.name_en, b.name_en));
  const paged = pageResult(out, page, pageSize);
  paged.results = paged.results.map(d => ({ ...d, excerpt: (d.definition || '').slice(0, 240) }));
  return paged;
}

export async function listSymptoms({ q = '', system = '', page = 1, pageSize = 30 } = {}) {
  const rows = await getSymptoms();
  const folded = fold(q);
  const filtered = rows.filter(s => (!system || s.organ_system === system) && textMatch(s, folded));
  filtered.sort((a, b) => (b.disease_count || 0) - (a.disease_count || 0) || byName(a.name_en, b.name_en));
  const result = pageResult(filtered, page, pageSize);
  result.systems = countBy(rows, 'organ_system').slice(0, 40);
  return result;
}

export async function listAnatomy({ q = '', system = '', page = 1, pageSize = 30 } = {}) {
  const rows = await getAnatomyRows();
  const folded = fold(q);
  const filtered = rows.filter(a => (!system || a.systems === system) && textMatch(a, folded));
  filtered.sort((a, b) => byName(a.name_en, b.name_en));
  const result = pageResult(filtered, page, pageSize);
  result.results = result.results.map(a => ({ ...a, excerpt: (a.definition || '').slice(0, 240) }));
  result.systems = countBy(rows, 'systems').slice(0, 30);
  return result;
}

export async function listDrugs({ q = '', ingredient = '', form = '', labeler = '', page = 1, pageSize = 24 } = {}) {
  const rows = await getDrugs();
  const folded = fold(q);
  const ing = String(ingredient || '').toLowerCase();
  const filtered = rows.filter(d =>
    textMatch(d, folded) &&
    (!ing || String(d.active_ingredients || '').toLowerCase().includes(ing)) &&
    (!form || d.dosage_form === form) &&
    (!labeler || d.labeler === labeler)
  );
  filtered.sort((a, b) => byName(a.brand_name || a.generic_name, b.brand_name || b.generic_name));
  const result = pageResult(filtered, page, pageSize);
  result.forms = countBy(rows, 'dosage_form').slice(0, 25);
  result.labelers = countBy(rows, 'labeler').slice(0, 25);
  return result;
}

export async function listLabs({ q = '', page = 1, pageSize = 30 } = {}) {
  const rows = await getLabs();
  const folded = fold(q);
  const filtered = rows.filter(l => textMatch(l, folded)).sort((a, b) => byName(a.name_en, b.name_en));
  const result = pageResult(filtered, page, pageSize);
  result.results = result.results.map(l => ({ ...l, excerpt: (l.purpose || '').slice(0, 260) }));
  return result;
}

export async function listOrganisms({ q = '', kingdom = '', page = 1, pageSize = 30 } = {}) {
  const rows = await getOrganisms();
  const folded = fold(q);
  const filtered = rows.filter(m => (!kingdom || m.kingdom === kingdom) && textMatch(m, folded));
  filtered.sort((a, b) => byName(a.name_scientific, b.name_scientific));
  const result = pageResult(filtered, page, pageSize);
  result.kingdoms = countBy(rows, 'kingdom');
  return result;
}

export async function listGenes({ q = '', page = 1, pageSize = 30 } = {}) {
  const rows = await getGenes();
  const folded = fold(q);
  const filtered = rows.filter(g => textMatch(g, folded)).sort((a, b) => byName(a.symbol, b.symbol));
  return pageResult(filtered, page, pageSize);
}

export async function listCodes({ q = '', chapter = '', page = 1, pageSize = 50 } = {}) {
  const rows = await getIcd();
  const term = String(q || '').trim();
  const filtered = rows.filter(r => (!chapter || r.chapter === chapter) &&
    (!term || r.code.toLowerCase().startsWith(term.toLowerCase()) || String(r.title || '').toLowerCase().includes(term.toLowerCase())));
  filtered.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const result = pageResult(filtered, page, pageSize);
  const chapters = new Map();
  for (const r of rows) if (r.chapter) chapters.set(r.chapter, (chapters.get(r.chapter) || 0) + 1);
  result.chapters = [...chapters.entries()].map(([chapter, c]) => ({ chapter, c })).sort((a, b) => String(a.chapter).localeCompare(String(b.chapter)));
  return result;
}

/* ------------------------------------------------------------------ */
/* Detail records                                                     */
/* ------------------------------------------------------------------ */

async function relatedDiseases(id, rel, diseasesById) {
  if (!idx.relatedCache) idx.relatedCache = new Map();
  if (idx.relatedCache.has(id)) return idx.relatedCache.get(id);
  const target = rel.byDisease.get(id) || [];
  const counts = new Map();
  for (const link of target) {
    for (const other of rel.bySymptom.get(link[1]) || []) {
      if (other[0] === id) continue;
      counts.set(other[0], (counts.get(other[0]) || 0) + 1);
    }
  }
  const out = [...counts.entries()]
    .map(([otherId, shared]) => {
      const d = diseasesById.get(otherId);
      return d ? { id: d.id, slug: d.slug, name_en: d.name_en, orphanet_code: d.orphanet_code, shared } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.shared - a.shared || byName(a.name_en, b.name_en))
    .slice(0, 8);
  idx.relatedCache.set(id, out);
  return out;
}

export async function getDisease(slug) {
  const [diseases, symptoms, organisms, rel] = await Promise.all([
    getDiseases(), getSymptoms(), getOrganisms(), getDiseaseRelations()
  ]);
  const d = idx.diseaseBySlug.get(slug);
  if (!d) return null;
  const id = d.id;
  const symptomRows = (rel.byDisease.get(id) || [])
    .map(r => {
      const s = idx.symptomById.get(r[1]);
      return s ? {
        id: s.id, slug: s.slug, hpo_id: s.hpo_id, name_en: s.name_en, name_vi: s.name_vi,
        organ_system: s.organ_system, frequency_text: r[2], frequency_ratio: r[3],
        onset: r[4], evidence: r[5], source_slug: r[6]
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.frequency_ratio ?? -1) - (a.frequency_ratio ?? -1) || byName(a.name_en, b.name_en))
    .slice(0, 120);
  const geneRows = (rel.diseaseGenes.get(id) || []).map(r => {
    const g = r.gene || null;
    return g ? {
      symbol: g.symbol, name: g.name, chromosome: g.chromosome, location: g.location,
      ncbi_gene_id: g.ncbi_gene_id, association_type: r[2], slug: g.slug
    } : null;
  }).filter(Boolean).sort((a, b) => byName(a.symbol, b.symbol));
  // organismDiseases is keyed by organism id; build the disease-side list directly.
  const organismDiseaseRows = [];
  for (const [organismId, links] of rel.organismDiseases) {
    if (links.some(x => x.disease_id === id)) {
      const m = idx.organismById.get(organismId);
      if (m) organismDiseaseRows.push({ slug: m.slug, name_scientific: m.name_scientific, name_common: m.name_common, rank: m.rank, taxid: m.taxid, kingdom: m.kingdom });
    }
  }
  const parents = (rel.parents.get(id) || []).map(pid => idx.diseaseById.get(pid)).filter(Boolean)
    .map(p => ({ id: p.id, slug: p.slug, name_en: p.name_en, mondo_id: p.mondo_id })).slice(0, 12);
  const children = (rel.children.get(id) || []).map(cid => idx.diseaseById.get(cid)).filter(Boolean)
    .map(c => ({ id: c.id, slug: c.slug, name_en: c.name_en, mondo_id: c.mondo_id })).slice(0, 12);
  const symptomsSources = new Set(symptomRows.map(s => s.source_slug).filter(Boolean));
  const sources = [];
  if (d.mondo_id) sources.push({ slug: 'mondo', label: 'MONDO Disease Ontology', url: `https://monarchinitiative.org/${d.mondo_id}`, license: 'CC BY 4.0' });
  if (d.orphanet_code) sources.push({ slug: 'orphadata', label: 'Orphanet / Orphadata', url: `https://www.orpha.net/en/disease/detail/${d.orphanet_code}`, license: 'CC BY 4.0' });
  if (symptomsSources.has('hpo')) sources.push({ slug: 'hpo', label: 'Human Phenotype Ontology', url: 'https://hpo.jax.org/', license: 'CC BY 4.0' });
  if (symptomsSources.has('orphadata')) sources.push({ slug: 'orphadata_phenotypes', label: 'Orphadata phenotypes', url: 'https://www.orphadata.com/', license: 'CC BY 4.0' });
  if (d.doid) sources.push({ slug: 'doid', label: 'Human Disease Ontology (DOID)', url: `https://disease-ontology.org/term/DOID:${d.doid}/`, license: 'CC0 1.0' });
  if (d.icd10) sources.push({ slug: 'icd10cm', label: 'ICD-10-CM (CMS)', url: 'https://www.cms.gov/medicare/coding-billing/icd-10-codes', license: 'Public domain' });
  if (geneRows.length) sources.push({ slug: 'orphadata', label: 'Orphanet gene-disease associations', url: 'https://www.orpha.net/', license: 'CC BY 4.0' });
  return {
    ...d,
    identifiers: rel.identifiers.get(id) || [],
    synonyms: (rel.synonyms.get(id) || []).slice(0, 80),
    symptoms: symptomRows,
    genes: geneRows,
    organisms: organismDiseaseRows.slice(0, 20),
    parents,
    children,
    related: await relatedDiseases(id, rel, idx.diseaseById),
    sources
  };
}

export async function getSymptom(slug) {
  const [symptoms, diseases, rel] = await Promise.all([getSymptoms(), getDiseases(), getDiseaseRelations()]);
  const s = idx.symptomBySlug.get(slug);
  if (!s) return null;
  const diseaseRows = (rel.bySymptom.get(s.id) || []).map(r => {
    const d = idx.diseaseById.get(r[0]);
    return d ? {
      id: d.id, slug: d.slug, name_en: d.name_en, name_vi: d.name_vi, orphanet_code: d.orphanet_code,
      is_rare: d.is_rare, frequency_text: r[2], frequency_ratio: r[3], evidence: r[5], source_slug: r[6], category_vi: d.category_vi
    } : null;
  }).filter(Boolean)
    .sort((a, b) => (b.frequency_ratio ?? -1) - (a.frequency_ratio ?? -1) || byName(a.name_en, b.name_en))
    .slice(0, 100);
  const counts = new Map();
  for (const link of rel.bySymptom.get(s.id) || []) {
    for (const other of rel.byDisease.get(link[0]) || []) {
      if (other[1] === s.id) continue;
      counts.set(other[1], (counts.get(other[1]) || 0) + 1);
    }
  }
  const cooccurring = [...counts.entries()].map(([sid, shared]) => {
    const x = idx.symptomById.get(sid);
    return x ? { id: x.id, slug: x.slug, name_en: x.name_en, name_vi: x.name_vi, hpo_id: x.hpo_id, organ_system: x.organ_system, shared } : null;
  }).filter(Boolean).sort((a, b) => b.shared - a.shared || byName(a.name_en, b.name_en)).slice(0, 16);
  return {
    ...s, diseases: diseaseRows, cooccurring,
    sources: [{ label: s.source_slug === 'orphadata' ? 'Orphanet / Orphadata' : 'Human Phenotype Ontology (HPO)', url: s.source_url, license: 'CC BY 4.0' }]
  };
}

export async function getAnatomy(slug) {
  const rows = await getAnatomyRows();
  const a = idx.anatomyBySlug.get(slug);
  if (!a) return null;
  const children = a.uberon_id ? rows.filter(x => x.parent_uberon === a.uberon_id).slice(0, 40)
    .map(x => ({ slug: x.slug, name_en: x.name_en, uberon_id: x.uberon_id })) : [];
  const parent = a.parent_uberon ? rows.find(x => x.uberon_id === a.parent_uberon) || null : null;
  return {
    ...a, children: children,
    parent: parent ? { slug: parent.slug, name_en: parent.name_en, uberon_id: parent.uberon_id } : null,
    sources: [{ label: 'Uberon Anatomy Ontology', url: 'https://www.ebi.ac.uk/ols4/ontologies/uberon', license: 'CC BY 3.0' }]
  };
}

export async function getDrug(slug) {
  await getDrugs();
  const d = idx.drugBySlug.get(slug);
  if (!d) return null;
  const alternatives = d.generic_name
    ? idx.drugs.filter(x => x.generic_name === d.generic_name && x.id !== d.id).slice(0, 8)
      .map(x => ({ slug: x.slug, brand_name: x.brand_name, product_ndc: x.product_ndc, dosage_form: x.dosage_form, labeler: x.labeler }))
    : [];
  return {
    ...d, label: null, alternatives,
    sources: [
      { label: 'openFDA NDC Directory', url: d.source_url, license: 'Public domain' },
      { label: 'DailyMed (nhãn thuốc, khi có)', url: 'https://dailymed.nlm.nih.gov/', license: 'Public domain' }
    ]
  };
}

export async function getLab(slug) {
  await getLabs();
  const l = idx.labBySlug.get(slug);
  if (!l) return null;
  return { ...l, sources: [{ label: 'MedlinePlus — U.S. National Library of Medicine', url: l.source_url, license: 'Public domain' }] };
}

export async function getOrganism(slug) {
  const [organisms, diseases, rel] = await Promise.all([getOrganisms(), getDiseases(), getDiseaseRelations()]);
  const m = idx.organismBySlug.get(slug);
  if (!m) return null;
  const diseaseRows = (rel.organismDiseases.get(m.id) || []).map(r => {
    const d = idx.diseaseById.get(r.disease_id);
    return d ? { slug: d.slug, name_en: d.name_en, name_vi: d.name_vi, orphanet_code: d.orphanet_code, source_slug: r.source_slug } : null;
  }).filter(Boolean).slice(0, 60);
  return {
    ...m, diseases: diseaseRows,
    sources: [{ label: 'NCBI Taxonomy', url: m.source_url, license: 'Public domain' },
      { label: 'MONDO (liên kết tác nhân)', url: 'https://monarchinitiative.org/', license: 'CC BY 4.0' }]
  };
}

export async function getGene(slug) {
  const [genes, meta] = await Promise.all([getGenes(), getGeneRelations()]);
  const g = idx.geneBySlug.get(String(slug));
  if (!g) return null;
  const diseasesForGene = meta.diseases.get(g.id) || [];
  const aliases = (meta.aliases.get(g.id) || []).slice(0, 120);
  const pathways = (meta.pathways.get(g.id) || []).map(r => {
    const p = meta.pathwayById.get(r.pathway_id);
    return p ? { reactome_id: p.reactome_id, name: p.name, url: p.url, evidence: r.evidence } : null;
  }).filter(Boolean).slice(0, 80);
  const proteins = (meta.proteins.get(g.id) || []).slice(0, 20);
  const sources = [{ label: 'Orphanet gene-disease associations', url: 'https://www.orpha.net/', license: 'CC BY 4.0' }];
  if (g.ncbi_gene_id) sources.push({ label: 'NCBI Gene', url: g.source_url || `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}`, license: 'Public domain' });
  if (pathways.length) sources.push({ label: 'Reactome pathways', url: 'https://reactome.org/', license: 'CC0 1.0' });
  if (proteins.length) sources.push({ label: 'UniProt reviewed proteins', url: 'https://www.uniprot.org/', license: 'CC BY 4.0' });
  return {
    ...g, summary: meta.summaries.get(g.id) || null, diseases: diseasesForGene.slice(0, 60),
    aliases, pathways, proteins, sources
  };
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function fuzzyToken(text, token) {
  if (text.includes(token)) return true;
  if (token.length < 4) return false;
  for (const word of text.split(' ')) {
    if (word.length < 3) continue;
    if (editDistanceAtMostOne(word, token)) return true;
  }
  return false;
}

export async function search({ q = '', type = '', page = 1, pageSize = 20 } = {}) {
  const tokens = fold(q).split(' ').filter(Boolean);
  const current = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  if (!tokens.length) return { query: q, total: 0, page: current, pageSize: size, results: [], suggestions: [], mode: 'empty', types: {} };
  const typeFilter = type || '';
  const normalized = tokens.join(' ');
  const collect = (docs) => {
    const out = [];
    for (const doc of docs) {
      if (typeFilter && doc.type !== typeFilter) continue;
      if (!tokens.every(t => doc.x.includes(t))) continue;
      let score = 0;
      const titleFold = doc.xf || '';
      for (const token of tokens) {
        const titleWords = titleFold.split(' ');
        if (titleWords.some(w => w.startsWith(token))) score += 16;
        else if (titleFold.includes(token)) score += 10;
        const sub = fold(doc.subtitle || '');
        if (sub.split(' ').some(w => w.startsWith(token))) score += 5;
        else if (sub.includes(token)) score += 2;
        score += 1;
      }
      if (normalized && titleFold === normalized) score += 40;
      out.push({ doc, score });
    }
    return out;
  };
  let docs = typeFilter === 'gene'
    ? await fetchGzipJson('search_genes')
    : await fetchGzipJson('search_core');
  let scored = collect(docs);
  let geneDocs = null;
  const looksLikeGene = !typeFilter && /^[A-Z0-9-]{2,15}$/.test(String(q).trim());
  if (!typeFilter && (looksLikeGene || !scored.length)) {
    geneDocs = await fetchGzipJson('search_genes');
    scored = scored.concat(collect(geneDocs));
  }
  let mode = 'exact';
  if (!scored.length && normalized.length >= 3) {
    const candidates = geneDocs ? docs.concat(geneDocs) : docs;
    for (const doc of candidates) {
      if (typeFilter && doc.type !== typeFilter) continue;
      const hay = `${doc.x} ${fold(doc.subtitle || '')}`;
      if (!tokens.every(t => fuzzyToken(hay, t))) continue;
      scored.push({ doc, score: 1 });
    }
    if (scored.length) mode = 'fuzzy';
  }
  scored.sort((a, b) => b.score - a.score || byName(a.doc.title, b.doc.title));
  const types = {};
  for (const { doc } of scored) types[doc.type] = (types[doc.type] || 0) + 1;
  const results = scored.slice((current - 1) * size, current * size).map(({ doc }) => {
    const { xf, x, ...hit } = doc;
    return hit;
  });
  return { query: q, total: scored.length, page: current, pageSize: size, results, mode, types };
}

export async function suggest(q, limit = 8) {
  const norm = fold(q);
  if (!norm) return [];
  const docs = await fetchGzipJson('suggest');
  const tokens = norm.split(' ');
  const last = tokens[tokens.length - 1] || '';
  const scored = [];
  for (const doc of docs) {
    const titleFold = doc.xf || '';
    const words = doc.x.split(' ');
    let score = 0;
    if (titleFold.startsWith(norm)) score += 30;
    if (words.some(w => w.startsWith(last))) score += 12;
    else if (doc.x.includes(last)) score += 4;
    if (!score) continue;
    scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score || byName(a.doc.t, b.doc.t));
  const seen = new Set();
  const out = [];
  for (const { doc } of scored) {
    const key = `${doc.y}:${doc.u}:${doc.t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: doc.t, subtitle: doc.s, type: doc.y, typeLabel: doc.l, url: doc.u });
    if (out.length >= limit) break;
  }
  return out;
}
