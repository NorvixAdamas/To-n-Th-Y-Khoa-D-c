'use strict';
/**
 * Human Phenotype Ontology ingestion.
 * - hp.obo: phenotype terms (CC BY 4.0)
 * - phenotype.hpoa: curated disease -> phenotype annotations (HPO Consortium)
 * - hp-international.obo: official translations, used when a Vietnamese term exists
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { download, parseObo, startJob, finishJob, recordLog, httpGet } = require('./lib');

const PHENOTYPIC_ABNORMALITY = 'HP:0000118';

function parseFrequency(raw) {
  if (!raw) return { text: null, ratio: null };
  const direct = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (direct) {
    const num = Number(direct[1]);
    const den = Number(direct[2]);
    if (den > 0) return { text: `${num}/${den}`, ratio: num / den };
  }
  const mapped = {
    'HP:0040280': 'Luôn gặp (100%)',
    'HP:0040281': 'Rất thường gặp (80–99%)',
    'HP:0040282': 'Thường gặp (30–79%)',
    'HP:0040283': 'Ít gặp (5–29%)',
    'HP:0040284': 'Rất hiếm (<5%)',
    'HP:0040285': 'Hiếm khi gặp (ngoại lệ)'
  };
  const code = raw.split(' ')[0];
  return { text: mapped[code] || raw.replace(/^HP:\d+\s*/, ''), ratio: null };
}

async function loadVietnamese(hpTerms) {
  const vi = new Map();
  try {
    const { file } = await download('https://purl.obolibrary.org/obo/hp/hpo-translations/hp-international.obo', 'hp-international.obo', { maxAgeHours: 168, label: 'HPO translations' });
    const terms = parseObo(fs.readFileSync(file, 'utf8'));
    for (const t of terms) {
      if (!t.id) continue;
      const viSyn = (t.synonyms || []).find(s => /^vi/.test(s.lang || ''));
      if (viSyn && viSyn.name) vi.set(t.id, viSyn.name);
    }
  } catch (err) {
    // Translation file is optional; absence must not fail the phenotype import.
  }
  return vi;
}

async function run({ force = false } = {}) {
  const conn = db.open();
  const jobId = startJob(conn, 'hpo', 'Tải HPO ontology + annotations');
  try {
    const [obo, hpoa] = await Promise.all([
      download('https://purl.obolibrary.org/obo/hp.obo', 'hp.obo', { force, maxAgeHours: 48, label: 'HPO' }),
      download('https://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa', 'phenotype.hpoa', { force, maxAgeHours: 48, label: 'HPO annotations' })
    ]);
    recordLog(conn, jobId, 'hpo', 'info', `HPO ${(obo.size / 1048576).toFixed(1)} MB, annotations ${(hpoa.size / 1048576).toFixed(1)} MB`);

    const terms = parseObo(fs.readFileSync(obo.file, 'utf8')).filter(t => t.id && t.name && !t.obsolete);
    const byId = new Map(terms.map(t => [t.id, t]));
    const viNames = await loadVietnamese(terms);
    recordLog(conn, jobId, 'hpo', 'info', `Có ${viNames.size} thuật ngữ kiểu hình với tên tiếng Việt từ HPO`);

    // Resolve organ system: first ancestor under "Phenotypic abnormality" that is itself a direct child.
    const directChildren = new Set(
      terms.filter(t => (t.isA || []).includes(PHENOTYPIC_ABNORMALITY)).map(t => t.id)
    );
    function systemOf(term) {
      let current = term;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (directChildren.has(current.id) && current.id !== PHENOTYPIC_ABNORMALITY) return current.name;
        const parents = (current.isA || []).filter(id => id.startsWith('HP:'));
        current = parents.length ? byId.get(parents[0]) : null;
      }
      return null;
    }

    const insSymptom = conn.prepare(`
      INSERT INTO symptoms (slug, hpo_id, name_en, name_vi, name_vi_status, definition, synonyms, organ_system, parent_hpo, source_slug, source_url, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hpo', ?, ?)
      ON CONFLICT(hpo_id) DO UPDATE SET name_en=excluded.name_en, name_vi=COALESCE(excluded.name_vi, symptoms.name_vi),
        definition=excluded.definition, synonyms=excluded.synonyms, organ_system=excluded.organ_system,
        parent_hpo=excluded.parent_hpo, search_text=excluded.search_text
    `);
    const getSymptom = conn.prepare('SELECT id FROM symptoms WHERE hpo_id = ?');

    const symptomIds = new Map();
    let seen = 0, upserted = 0;
    conn.exec('BEGIN');
    for (const term of terms) {
      seen++;
      const synonyms = (term.synonyms || []).map(s => s.name).filter(Boolean).slice(0, 25);
      const vi = viNames.get(term.id) || null;
      insSymptom.run(
        db.slugify(term.name, term.id.replace(':', '')),
        term.id, term.name, vi, vi ? 'hpo_official_translation' : null,
        term.def || null, synonyms.join(' | ') || null, systemOf(term),
        (term.isA || [])[0] || null,
        `https://hpo.jax.org/browse/term/${term.id}`,
        db.fold([term.name, vi, term.def, synonyms.join(' ')].filter(Boolean).join(' '))
      );
      const row = getSymptom.get(term.id);
      if (row) { symptomIds.set(term.id, row.id); upserted++; }
    }
    conn.exec('COMMIT');
    recordLog(conn, jobId, 'hpo', 'info', `Đã nhập ${upserted} thuật ngữ kiểu hình`);

    // -------- Annotations --------
    const lines = fs.readFileSync(hpoa.file, 'utf8').split(/\r?\n/);
    const findDisease = {
      OMIM: conn.prepare("SELECT disease_id FROM disease_identifiers WHERE scheme='omim' AND value=? LIMIT 1"),
      ORPHA: conn.prepare("SELECT id AS disease_id FROM diseases WHERE orphanet_code=? LIMIT 1"),
      DECIPHER: conn.prepare("SELECT disease_id FROM disease_identifiers WHERE scheme='decipher' AND value=? LIMIT 1")
    };
    const insLink = conn.prepare(`
      INSERT INTO disease_symptoms (disease_id, symptom_id, frequency_text, frequency_ratio, onset, evidence, source_slug)
      VALUES (?, ?, ?, ?, ?, ?, 'hpo')
      ON CONFLICT(disease_id, symptom_id) DO UPDATE SET
        frequency_text=COALESCE(excluded.frequency_text, disease_symptoms.frequency_text),
        frequency_ratio=COALESCE(excluded.frequency_ratio, disease_symptoms.frequency_ratio),
        onset=COALESCE(excluded.onset, disease_symptoms.onset),
        evidence=COALESCE(excluded.evidence, disease_symptoms.evidence)
    `);

    let annotations = 0, linked = 0, unmatched = 0;
    conn.exec('BEGIN');
    for (const line of lines) {
      if (!line || line.startsWith('#') || line.startsWith('database_id')) continue;
      const cols = line.split('\t');
      if (cols.length < 5) continue;
      annotations++;
      const [databaseId, , , hpoId, reference, evidence, onset, frequency] = cols;
      const symptomId = symptomIds.get(hpoId);
      if (!symptomId) continue;
      const [prefix, ...rest] = databaseId.split(':');
      const value = rest.join(':');
      const stmt = findDisease[prefix];
      if (!stmt) { unmatched++; continue; }
      const row = stmt.get(value);
      if (!row) { unmatched++; continue; }
      const freq = parseFrequency(frequency);
      insLink.run(row.disease_id, symptomId, freq.text, freq.ratio, onset || null, evidence ? `${evidence}${reference ? ' — ' + reference : ''}` : reference || null);
      linked++;
    }
    conn.exec('COMMIT');

    // Denormalised symptom frequency used by the symptom explorer.
    const totalSymptoms = conn.prepare('SELECT COUNT(*) AS c FROM symptoms').get().c;
    db.setMeta(conn, 'hpo_symptom_count', totalSymptoms);
    db.setMeta(conn, 'hpo_linked_annotations', linked);
    db.setMeta(conn, 'hpo_retrieved_at', new Date().toISOString());
    finishJob(conn, jobId, 'hpo', 'success', { seen: annotations, upserted: linked, skipped: unmatched, errors: 0 },
      `Đã liên kết ${linked.toLocaleString('vi-VN')} cặp bệnh–triệu chứng từ ${annotations.toLocaleString('vi-VN')} dòng annotation`);
  } catch (err) {
    recordLog(conn, jobId, 'hpo', 'error', err.message);
    finishJob(conn, jobId, 'hpo', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('HPO xong')).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
