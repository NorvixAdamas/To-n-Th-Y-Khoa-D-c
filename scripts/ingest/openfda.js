'use strict';
/**
 * openFDA NDC Directory ingestion.
 * Source: https://api.fda.gov/drug/ndc.json — public domain (U.S. Government).
 * Optional FDA_API_KEY raises the rate limit (documented in README).
 */
const db = require('../../server/db');
const { httpJson, startJob, finishJob, recordLog, sleep } = require('./lib');

const PAGE = 1000;
const MAX_PRODUCTS = Number(process.env.MEDENC_MAX_DRUGS || 120000);

function ingredientText(list) {
  if (!Array.isArray(list)) return '';
  return list.map(i => `${i.name || ''}${i.strength ? ` ${i.strength}` : ''}`.trim()).filter(Boolean).join('; ');
}

function packagingText(list) {
  if (!Array.isArray(list)) return '';
  return list.map(p => p.description).filter(Boolean).slice(0, 5).join(' | ');
}

async function run({ force = false } = {}) {
  const conn = db.open();
  const jobId = startJob(conn, 'openfda', 'Đồng bộ NDC Directory');
  const key = process.env.FDA_API_KEY ? `&api_key=${encodeURIComponent(process.env.FDA_API_KEY)}` : '';
  try {
    const first = await httpJson(`https://api.fda.gov/drug/ndc.json?limit=${PAGE}&skip=0${key}`, { label: 'openFDA NDC' });
    const total = Math.min(first.meta?.results?.total || 0, MAX_PRODUCTS);
    recordLog(conn, jobId, 'openfda', 'info', `Tổng số sản phẩm thuốc trong NDC: ${first.meta?.results?.total || 0}`);

    const upsert = conn.prepare(`
      INSERT INTO drugs (slug, product_ndc, brand_name, generic_name, active_ingredients, dosage_form, route,
        marketing_category, labeler, country, product_type, packaging, pharm_class, application_number, dea_schedule,
        source_slug, source_url, retrieved_at, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'United States', ?, ?, ?, ?, ?, 'openfda', ?, ?, ?)
      ON CONFLICT(product_ndc) DO UPDATE SET
        brand_name=excluded.brand_name, generic_name=excluded.generic_name, active_ingredients=excluded.active_ingredients,
        dosage_form=excluded.dosage_form, route=excluded.route, marketing_category=excluded.marketing_category,
        labeler=excluded.labeler, product_type=excluded.product_type, packaging=excluded.packaging,
        pharm_class=excluded.pharm_class, application_number=excluded.application_number,
        dea_schedule=excluded.dea_schedule, retrieved_at=excluded.retrieved_at, search_text=excluded.search_text
    `);

    const now = new Date().toISOString();
    let seen = 0, upserted = 0, errors = 0;
    let skip = 0;
    let results = first.results || [];
    // openFDA rejects skip values above 25.000; import the first 25k products
    // and record the API limit instead of failing the whole job.
    const SKIP_LIMIT = 25000;
    while (skip < total && results.length) {
      conn.exec('BEGIN');
      for (const r of results) {
        seen++;
        try {
          const ndc = r.product_ndc || r.package_ndc;
          if (!ndc) continue;
          const brand = (r.brand_name || '').trim() || null;
          const generic = (r.generic_name || '').trim() || null;
          if (!brand && !generic) continue;
          const name = brand || generic;
          const route = Array.isArray(r.route) ? r.route.join(', ') : r.route || null;
          const pharmClass = Array.isArray(r.pharm_class) ? r.pharm_class.join(' | ') : r.pharm_class || null;
          const ing = ingredientText(r.active_ingredients);
          upsert.run(
            db.slugify(name, ndc), ndc, brand, generic, ing || null,
            Array.isArray(r.dosage_form) ? r.dosage_form.join(', ') : r.dosage_form || null,
            route, r.marketing_category || null, r.labeler_name || null,
            r.product_type || null, packagingText(r.packaging) || null, pharmClass,
            r.application_number || null, r.dea_schedule || null,
            `https://api.fda.gov/drug/ndc.json?search=product_ndc:%22${encodeURIComponent(ndc)}%22`,
            now,
            db.fold([name, brand, generic, ing, route, pharmClass, r.labeler_name].filter(Boolean).join(' '))
          );
          upserted++;
        } catch (err) {
          errors++;
          if (errors <= 5) recordLog(conn, jobId, 'openfda', 'error', `${r.product_ndc}: ${err.message}`);
        }
      }
      conn.exec('COMMIT');
      skip += results.length;
      if (skip % 10000 === 0) recordLog(conn, jobId, 'openfda', 'info', `Đã xử lý ${skip.toLocaleString('vi-VN')}/${total.toLocaleString('vi-VN')} sản phẩm`);
      if (skip >= total || skip >= SKIP_LIMIT) break;
      await sleep(process.env.FDA_API_KEY ? 120 : 300);
      const page = await httpJson(`https://api.fda.gov/drug/ndc.json?limit=${PAGE}&skip=${skip}${key}`, { label: `openFDA skip=${skip}` });
      results = page.results || [];
    }

    db.setMeta(conn, 'openfda_product_count', conn.prepare('SELECT COUNT(*) AS c FROM drugs').get().c);
    finishJob(conn, jobId, 'openfda', 'success', { seen, upserted, skipped: seen - upserted, errors },
      `Đã nhập ${upserted.toLocaleString('vi-VN')} sản phẩm thuốc từ openFDA NDC (giới hạn skip ${SKIP_LIMIT.toLocaleString('vi-VN')} của API)`);
  } catch (err) {
    recordLog(conn, jobId, 'openfda', 'error', err.message);
    finishJob(conn, jobId, 'openfda', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => console.log('openFDA xong')).catch(err => { console.error(err); process.exit(1); });
}
