/**
 * Static API router.
 * The UI still asks for /api/... but the static build answers from local data
 * and public CORS APIs. Admin routes are deliberately unavailable.
 */
import * as data from './static-data.js';
import { researchSearch, trialSearch, getDrugLabel } from './static-external.js';
import { answer } from './static-assistant.js';

function params(url) {
  return {
    q: url.searchParams.get('q') || '',
    type: url.searchParams.get('type') || '',
    category: url.searchParams.get('category') || '',
    rare: url.searchParams.get('rare') || '',
    sort: url.searchParams.get('sort') || 'name',
    system: url.searchParams.get('system') || '',
    ingredient: url.searchParams.get('ingredient') || '',
    form: url.searchParams.get('form') || '',
    labeler: url.searchParams.get('labeler') || '',
    kingdom: url.searchParams.get('kingdom') || '',
    chapter: url.searchParams.get('chapter') || '',
    source: url.searchParams.get('source') || 'all',
    year: url.searchParams.get('year') || '',
    openAccess: url.searchParams.get('openAccess') === '1',
    status: url.searchParams.get('status') || '',
    country: url.searchParams.get('country') || '',
    page: Number(url.searchParams.get('page') || 1) || 1,
    pageSize: Number(url.searchParams.get('pageSize') || 20) || 20,
    pageToken: url.searchParams.get('pageToken') || ''
  };
}

function normalizePath(path) {
  try { return decodeURIComponent(path); } catch { return path; }
}

export async function getJson(path) {
  const url = new URL(path, location.href);
  const p = normalizePath(url.pathname.replace(/^\/api/, '') || '/');
  const q = params(url);

  if (p === '/health') return { status: 'ok', mode: 'static', time: new Date().toISOString() };
  if (p === '/stats') return data.getStats();
  if (p === '/sources') return { sources: (await data.getStats()).sources };
  if (p === '/categories') return { categories: (await data.getStats()).categories };

  if (p === '/search') return data.search({ q: q.q, type: q.type, page: q.page, pageSize: q.pageSize });
  if (p === '/suggest') return { suggestions: await data.suggest(q.q, 8) };

  if (p === '/diseases') return data.listDiseases({ q: q.q, category: q.category, rare: q.rare, sort: q.sort, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/diseases/')) {
    const d = await data.getDisease(p.slice('/diseases/'.length));
    if (!d) throw Object.assign(new Error('Không tìm thấy bệnh trong kho dữ liệu.'), { status: 404 });
    return d;
  }

  if (p === '/symptoms') return data.listSymptoms({ q: q.q, system: q.system, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/symptoms/')) {
    const s = await data.getSymptom(p.slice('/symptoms/'.length));
    if (!s) throw Object.assign(new Error('Không tìm thấy triệu chứng.'), { status: 404 });
    return s;
  }

  if (p === '/anatomy') return data.listAnatomy({ q: q.q, system: q.system, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/anatomy/')) {
    const a = await data.getAnatomy(p.slice('/anatomy/'.length));
    if (!a) throw Object.assign(new Error('Không tìm thấy cấu trúc giải phẫu.'), { status: 404 });
    return a;
  }

  if (p === '/drugs') return data.listDrugs({ q: q.q, ingredient: q.ingredient, form: q.form, labeler: q.labeler, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/drugs/')) {
    const d = await data.getDrug(p.slice('/drugs/'.length));
    if (!d) throw Object.assign(new Error('Không tìm thấy thuốc.'), { status: 404 });
    d.label = await getDrugLabel(d);
    return d;
  }

  if (p === '/labs') return data.listLabs({ q: q.q, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/labs/')) {
    const l = await data.getLab(p.slice('/labs/'.length));
    if (!l) throw Object.assign(new Error('Không tìm thấy xét nghiệm.'), { status: 404 });
    return l;
  }

  if (p === '/organisms') return data.listOrganisms({ q: q.q, kingdom: q.kingdom, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/organisms/')) {
    const m = await data.getOrganism(p.slice('/organisms/'.length));
    if (!m) throw Object.assign(new Error('Không tìm thấy tác nhân gây bệnh.'), { status: 404 });
    return m;
  }

  if (p === '/genes') return data.listGenes({ q: q.q, page: q.page, pageSize: q.pageSize });
  if (p.startsWith('/genes/')) {
    const g = await data.getGene(p.slice('/genes/'.length));
    if (!g) throw Object.assign(new Error('Không tìm thấy gene.'), { status: 404 });
    return g;
  }

  if (p === '/codes') return data.listCodes({ q: q.q, chapter: q.chapter, page: q.page, pageSize: q.pageSize });

  if (p === '/research') {
    try {
      return await researchSearch({
        q: q.q, source: q.source, openAccess: q.openAccess, year: q.year, sort: q.sort,
        page: q.page, pageSize: Math.min(50, q.pageSize)
      });
    } catch (err) {
      throw Object.assign(new Error(`Không truy vấn được nguồn nghiên cứu: ${err.message}`), { status: 502 });
    }
  }

  if (p === '/trials') {
    try {
      return await trialSearch({
        q: q.q, status: q.status, country: q.country, page: q.page,
        pageSize: Math.min(50, q.pageSize), pageToken: q.pageToken
      });
    } catch (err) {
      throw Object.assign(new Error(`Không truy vấn được ClinicalTrials.gov: ${err.message}`), { status: 502 });
    }
  }

  if (p === '/assistant') throw Object.assign(new Error('Dùng POST để gửi câu hỏi.'), { status: 405 });
  if (p.startsWith('/admin')) throw Object.assign(new Error('Bản tĩnh không có trang quản trị. Dữ liệu được tạo khi build.'), { status: 403 });
  if (p.startsWith('/export/')) {
    if (p.startsWith('/export/disease/')) {
      const d = await data.getDisease(p.slice('/export/disease/'.length).replace(/\.json$/, ''));
      if (!d) throw Object.assign(new Error('Không tìm thấy bệnh.'), { status: 404 });
      return { exportedAt: new Date().toISOString(), license: 'Dữ liệu tuân theo giấy phép của từng nguồn', record: d };
    }
    throw Object.assign(new Error('Bản tĩnh không hỗ trợ xuất toàn bộ dữ liệu từ API.'), { status: 404 });
  }

  throw Object.assign(new Error('Không tìm thấy endpoint.'), { status: 404 });
}

export async function postJson(path, body) {
  const url = new URL(path, location.href);
  if (url.pathname === '/api/assistant') return answer(body?.question || '');
  throw Object.assign(new Error('Bản tĩnh không hỗ trợ thao tác ghi.'), { status: 405 });
}
