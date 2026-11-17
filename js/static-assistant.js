/**
 * MEDICAL KNOWLEDGE AI — static, retrieval-grounded assistant.
 * Every statement is extracted from a snapshot record with a source.
 * Nothing is generated when the snapshot has no matching record.
 */
import * as data from './static-data.js';
import { researchSearch, getDrugLabel } from './static-external.js';

const DISCLAIMER = 'Thông tin chỉ nhằm mục đích giáo dục, không thay thế tư vấn, chẩn đoán hoặc điều trị của nhân viên y tế.';

function cleanQuestion(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function detectIntent(question) {
  const lower = data.fold(question);
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
  const ids = [
    d.mondo_id && `MONDO:${String(d.mondo_id).replace('MONDO:', '')}`,
    d.orphanet_code && `ORPHA:${d.orphanet_code}`,
    d.icd10 && `ICD-10: ${d.icd10}`,
    d.doid && `DOID:${d.doid}`
  ].filter(Boolean);
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
  if (!context?.includeResearch) {
    blocks.push({ type: 'p', text: 'Bạn có thể yêu cầu tra cứu nghiên cứu khoa học cho bệnh này để xem bài báo và thử nghiệm lâm sàng liên quan.' });
  }
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
    {
      type: 'facts', items: [
        ['Tên generic', field(d.generic_name)], ['Hoạt chất', field(d.active_ingredients)],
        ['Dạng bào chế', field(d.dosage_form)], ['Đường dùng', field(d.route)],
        ['Nhà sản xuất / labeler', field(d.labeler)], ['Mã NDC', field(d.product_ndc)],
        ['Nhóm dược lý', field(d.pharm_class)], ['Quốc gia dữ liệu', field(d.country)]
      ]
    }
  ];
  if (d.label) {
    for (const [label, key] of [['Chỉ định (theo nhãn thuốc)', 'indications'], ['Chống chỉ định (theo nhãn thuốc)', 'contraindications'], ['Cảnh báo (theo nhãn thuốc)', 'warnings']]) {
      if (d.label[key]) {
        blocks.push({ type: 'subheading', text: label });
        blocks.push({ type: 'p', text: d.label[key].slice(0, 1200) });
      }
    }
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
  const query = question
    .replace(/^.*?(?:tìm|tim)?\s*(?:nghiên cứu|nghien cuu)(?:\s+(?:về|ve))?\s*/i, '')
    .trim() || question;
  const research = await researchSearch({ q: query, pageSize: 6, source: 'all' });
  const blocks = [{ type: 'heading', text: 'Nghiên cứu khoa học liên quan' }];
  if (!research.results.length) {
    blocks.push({ type: 'p', text: 'Không tìm thấy bài báo phù hợp từ PubMed/Europe PMC cho truy vấn này.' });
  } else {
    blocks.push({ type: 'p', text: `Tìm thấy ${research.total.toLocaleString('vi-VN')} kết quả; hiển thị ${research.results.length} bản ghi mới nhất/phù hợp nhất.` });
    blocks.push({ type: 'list', items: research.results.map(r => `${r.title} — ${r.journal || 'N/A'} (${r.year || 'N/A'})${r.pmid ? ` · PMID ${r.pmid}` : ''}${r.isOpenAccess ? ' · Open Access' : ''}`) });
    blocks.push({ type: 'sources', items: research.results.map(r => ({ label: r.title, url: r.url, license: r.license })) });
  }
  return { blocks, citations: research.results.map(r => ({ label: r.title, url: r.url, license: r.license })) };
}

function entityQuery(text) {
  return String(text || '')
    .replace(/^\s*(?:cho (?:tôi|toi) (?:biết|biet)|thông tin (?:về|ve)|tìm hiểu|tim hieu|giải thích|giai thich|what is|what are|tell me about)\s+/i, '')
    .replace(/^\s*(?:triệu chứng|trieu chung)\s+(?:của|cua|ở|o)\s+/i, '')
    .replace(/^\s*(?:xét nghiệm|xet nghiem|gene|gen|thuốc|thuoc)\s+/i, '')
    .replace(/\s+(?:dùng để làm gì|dung de lam gi|là gì|la gi|liên quan đến bệnh nào|lien quan den benh nao|như thế nào|nhu the nao)\s*[?!.]*$/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
}

async function searchEntity(text, type) {
  const cleaned = entityQuery(text);
  const attempts = [cleaned];
  if (/^bệnh\s+/i.test(cleaned)) attempts.push(cleaned.replace(/^bệnh\s+/i, ''));
  attempts.push(text);
  for (const attempt of attempts) {
    if (!attempt) continue;
    const hits = (await data.search({ q: attempt, type, pageSize: 3 })).results;
    if (hits.length) return hits;
  }
  return [];
}

async function detailFor(type, slug) {
  if (type === 'disease') return data.getDisease(slug);
  if (type === 'symptom') return data.getSymptom(slug);
  if (type === 'drug') {
    const drug = await data.getDrug(slug);
    if (drug) drug.label = await getDrugLabel(drug);
    return drug;
  }
  if (type === 'lab') return data.getLab(slug);
  if (type === 'gene') return data.getGene(slug);
  if (type === 'organism') return data.getOrganism(slug);
  return null;
}

export async function answer(questionRaw) {
  const question = cleanQuestion(questionRaw);
  if (question.length < 3) {
    return { question, blocks: [{ type: 'p', text: 'Vui lòng nhập câu hỏi cụ thể hơn.' }], citations: [], intent: 'help', disclaimer: DISCLAIMER };
  }
  let intent = detectIntent(question);
  const foldedQuestion = data.fold(question);
  if (/^trieu chung (cua|o)/.test(foldedQuestion)) intent = 'disease';
  try {
    if (intent === 'research') {
      const result = await researchBlocks(question);
      return { question, intent, ...result, disclaimer: DISCLAIMER };
    }
    if (intent === 'compare' || /\bva\b.*\b(khac|so sanh)\b/.test(foldedQuestion)) {
      const pair = question.replace(/^.*?(?:so sánh|so sanh)\s+/i, '');
      const names = pair.split(/\s+(?:và|va|với|voi|vs\.?|versus)\s+/i).map(s => s.trim()).filter(Boolean);
      const a = (await searchEntity(names[0] || question, 'disease'))[0];
      const b = (await searchEntity(names[1] || '', 'disease'))[0];
      const da = a && await data.getDisease(a.slug);
      const db = b && await data.getDisease(b.slug);
      if (da && db) return { question, intent: 'compare', ...compareBlocks(da, db), disclaimer: DISCLAIMER };
      return {
        question, intent: 'compare', citations: [],
        blocks: [{ type: 'p', text: 'Không tìm thấy đủ hai bệnh trong kho dữ liệu để so sánh. Hãy nêu rõ tên hai bệnh bằng tiếng Anh hoặc mã MONDO/Orphanet.' }],
        disclaimer: DISCLAIMER
      };
    }
    const typeMap = { disease: 'disease', symptom: 'symptom', drug: 'drug', lab: 'lab', gene: 'gene', organism: 'organism' };
    const type = typeMap[intent] || 'disease';
    const hits = await searchEntity(question, type);
    if (!hits.length) {
      return {
        question, intent, citations: [],
        blocks: [{ type: 'p', text: 'Không đủ dữ liệu đáng tin cậy trong kho dữ liệu để trả lời câu hỏi này. Tôi không tạo câu trả lời khi không có bản ghi nguồn tương ứng. Bạn có thể thử tên tiếng Anh, mã bệnh (MONDO/ORPHA/ICD-10) hoặc một triệu chứng cụ thể.' }],
        disclaimer: DISCLAIMER
      };
    }
    const hit = hits[0];
    const detail = await detailFor(type, hit.slug);
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
    return {
      question, intent, ...result,
      relatedHits: hits.slice(1).map(h => ({ title: h.title, url: h.url + h.slug, type: h.type })),
      disclaimer: DISCLAIMER
    };
  } catch (err) {
    return {
      question, intent, citations: [],
      blocks: [{ type: 'p', text: `Không thể truy xuất dữ liệu lúc này: ${err.message}. Vui lòng thử lại sau.` }],
      disclaimer: DISCLAIMER
    };
  }
}
