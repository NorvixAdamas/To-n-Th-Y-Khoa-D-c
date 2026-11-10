'use strict';
/**
 * ICD-10-CM code descriptions from CMS (public domain).
 * Reads the official tabular-order ZIP in-process (no unzip dependency).
 */
const fs = require('node:fs');
const zlib = require('node:zlib');
const db = require('../../server/db');
const { download, startJob, finishJob, recordLog } = require('./lib');

const URL = 'https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip';
const SOURCE_URL = 'https://www.cms.gov/medicare/coding-billing/icd-10-codes';

function readZipEntries(buffer) {
  const entries = [];
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Không tìm thấy ZIP central directory');
  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buffer.subarray(start, start + compSize);
      let data;
      try { data = method === 0 ? raw : zlib.inflateRawSync(raw); }
      catch { data = null; }
      if (data) entries.push({ name, data });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function chapterFor(code) {
  const n = Number(code.slice(1, 3));
  const c = code[0];
  if (c === 'A' || c === 'B') return 'I. Bệnh nhiễm trùng và ký sinh trùng (A00–B99)';
  if (c === 'C' || (c === 'D' && n <= 49)) return 'II. Khối u (C00–D49)';
  if (c === 'D') return 'III. Bệnh máu và cơ quan tạo máu (D50–D89)';
  if (c === 'E') return 'IV. Nội tiết, dinh dưỡng và chuyển hóa (E00–E89)';
  if (c === 'F') return 'V. Rối loạn tâm thần và hành vi (F01–F99)';
  if (c === 'G') return 'VI. Bệnh hệ thần kinh (G00–G99)';
  if (c === 'H' && n <= 59) return 'VII. Bệnh mắt và phần phụ (H00–H59)';
  if (c === 'H') return 'VIII. Bệnh tai và xương chũm (H60–H95)';
  if (c === 'I') return 'IX. Bệnh hệ tuần hoàn (I00–I99)';
  if (c === 'J') return 'X. Bệnh hệ hô hấp (J00–J99)';
  if (c === 'K') return 'XI. Bệnh hệ tiêu hóa (K00–K95)';
  if (c === 'L') return 'XII. Bệnh da và mô dưới da (L00–L99)';
  if (c === 'M') return 'XIII. Bệnh hệ cơ xương và mô liên kết (M00–M99)';
  if (c === 'N') return 'XIV. Bệnh hệ sinh dục – tiết niệu (N00–N99)';
  if (c === 'O') return 'XV. Thai nghén, sinh đẻ và hậu sản (O00–O9A)';
  if (c === 'P') return 'XVI. Một số bệnh lý thời kỳ chu sinh (P00–P96)';
  if (c === 'Q') return 'XVII. Dị tật bẩm sinh và bất thường nhiễm sắc thể (Q00–Q99)';
  if (c === 'R') return 'XVIII. Triệu chứng, dấu hiệu và kết quả bất thường (R00–R99)';
  if (c === 'S' || c === 'T') return 'XIX. Chấn thương, ngộ độc và nguyên nhân ngoại sinh (S00–T88)';
  if (c === 'U') return 'XXII. Mã dành cho mục đích đặc biệt (U00–U85)';
  if (c === 'V' || c === 'W' || c === 'X' || c === 'Y') return 'XX. Nguyên nhân bên ngoài (V00–Y99)';
  if (c === 'Z') return 'XXI. Yếu tố ảnh hưởng sức khỏe và tiếp xúc dịch vụ (Z00–Z99)';
  return 'Khác';
}

async function run({ force = false } = {}) {
  const conn = db.open();
  db.init(conn);
  const jobId = startJob(conn, 'icd10cm', 'Tải ICD-10-CM từ CMS');
  try {
    const file = await download(URL, 'icd10cm_2026.zip', { force, maxAgeHours: 720, label: 'ICD-10-CM' });
    const entries = readZipEntries(fs.readFileSync(file.file));
    const entry = entries.find(e => /codes.*\.txt$/i.test(e.name)) || entries.find(e => /\.txt$/i.test(e.name));
    if (!entry) throw new Error(`Không tìm thấy tệp mã trong ZIP (${entries.map(e => e.name).join(', ')})`);
    const lines = entry.data.toString('utf8').split(/\r?\n/);
    const upsert = conn.prepare(`INSERT INTO icd_codes (code, title, chapter, billable, source_slug, source_url, search_text)
      VALUES (?, ?, ?, 0, 'icd10cm', ?, ?)
      ON CONFLICT(code) DO UPDATE SET title=excluded.title, chapter=excluded.chapter, search_text=excluded.search_text,
        source_url=excluded.source_url`);
    let seen = 0, upserted = 0, skipped = 0, errors = 0;
    conn.prepare("DELETE FROM icd_codes WHERE source_slug='icd10cm'").run();
    conn.exec('BEGIN');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^([A-Z][0-9][0-9A-Z]{1,5})\s+(.+)$/);
      if (!m) { skipped++; continue; }
      seen++;
      try {
        const rawCode = m[1];
        const code = rawCode.length > 3 ? `${rawCode.slice(0, 3)}.${rawCode.slice(3)}` : rawCode;
        const title = m[2].replace(/\s+/g, ' ').trim();
        upsert.run(code, title, chapterFor(code), SOURCE_URL, db.fold(`${code} ${title}`));
        upserted++;
      } catch (err) {
        errors++;
        if (errors <= 5) recordLog(conn, jobId, 'icd10cm', 'error', `${line.slice(0, 50)}: ${err.message}`);
      }
    }
    conn.exec('COMMIT');
    db.setMeta(conn, 'icd10cm_count', conn.prepare('SELECT COUNT(*) AS c FROM icd_codes').get().c);
    finishJob(conn, jobId, 'icd10cm', 'success', { seen, upserted, skipped, errors },
      `ICD-10-CM: ${upserted.toLocaleString('vi-VN')} mã từ ${entry.name}`);
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* no active transaction */ }
    recordLog(conn, jobId, 'icd10cm', 'error', err.message);
    finishJob(conn, jobId, 'icd10cm', 'failed', { seen: 0, upserted: 0, skipped: 0, errors: 1 }, `Lỗi: ${err.message}`);
    throw err;
  } finally {
    conn.close();
  }
}

module.exports = { run, readZipEntries, chapterFor };
if (require.main === module) {
  run({ force: process.argv.includes('--force') }).then(() => console.log('ICD-10-CM xong')).catch(err => { console.error(err); process.exit(1); });
}
