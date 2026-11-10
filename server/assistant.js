'use strict';
/**
 * MEDICAL KNOWLEDGE AI — retrieval-grounded assistant.
 *
 * Design rules:
 *  - Every statement is derived from a database record that carries a source and a retrieval date.
 *  - Nothing is generated when the knowledge base has no matching record: the assistant says so.
 *  - No diagnosis, no dosing advice, no invented PMID/DOI/codes.
 */
const q = require('./queries');
const { researchSearch } = require('./external');

const DISCLAIMER = 'Thông tin chỉ nhằm mục đích giáo dục, không thay thế tư vấn, chẩn đoán hoặc điều trị của nhân viên y tế.';

function cleanQuestion(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function detectIntent(question) {
  const lower = q.fold(question);
  if (/\b(so sanh|so voi|versus| vs |khac nhau|phan biet)\b/.test(lower)) return 'compare';
  if (/\b(nghien cuu|bai bao|tai lieu|pubmed|clinicaltrials|thu nghiem)\b/.test(lower)) return 'research';
  if (/\b(thuoc|duoc pham|hoat chat|generic|brand|lieu)\b/.test(lower)) return 'drug';
  if (/\b(xet nghiem|lab|xet nghiem mau|chi so)\b/.test(lower)) return 'lab';
  if (/\b(gene|gen|dot bien|di truyen|protein)\b/.test(lower)) return 'gene';
  if (/\b(vi khuan|virus|nam|ky sinh|tac nhan|organism)\b/.test(lower)) return 'organism';
  if (/\b(trieu chung|dau |sot|ho |kho tho|chong mat|buon non|phat ban)\b/.test(lower)) return 'symptom';
  return 'disease';
}

function field(value, fallback = 'Chưa có dữ liệu đáng tin cậy trong kho dữ liệu.') {
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function citation(entry) {
  return { label: entry.label, url: entry.url || null, license: entry.license || null, retrievedAt: entry.retrievedAt || null };
}

function diseaseBlocks(d, context) {
  const blocks = [];
  const ids = [d.mondo_id && `MONDO:${d.mondo_id.replace('MONDO:', '')}`, d.orphanet_code && `ORPHA:${d.orphanet_code}`,
    d.icd10 && `ICD-10: ${d.icd10}`, d.doid && `DOID:${d.doid}`].filter(Boolean);
  blocks.push({ type: 'heading', text: d.name_en + (d.name_vi ? ` (${d.name_vi})` : '') });
  if (ids.length) blocks.push({ type: 'codes', items: ids });
  blocks.push({ type: 'p', text: field(d.definition, 'Nguồn dữ liệu chưa cung cấp định nghĩa cho bệnh này.') });
  blocks.push({
    type: 'facts',
    items: [
      ['Phân nhóm', field(d.category_vi)],
      ['Bệnh hiếm', d.is_rare ? 'Có (theo mã Orphanet/MONDO)' : 'Không ghi nhận trong nguồn'],
      ['Di truyền', field(d.inheritance)],
      ['Dịch tễ / tỷ lệ mắc', field(d.prevalence)]
    ]
  });
  if (d.symptoms.length) {
    blocks.push({ type: 'subheading', text: `Triệu chứng / kiểu hình đã ghi nhận (${d.symptoms.length} trong kho, hiển thị tối đa 12)` });
    blocks.push({
      type: 'list',
      items: d.symptoms.slice(0, 12).map(s => `${s.name_en}${s.frequency_text ? ` — ${s.frequency_text}` : ''}${s.hpo_id ? ` (${s.hpo_id})` : ''}`)
    });
    blocks.push({ type: 'callout', tone: 'warn', text: 'Danh sách kiểu hình là dữ liệu tham chiếu từ nguồn, không phải kết luận chẩn đoán cho bất kỳ cá nhân nào.' });
  } else {
    blocks.push({ type: 'p', text: 'Chưa có liên kết triệu chứng–bệnh đã xác thực cho bệnh này trong kho dữ liệu.' });
  }
  if (d.genes.length) blocks.push({ type: 'p', text: `Gene liên quan (nguồn Orphanet): ${d.genes.slice(0, 12).map(g => g.symbol).join(', ')}.` });
  if (d.organisms.length) blocks.push({ type: 'p', text: `Tác nhân gây bệnh được ghi nhận: ${d.organisms.map(o => o.name_scientific).join(', ')}.` });
  if (d.related.length) blocks.push({ type: 'p', text: `Bệnh có biểu hiện kiểu hình tương đồng: ${d.related.slice(0, 6).map(r => r.name_en).join(', ')}.` });
  const srcs = d.sources.map(s => citation({ ...s, retrievedAt: d.retrieved_at }));
  if (d.sources.length) blocks.push({ type: 'sources', items: srcs });
  const permission = context?.includeResearch
    ? null
    : { type: 'p', text: 'Bạn có thể yêu cầu tra cứu nghiên cứu khoa học cho bệnh này để xem bài báo và thử nghiệm lâm sàng liên quan.' };
  if (permission) blocks.push(permission);
  return { blocks, citations: srcs };
}

function compareBlocks(a, b) {
  const rows = [
    ['Tên tiếng Anh', a.name_en, b.name_en],
    ['Tên tiếng Việt', field(a.name_vi), field(b.name_vi)],
    ['Phân nhóm', field(a.category_vi), field(b.category_vi)],
    ['Mã MONDO', field(a.mondo_id), field(b.mondo_id)],
    ['Mã Orphanet', field(a.orphanet_code), field(b.orphanet_code)],
    ['ICD-10', field(a.icd10), field(b.icd10)],
    ['Bệnh hiếm', a.is_rare ? 'Có' : 'Không ghi nhận', b.is_rare ? 'Có' : 'Không ghi nhận'],
    ['Số kiểu hình liên kết', String(a.symptoms.length), String(b.symptoms.length)],
    ['Gene liên quan', a.genes.map(g => g.symbol).slice(0, 6).join(', ') || 'Chưa có dữ liệu', b.genes.map(g => g.symbol).slice(0, 6).join(', ') || 'Chưa có dữ liệu']
  ];
  const citations = [...a.sources, ...b.sources].map(s => citation(s));
  return {
    blocks: [
      { type: 'heading', text: `So sánh: ${a.name_en} và ${b.name_en}` },
      { type: 'table', head: ['Trường dữ liệu', a.name_en, b.name_en], rows },
      { type: 'callout', tone: 'warn', text: 'Bảng so sánh chỉ đối chiếu dữ liệu nguồn. Không dùng để tự chẩn đoán hay chọn phương pháp điều trị.' },
      { type: 'sources', items: citations }
    ],
    citations
  };
}

function drugBlocks(d) {
  const citations = d.sources.map(s => citation({ ...s, retrievedAt: d.retrieved_at }));
  const blocks = [
    { type: 'heading', text: d.brand_name || d.generic_name },
    { type: 'facts', items: [
      ['Tên generic', field(d.generic_name)], ['Hoạt chất', field(d.active_ingredients)],
      ['Dạng bào chế', field(d.dosage_form)], ['Đường dùng', field(d.route)],
      ['Nhà sản xuất / labeler', field(d.labeler)], ['Mã NDC', field(d.product_ndc)],
      ['Nhóm dược lý', field(d.pharm_class)], ['Quốc gia dữ liệu', field(d.country)]
    ] }
  ];
  if (d.label) {
    if (d.label.indications) blocks.push({ type: 'subheading', text: 'Chỉ định (theo nhãn thuốc)' });
    if (d.label.indications) blocks.push({ type: 'p', text: d.label.indications.slice(0, 1200) });
    if (d.label.contraindications) blocks.push({ type: 'subheading', text: 'Chống chỉ định (theo nhãn thuốc)' });
    if (d.label.contraindications) blocks.push({ type: 'p', text: d.label.contraindications.slice(0, 1200) });
    if (d.label.warnings) blocks.push({ type: 'subheading', text: 'Cảnh báo (theo nhãn thuốc)' });
    if (d.label.warnings) blocks.push({ type: 'p', text: d.label.warnings.slice(0, 1200) });
  } else {
    blocks.push({ type: 'p', text: 'Chưa tải được nhãn thuốc từ DailyMed/openFDA cho sản phẩm này. Hãy mở trang thuốc để thử tải lại.' });
  }
  blocks.push({ type: 'callout', tone: 'danger', text: 'Nền tảng không đưa ra liều dùng cá nhân hay thay đổi phác đồ. Mọi quyết định điều trị phải do nhân viên y tế có thẩm quyền thực hiện.' });
  blocks.push({ type: 'sources', items: citations });
  return { blocks, citations };
}

function symptomBlocks(s) {
  const citations = s.sources.map(x => citation(x));
  const blocks = [
    { type: 'heading', text: s.name_en + (s.name_vi ? ` (${s.name_vi})` : '') },
    { type: 'p', text: field(s.definition, 'Nguồn HPO/Orphanet chưa cung cấp định nghĩa cho triệu chứng này.') }
  ];
  if (s.diseases.length) {
    blocks.push({ type: 'subheading', text: `Bệnh có ghi nhận triệu chứng này (${s.diseases.length} trong kho)` });
    blocks.push({ type: 'list', items: s.diseases.slice(0, 12).map(d => `${d.name_en}${d.frequency_text ? ` — ${d.frequency_text}` : ''}`) });
  }
  if (s.cooccurring.length) {
    blocks.push({ type: 'p', text: `Triệu chứng thường xuất hiện cùng trong dữ liệu kiểu hình: ${s.cooccurring.slice(0, 8).map(x => x.name_en).join(', ')}.` });
  }
  blocks.push({ type: 'callout', tone: 'danger', text: 'Không thể kết luận bạn mắc bệnh dựa trên triệu chứng. Nếu có dấu hiệu nguy hiểm như khó thở nặng, đau ngực, rối loạn ý thức, chảy máu không cầm, hãy gọi cấp cứu ngay.' });
  blocks.push({ type: 'sources', items: citations });
  return { blocks, citations };
}

function labBlocks(l) {
  const citations = l.sources.map(x => citation(x));
  return {
    blocks: [
      { type: 'heading', text: l.name_en },
      { type: 'p', text: field(l.purpose, 'Nguồn MedlinePlus chưa cung cấp mô tả cho xét nghiệm này.') },
      { type: 'callout', tone: 'warn', text: l.reference_note },
      { type: 'callout', tone: 'danger', text: 'Kết quả xét nghiệm chỉ có ý nghĩa khi được bác sĩ diễn giải cùng bệnh sử, thăm khám và khoảng tham chiếu của phòng xét nghiệm thực hiện.' },
      { type: 'sources', items: citations }
    ],
    citations
  };
}

function geneBlocks(g) {
  const citations = g.sources.map(x => citation(x));
  const blocks = [
    { type: 'heading', text: g.symbol },
    { type: 'facts', items: [['Tên gene', field(g.name)], ['Nhiễm sắc thể', field(g.chromosome)], ['Vị trí', field(g.location)]] }
  ];
  if (g.diseases.length) blocks.push({ type: 'p', text: `Liên kết bệnh (Orphanet): ${g.diseases.slice(0, 15).map(d => d.name_en).join('; ')}.` });
  blocks.push({ type: 'callout', tone: 'warn', text: 'Thông tin biến thể di truyền không đủ để kết luận chẩn đoán cho một cá nhân; cần tư vấn di truyền.' });
  blocks.push({ type: 'sources', items: citations });
  return { blocks, citations };
}

function organismBlocks(m) {
  const citations = m.sources.map(x => citation(x));
  const blocks = [
    { type: 'heading', text: m.name_scientific },
    { type: 'facts', items: [['Tên phổ biến', field(m.name_common)], ['Giới', field(m.kingdom)], ['Bậc phân loại', field(m.rank)], ['TaxID', field(m.taxid)]] },
    { type: 'p', text: `Phân loại: ${field(m.lineage)}` }
  ];
  if (m.diseases.length) blocks.push({ type: 'p', text: `Bệnh liên quan trong kho: ${m.diseases.slice(0, 15).map(d => d.name_en).join('; ')}.` });
  blocks.push({ type: 'sources', items: citations });
  return { blocks, citations };
}

async function researchBlocks(question) {
  const data = await researchSearch({ q: question, pageSize: 6, source: 'all' });
  const blocks = [{ type: 'heading', text: 'Nghiên cứu khoa học liên quan' }];
  if (!data.results.length) {
    blocks.push({ type: 'p', text: 'Không tìm thấy bài báo phù hợp từ PubMed/Europe PMC cho truy vấn này.' });
  } else {
    blocks.push({ type: 'p', text: `Tìm thấy ${data.total.toLocaleString('vi-VN')} kết quả; hiển thị ${data.results.length} bản ghi mới nhất/phù hợp nhất.` });
    blocks.push({ type: 'list', items: data.results.map(r => `${r.title} — ${r.journal || 'N/A'} (${r.year || 'N/A'})${r.pmid ? ` · PMID ${r.pmid}` : ''}${r.isOpenAccess ? ' · Open Access' : ''}`) });
    blocks.push({ type: 'sources', items: data.results.map(r => ({ label: r.title, url: r.url, license: r.license })) });
  }
  return { blocks, citations: data.results.map(r => ({ label: r.title, url: r.url, license: r.license })) };
}

function entityQuery(text) {
  return String(text || '')
    .replace(/^\s*(?:cho (?:tôi|toi) (?:biết|biet)|thông tin (?:về|ve)|tìm hiểu|tim hieu|giải thích|giai thich|what is|what are|tell me about)\s+/i, '')
    .replace(/\s+(?:là|la) gì\s*[?!.]*$/i, '')
    .replace(/\s+(?:như thế nào|nhu the nao)\s*[?!.]*$/i, '')
    .replace(/[?!.]+\s*$/, '')
    .trim();
}

function searchEntity(text, type) {
  const cleaned = entityQuery(text);
  const attempts = [cleaned];
  if (/^bệnh\s+/i.test(cleaned)) attempts.push(cleaned.replace(/^bệnh\s+/i, ''));
  attempts.push(text);
  for (const attempt of attempts) {
    if (!attempt) continue;
    const hits = q.search({ q: attempt, type, pageSize: 3 }).results;
    if (hits.length) return hits;
  }
  return [];
}

async function answer(questionRaw) {
  const question = cleanQuestion(questionRaw);
  if (question.length < 3) {
    return { question, blocks: [{ type: 'p', text: 'Vui lòng nhập câu hỏi cụ thể hơn.' }], citations: [], intent: 'help' };
  }
  const intent = detectIntent(question);
  try {
    if (intent === 'research') {
      const r = await researchBlocks(question);
      return { question, intent, ...r, disclaimer: DISCLAIMER };
    }
    if (intent === 'compare' || /\bva\b.*\b(khac|so sanh)\b/.test(q.fold(question))) {
      const halves = question.split(/\b(?:so sánh|so sanh|với|voi|vs\.?|versus)\b/i).map(s => s.trim()).filter(Boolean);
      const names = halves.length >= 2 ? halves : question.split(/\s+và\s+/i);
      const a = searchEntity(names[0] || question, 'disease')[0];
      const b = searchEntity(names[1] || '', 'disease')[0];
      const da = a && q.getDisease(a.slug);
      const db = b && q.getDisease(b.slug);
      if (da && db) return { question, intent: 'compare', ...compareBlocks(da, db), disclaimer: DISCLAIMER };
      return {
        question, intent: 'compare', citations: [],
        blocks: [{ type: 'p', text: 'Không tìm thấy đủ hai bệnh trong kho dữ liệu để so sánh. Hãy nêu rõ tên hai bệnh bằng tiếng Anh hoặc mã MONDO/Orphanet.' }],
        disclaimer: DISCLAIMER
      };
    }

    const typeMap = { disease: 'disease', symptom: 'symptom', drug: 'drug', lab: 'lab', gene: 'gene', organism: 'organism' };
    const type = typeMap[intent] || 'disease';
    const hits = searchEntity(question, type);
    if (!hits.length) {
      return {
        question, intent, citations: [],
        blocks: [{
          type: 'p',
          text: 'Không đủ dữ liệu đáng tin cậy trong kho dữ liệu để trả lời câu hỏi này. Tôi không tạo câu trả lời khi không có bản ghi nguồn tương ứng. Bạn có thể thử tên tiếng Anh, mã bệnh (MONDO/ORPHA/ICD-10) hoặc một triệu chứng cụ thể.'
        }],
        disclaimer: DISCLAIMER
      };
    }
    const hit = hits[0];
    let detail = null;
    if (type === 'disease') detail = q.getDisease(hit.slug);
    else if (type === 'symptom') detail = q.getSymptom(hit.slug);
    else if (type === 'drug') detail = q.getDrug(hit.slug);
    else if (type === 'lab') detail = q.getLab(hit.slug);
    else if (type === 'gene') detail = q.getGene(hit.slug);
    else if (type === 'organism') detail = q.getOrganism(hit.slug);
    if (!detail) {
      return { question, intent, citations: [], blocks: [{ type: 'p', text: 'Bản ghi liên quan không còn tồn tại trong kho dữ liệu.' }], disclaimer: DISCLAIMER };
    }
    let result;
    if (type === 'disease') result = diseaseBlocks(detail, {});
    else if (type === 'symptom') result = symptomBlocks(detail);
    else if (type === 'drug') result = drugBlocks(detail);
    else if (type === 'lab') result = labBlocks(detail);
    else if (type === 'gene') result = geneBlocks(detail);
    else result = organismBlocks(detail);
    return { question, intent, ...result, relatedHits: hits.slice(1).map(h => ({ title: h.title, url: h.url + h.slug, type: h.type })), disclaimer: DISCLAIMER };
  } catch (err) {
    return {
      question, intent, citations: [],
      blocks: [{ type: 'p', text: `Không thể truy xuất dữ liệu lúc này: ${err.message}. Vui lòng thử lại sau.` }],
      disclaimer: DISCLAIMER
    };
  }
}

module.exports = { answer, DISCLAIMER };
