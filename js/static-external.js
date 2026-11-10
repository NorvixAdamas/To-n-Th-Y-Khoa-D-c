/**
 * Browser-side access to the public research APIs used by the static edition.
 * No API keys are embedded; requests use the providers' public CORS endpoints.
 */

const UA = 'GlobalMedicalEncyclopedia/2.0 (static educational site)';
const memoCache = new Map();
const CACHE_TTL = 1000 * 60 * 20;

function cacheKey(...parts) { return parts.join('|'); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchText(url, { timeout = 25000, retries = 1, headers = {} } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { accept: '*/*', ...headers },
        signal: controller.signal,
        redirect: 'follow'
      });
      const text = await res.text();
      if (!res.ok) {
        if (attempt < retries) { await sleep(700); continue; }
        throw new Error(`Nguồn trả về HTTP ${res.status}`);
      }
      return text;
    } catch (err) {
      if (attempt >= retries) {
        if (err.name === 'AbortError') throw new Error('Nguồn phản hồi quá chậm.');
        throw err;
      }
      await sleep(700);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Không truy cập được nguồn.');
}

async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  try { return JSON.parse(text); } catch { throw new Error('Nguồn trả về dữ liệu không hợp lệ.'); }
}

function memo(key, ttl, loader) {
  const hit = memoCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = loader();
  memoCache.set(key, { at: Date.now(), value });
  return value;
}

function decodeXml(value = '') {
  const text = String(value || '');
  if (!text) return '';
  try {
    const doc = new DOMParser().parseFromString(`<div>${text}</div>`, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/* ------------------------------------------------------------------ */
/* Europe PMC                                                          */
/* ------------------------------------------------------------------ */

function normalizeEuropePmc(item) {
  return {
    source: 'europepmc',
    externalId: item.id || item.pmid || item.doi,
    pmid: item.pmid || null,
    pmcid: item.pmcid || null,
    doi: item.doi || null,
    title: decodeXml(item.title || ''),
    authors: item.authorString || '',
    journal: item.journalTitle || item.bookOrReportDetails?.publisher || '',
    year: item.pubYear || '',
    abstract: decodeXml(item.abstractText || ''),
    isOpenAccess: item.isOpenAccess === 'Y' ? 1 : 0,
    license: item.license || null,
    type: item.pubType || '',
    url: item.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/` : (item.doi ? `https://doi.org/${item.doi}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id}`),
    publicationDate: item.firstPublicationDate || item.pubYear || ''
  };
}

export async function europePmcSearch({ q, page = 1, pageSize = 20, openAccess = false, year, sort = 'relevance' }) {
  const key = cacheKey('epmc', q, page, pageSize, openAccess, year, sort);
  return memo(key, CACHE_TTL, async () => {
    if (!q || !q.trim()) return { total: 0, results: [], source: 'europepmc' };
    const parts = [`(${q})`];
    if (openAccess) parts.push('OPEN_ACCESS:Y');
    if (year) parts.push(`PUB_YEAR:${String(year).replace(/[^0-9]/g, '')}`);
    const params = new URLSearchParams({
      query: parts.join(' AND '),
      format: 'json',
      pageSize: String(pageSize),
      page: String(page),
      resultType: 'core',
      sort: sort === 'date' ? 'P_PDATE_D desc' : ''
    });
    const json = await fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`);
    return {
      source: 'europepmc',
      total: json.hitCount || 0,
      page,
      pageSize,
      results: (json.resultList?.result || []).map(normalizeEuropePmc),
      license: 'Giấy phép theo từng bài — xem trường license/nguồn gốc.',
      retrievedAt: new Date().toISOString()
    };
  });
}

/* ------------------------------------------------------------------ */
/* PubMed E-utilities                                                  */
/* ------------------------------------------------------------------ */

function xmlText(doc, selector) {
  const node = doc.querySelector(selector);
  return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

export async function pubmedSearch({ q, page = 1, pageSize = 20, openAccess = false, year, sort = 'relevance' }) {
  const key = cacheKey('pubmed', q, page, pageSize, openAccess, year, sort);
  return memo(key, CACHE_TTL, async () => {
    if (!q || !q.trim()) return { total: 0, results: [], source: 'pubmed' };
    let term = q;
    if (year) term += ` AND ${String(year).replace(/[^0-9]/g, '')}[dp]`;
    if (openAccess) term += ' AND "free full text"[sb]';
    const searchParams = new URLSearchParams({
      db: 'pubmed', term, retmode: 'json', retstart: String((page - 1) * pageSize),
      retmax: String(pageSize), sort: sort === 'date' ? 'pub_date' : 'relevance',
      tool: 'global_medical_encyclopedia'
    });
    const search = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`);
    const ids = search.esearchresult?.idlist || [];
    const total = Number(search.esearchresult?.count || 0);
    if (!ids.length) return { source: 'pubmed', total, page, pageSize, results: [], retrievedAt: new Date().toISOString() };
    const summaryParams = new URLSearchParams({ db: 'pubmed', retmode: 'json', id: ids.join(','), tool: 'global_medical_encyclopedia' });
    const summary = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`);
    await sleep(380);
    const efetchParams = new URLSearchParams({ db: 'pubmed', retmode: 'xml', id: ids.join(','), tool: 'global_medical_encyclopedia' });
    const xml = await fetchText(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${efetchParams}`, { timeout: 35000 });
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const abstracts = new Map();
    for (const article of doc.querySelectorAll('PubmedArticle')) {
      const pmid = xmlText(article, 'MedlineCitation > PMID');
      if (!pmid) continue;
      const pieces = [...article.querySelectorAll('AbstractText')].map(node => {
        const label = node.getAttribute('Label');
        return `${label ? `${label}: ` : ''}${(node.textContent || '').replace(/\s+/g, ' ').trim()}`;
      });
      abstracts.set(pmid, pieces.join(' '));
    }
    const results = ids.map(id => {
      const s = summary.result?.[id] || {};
      const articleIds = s.articleids || [];
      const doi = articleIds.find(a => a.idtype === 'doi')?.value || null;
      const pmc = articleIds.find(a => a.idtype === 'pmc')?.value || null;
      return {
        source: 'pubmed',
        externalId: id,
        pmid: id,
        pmcid: pmc,
        doi,
        title: decodeXml(s.title || ''),
        authors: (s.authors || []).slice(0, 8).map(a => a.name).join(', '),
        journal: s.fulljournalname || s.source || '',
        year: (s.pubdate || '').slice(0, 4),
        abstract: abstracts.get(id) || '',
        isOpenAccess: pmc ? 1 : 0,
        license: pmc ? 'Có bản PMC — kiểm tra giấy phép từng bài' : 'Chưa xác định',
        type: (s.pubtype || []).join(', '),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        publicationDate: s.pubdate || ''
      };
    });
    return { source: 'pubmed', total, page, pageSize, results, retrievedAt: new Date().toISOString() };
  });
}

/* ------------------------------------------------------------------ */
/* Crossref and OpenAlex                                              */
/* ------------------------------------------------------------------ */

function crossrefAbstract(raw) {
  return decodeXml(String(raw || '').replace(/<jats:[^>]+>/g, ' ').replace(/<\/jats:[^>]+>/g, ' '));
}

function normalizeCrossref(item) {
  const date = item.issued?.['date-parts']?.[0] || [];
  const authors = (item.author || []).slice(0, 8).map(a => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean).join(', ');
  const doi = item.DOI || '';
  return {
    source: 'crossref', externalId: doi || item.URL || item.title?.[0], pmid: null, pmcid: null,
    doi: doi || null, title: decodeXml((item.title || [])[0] || ''), authors,
    journal: (item['container-title'] || [])[0] || '', year: date[0] || '',
    abstract: crossrefAbstract(item.abstract), isOpenAccess: Array.isArray(item.license) && item.license.length ? 1 : 0,
    license: (item.license || []).map(l => l.URL).filter(Boolean).join(' | ') || 'Kiểm tra giấy phép tại DOI',
    type: item.type || '', url: doi ? `https://doi.org/${doi}` : (item.URL || ''),
    publicationDate: date.filter(Boolean).join('-')
  };
}

export async function crossrefSearch({ q, page = 1, pageSize = 20, year, sort = 'relevance' }) {
  const key = cacheKey('crossref', q, page, pageSize, year, sort);
  return memo(key, CACHE_TTL, async () => {
    if (!q || !q.trim()) return { total: 0, results: [], source: 'crossref' };
    const params = new URLSearchParams({
      query: q, rows: String(pageSize), offset: String((page - 1) * pageSize),
      select: 'DOI,title,author,container-title,issued,abstract,license,type,URL'
    });
    if (year) {
      const y = String(year).replace(/[^0-9]/g, '');
      if (y) params.set('filter', `from-pub-date:${y}-01-01,until-pub-date:${y}-12-31`);
    }
    if (sort === 'date') params.set('sort', 'published');
    const json = await fetchJson(`https://api.crossref.org/works?${params}`, { timeout: 30000 });
    return {
      source: 'crossref', total: json.message?.['total-results'] || 0, page, pageSize,
      results: (json.message?.items || []).map(normalizeCrossref).filter(r => r.title),
      license: 'Metadata Crossref — giấy phép từng bài theo trường license/DOI.', retrievedAt: new Date().toISOString()
    };
  });
}

function openAlexAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions || []) words[p] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 6000);
}

function normalizeOpenAlex(item) {
  const doi = String(item.doi || '').replace(/^https?:\/\/doi\.org\//i, '');
  const authors = (item.authorships || []).slice(0, 8).map(a => a.author?.display_name).filter(Boolean).join(', ');
  const location = item.primary_location || {};
  return {
    source: 'openalex', externalId: item.id || doi,
    pmid: item.ids?.pmid ? String(item.ids.pmid).replace(/\D/g, '') : null,
    pmcid: item.ids?.pmcid || null, doi: doi || null, title: item.title || item.display_name || '',
    authors, journal: location.source?.display_name || item.host_venue?.display_name || '',
    year: item.publication_year || '', abstract: openAlexAbstract(item.abstract_inverted_index),
    isOpenAccess: item.open_access?.is_oa ? 1 : 0, license: item.open_access?.license || 'Kiểm tra giấy phép tại DOI',
    type: item.type || '', url: location.landing_page_url || (doi ? `https://doi.org/${doi}` : item.id || ''),
    publicationDate: item.publication_date || ''
  };
}

export async function openAlexSearch({ q, page = 1, pageSize = 20, year, sort = 'relevance' }) {
  const key = cacheKey('openalex', q, page, pageSize, year, sort);
  return memo(key, CACHE_TTL, async () => {
    if (!q || !q.trim()) return { total: 0, results: [], source: 'openalex' };
    const params = new URLSearchParams({ search: q, 'per-page': String(pageSize), page: String(page) });
    if (year) params.set('filter', `publication_year:${String(year).replace(/[^0-9]/g, '')}`);
    if (sort === 'date') params.set('sort', 'publication_date:desc');
    const json = await fetchJson(`https://api.openalex.org/works?${params}`, { timeout: 30000 });
    return {
      source: 'openalex', total: json.meta?.count || 0, page, pageSize,
      results: (json.results || []).map(normalizeOpenAlex).filter(r => r.title),
      license: 'Metadata OpenAlex (CC0); nội dung bài theo giấy phép tại DOI.', retrievedAt: new Date().toISOString()
    };
  });
}

export async function researchSearch(opts) {
  const source = opts.source || 'all';
  if (source === 'europepmc') return europePmcSearch(opts);
  if (source === 'pubmed') return pubmedSearch(opts);
  if (source === 'crossref') return crossrefSearch(opts);
  if (source === 'openalex') return openAlexSearch(opts);
  const [epmc, pm] = await Promise.allSettled([
    europePmcSearch(opts),
    pubmedSearch({ ...opts, pageSize: Math.ceil((opts.pageSize || 20) / 2) })
  ]);
  const epmcRes = epmc.status === 'fulfilled' ? epmc.value : { total: 0, results: [], error: epmc.reason?.message };
  const pmRes = pm.status === 'fulfilled' ? pm.value : { total: 0, results: [], error: pm.reason?.message };
  const merged = [];
  const seen = new Set();
  const count = Math.max(epmcRes.results.length, pmRes.results.length);
  for (let i = 0; i < count; i++) {
    for (const r of [epmcRes.results[i], pmRes.results[i]]) {
      if (!r) continue;
      const key = r.doi || r.pmid || String(r.title || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
  }
  return {
    source: 'all', total: Math.max(epmcRes.total || 0, pmRes.total || 0), page: opts.page || 1,
    pageSize: opts.pageSize || 20, results: merged,
    warnings: [epmcRes.error && `Europe PMC: ${epmcRes.error}`, pmRes.error && `PubMed: ${pmRes.error}`].filter(Boolean),
    retrievedAt: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ */
/* ClinicalTrials.gov v2                                              */
/* ------------------------------------------------------------------ */

const TRIAL_FIELDS = [
  'protocolSection.identificationModule',
  'protocolSection.statusModule',
  'protocolSection.descriptionModule',
  'protocolSection.designModule',
  'protocolSection.armsInterventionsModule',
  'protocolSection.conditionsModule',
  'protocolSection.sponsorCollaboratorsModule',
  'protocolSection.contactsLocationsModule'
].join(',');

export function translateTrialStatus(status) {
  const map = {
    RECRUITING: 'Đang tuyển bệnh', 'NOT_YET_RECRUITING': 'Chưa tuyển',
    'ACTIVE_NOT_RECRUITING': 'Đang tiến hành, không tuyển', COMPLETED: 'Đã hoàn thành',
    ENROLLING_BY_INVITATION: 'Tuyển theo thư mời', SUSPENDED: 'Tạm dừng',
    TERMINATED: 'Đã kết thúc sớm', WITHDRAWN: 'Đã rút', UNKNOWN: 'Không rõ'
  };
  return map[status] || status || 'Không rõ';
}

function normalizeTrial(study) {
  const p = study.protocolSection || {};
  const id = p.identificationModule || {};
  const status = p.statusModule || {};
  const desc = p.descriptionModule || {};
  const design = p.designModule || {};
  const arms = (p.armsInterventionsModule?.armGroups || []).map(a => a.label).filter(Boolean);
  const interventions = (p.armsInterventionsModule?.interventions || []).map(i => [i.type, i.name].filter(Boolean).join(': '));
  const conditions = p.conditionsModule?.conditions || [];
  const sponsor = p.sponsorCollaboratorsModule?.leadSponsor?.name || null;
  const countries = [...new Set((p.contactsLocationsModule?.locations || []).map(l => l.country).filter(Boolean))];
  return {
    nctId: id.nctId || '',
    title: id.briefTitle || id.officialTitle || '',
    status: status.overallStatus || '',
    statusLabel: translateTrialStatus(status.overallStatus),
    conditions,
    interventions,
    phases: design.phases || [],
    sponsor,
    enrollment: design.enrollmentInfo?.count ?? null,
    startDate: status.startDateStruct?.date || null,
    completionDate: status.completionDateStruct?.date || null,
    countries,
    summary: desc.briefSummary || '',
    arms,
    url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : 'https://clinicaltrials.gov/',
    lastUpdate: status.lastUpdatePostDateStruct?.date || null
  };
}

export async function trialSearch({ q, status = '', country = '', page = 1, pageSize = 15, pageToken = '' }) {
  const key = cacheKey('trials', q, status, country, page, pageSize, pageToken);
  return memo(key, CACHE_TTL, async () => {
    const params = new URLSearchParams({ pageSize: String(pageSize), fields: TRIAL_FIELDS, countTotal: 'true' });
    if (q) params.set('query.term', q);
    if (status && status !== 'ALL') params.set('filter.overallStatus', status);
    if (country) params.set('query.locn', country);
    if (pageToken) params.set('pageToken', pageToken);
    const json = await fetchJson(`https://clinicaltrials.gov/api/v2/studies?${params}`, { timeout: 30000 });
    const studies = (json.studies || []).map(normalizeTrial);
    return {
      source: 'clinicaltrials', total: json.totalCount ?? studies.length, page, pageSize,
      nextPageToken: json.nextPageToken || null, results: studies, retrievedAt: new Date().toISOString()
    };
  });
}

/* ------------------------------------------------------------------ */
/* Drug label                                                          */
/* ------------------------------------------------------------------ */

const LABEL_SECTIONS = [
  ['indications', ['indications_and_usage']],
  ['contraindications', ['contraindications']],
  ['warnings', ['boxed_warning', 'warnings_and_cautions', 'warnings']],
  ['adverse_reactions', ['adverse_reactions']],
  ['drug_interactions', ['drug_interactions']],
  ['dosage_admin', ['dosage_and_administration']]
];

function joinSection(obj, keys) {
  for (const key of keys) {
    if (obj[key]) {
      const value = Array.isArray(obj[key]) ? obj[key].join('\n') : String(obj[key]);
      if (value.trim()) return value.trim();
    }
  }
  return null;
}

const labelCache = new Map();
export async function getDrugLabel(drug) {
  if (!drug || !drug.product_ndc) return null;
  if (labelCache.has(drug.product_ndc)) return labelCache.get(drug.product_ndc);
  const ndc = encodeURIComponent(drug.product_ndc);
  try {
    const json = await fetchJson(`https://api.fda.gov/drug/label.json?search=openfda.product_ndc:%22${ndc}%22&limit=1`, { timeout: 20000 });
    const label = json.results?.[0];
    if (!label) { labelCache.set(drug.product_ndc, null); return null; }
    const values = {};
    for (const [key, keys] of LABEL_SECTIONS) values[key] = joinSection(label, keys);
    const result = {
      set_id: label.set_id || null,
      effective_time: label.effective_time || null,
      ...values,
      source_url: `https://api.fda.gov/drug/label.json?search=openfda.product_ndc:%22${ndc}%22`,
      fetched_at: new Date().toISOString()
    };
    labelCache.set(drug.product_ndc, result);
    return result;
  } catch {
    return null;
  }
}
