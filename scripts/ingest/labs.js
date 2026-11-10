'use strict';
/**
 * Medical laboratory encyclopedia seed from MedlinePlus (U.S. National Library of Medicine).
 * MedlinePlus content is public domain. Only sourced summaries are stored;
 * reference ranges are deliberately NOT fabricated: they depend on the laboratory.
 */
const db = require('../../server/db');
const { httpGet, startJob, finishJob, recordLog, sleep } = require('./lib');

const TESTS = [
  ['Complete blood count (CBC)', 'complete blood count'],
  ['Basic metabolic panel (BMP)', 'basic metabolic panel'],
  ['Comprehensive metabolic panel', 'comprehensive metabolic panel'],
  ['Blood glucose test', 'blood glucose test'],
  ['Hemoglobin A1c (HbA1c)', 'hemoglobin A1c'],
  ['Lipid panel', 'cholesterol levels'],
  ['Thyroid stimulating hormone (TSH)', 'thyroid tests'],
  ['Thyroxine (T4) and triiodothyronine (T3)', 'thyroid tests'],
  ['Liver function tests', 'liver function tests'],
  ['Kidney function tests', 'kidney function tests'],
  ['Urinalysis', 'urinalysis'],
  ['Urine culture', 'urine culture'],
  ['Blood culture', 'blood culture'],
  ['C-reactive protein (CRP)', 'C-reactive protein'],
  ['Erythrocyte sedimentation rate (ESR)', 'erythrocyte sedimentation rate'],
  ['Prothrombin time (PT) and INR', 'prothrombin time'],
  ['Activated partial thromboplastin time (aPTT)', 'partial thromboplastin time'],
  ['D-dimer', 'D-dimer'],
  ['Troponin test', 'troponin test'],
  ['Brain natriuretic peptide (BNP)', 'natriuretic peptide tests'],
  ['Electrolyte panel', 'electrolyte panel'],
  ['Arterial blood gas (ABG)', 'blood gases'],
  ['Pulse oximetry', 'pulse oximetry'],
  ['Spirometry', 'spirometry'],
  ['Sweat chloride test', 'sweat chloride test'],
  ['Allergy blood test (IgE)', 'allergy blood test'],
  ['Antinuclear antibody (ANA)', 'ANA antibody test'],
  ['Rheumatoid factor', 'rheumatoid factor'],
  ['HIV test', 'HIV tests'],
  ['Hepatitis B blood test', 'hepatitis B test'],
  ['Hepatitis C blood test', 'hepatitis C test'],
  ['Tuberculosis test', 'tuberculosis test'],
  ['COVID-19 test', 'COVID-19 testing'],
  ['Strep throat test', 'strep throat test'],
  ['Sexually transmitted infection tests', 'sexually transmitted infections'],
  ['Pap test', 'pap test'],
  ['Human papillomavirus (HPV) test', 'HPV test'],
  ['Pregnancy test', 'pregnancy test'],
  ['Ferritin test', 'ferritin test'],
  ['Vitamin B12 test', 'vitamin B12 test'],
  ['Vitamin D test', 'vitamin D test'],
  ['Folate test', 'folate deficiency'],
  ['Iron tests', 'iron tests'],
  ['Amylase and lipase tests', 'amylase test'],
  ['Bilirubin test', 'bilirubin test'],
  ['Uric acid test', 'uric acid test'],
  ['Creatine kinase (CK)', 'creatine kinase test'],
  ['Lactate dehydrogenase (LDH)', 'LDH test'],
  ['Cortisol test', 'cortisol test'],
  ['Testosterone test', 'testosterone test'],
  ['Estrogen test', 'estrogen test'],
  ['Prostate-specific antigen (PSA)', 'PSA test'],
  ['CA-125 test', 'CA-125 blood test'],
  ['Alpha-fetoprotein (AFP) test', 'alpha fetoprotein test'],
  ['Newborn screening', 'newborn screening'],
  ['Genetic testing', 'genetic testing'],
  ['Karyotype', 'karyotype test'],
  ['Biopsy', 'biopsy'],
  ['Cerebrospinal fluid (CSF) analysis', 'cerebrospinal fluid analysis'],
  ['Bone marrow test', 'bone marrow diseases'],
  ['Glucose tolerance test', 'glucose tolerance test'],
  ['Anion gap', 'anion gap'],
  ['Osmolality test', 'osmolality test'],
  ['Fecal occult blood test', 'fecal occult blood test'],
  ['Helicobacter pylori test', 'H. pylori infection'],
  ['Drug testing', 'drug testing'],
  ['Therapeutic drug monitoring', 'therapeutic drug monitoring']
];

function decodeHtml(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function stripHtml(text) {
  return decodeHtml(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseResults(xml) {
  const docs = [];
  for (const m of xml.matchAll(/<document rank="\d+" url="([^"]+)">([\s\S]*?)<\/document>/g)) {
    const url = decodeHtml(m[1]);
    const body = m[2];
    const titleMatch = body.match(/<content name="title">([\s\S]*?)<\/content>/);
    const summaryMatch = body.match(/<content name="FullSummary">([\s\S]*?)<\/content>/);
    if (!titleMatch) continue;
    docs.push({
      url,
      title: stripHtml(titleMatch[1]),
      summary: summaryMatch ? stripHtml(summaryMatch[1]) : null
    });
  }
  return docs;
}

async function run() {
  const conn = db.open();
  const jobId = startJob(conn, 'medlineplus', 'Lấy thông tin xét nghiệm từ MedlinePlus');
  try {
    const upsert = conn.prepare(`
      INSERT INTO laboratory_tests (slug, name_en, purpose, specimen, method, unit, reference_note,
        clinical_significance, related_conditions, source_slug, source_url, retrieved_at, search_text)
      VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, 'medlineplus', ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET name_en=excluded.name_en, purpose=excluded.purpose,
        reference_note=excluded.reference_note, source_url=excluded.source_url, retrieved_at=excluded.retrieved_at,
        search_text=excluded.search_text
    `);
    const now = new Date().toISOString();
    const REFERENCE_NOTE = 'Khoảng tham chiếu phụ thuộc phòng xét nghiệm, phương pháp đo, đơn vị và nhóm đối tượng (tuổi, giới, thai kỳ). Nền tảng không công bố một khoảng tham chiếu chung khi chưa có dữ liệu đã xác thực từ phòng xét nghiệm.';
    let upserted = 0, seen = 0, errors = 0;

    for (const [name, query] of TESTS) {
      seen++;
      try {
        const xml = await httpGet(
          `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&rettype=all&retmax=3&term=${encodeURIComponent(query)}`,
          { label: `MedlinePlus: ${query}`, retries: 2 }
        );
        const docs = parseResults(xml).filter(d => d.summary);
        if (!docs.length) { recordLog(conn, jobId, 'medlineplus', 'error', `Không có nội dung cho "${name}"`); errors++; continue; }
        const best = docs[0];
        upsert.run(
          db.slugify(name), name, best.summary, REFERENCE_NOTE, best.url, now,
          db.fold([name, best.summary, query].filter(Boolean).join(' '))
        );
        upserted++;
      } catch (err) {
        errors++;
        recordLog(conn, jobId, 'medlineplus', 'error', `${name}: ${err.message}`);
      }
      await sleep(250);
    }

    db.setMeta(conn, 'lab_test_count', upserted);
    finishJob(conn, jobId, 'medlineplus', 'success', { seen, upserted, skipped: seen - upserted, errors },
      `Đã nhập ${upserted} xét nghiệm từ MedlinePlus`);
  } catch (err) {
    recordLog(conn, jobId, 'medlineplus', 'error', err.message);
    finishJob(conn, jobId, 'medlineplus', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run, TESTS };

if (require.main === module) {
  run().then(() => console.log('MedlinePlus labs xong')).catch(err => { console.error(err); process.exit(1); });
}
