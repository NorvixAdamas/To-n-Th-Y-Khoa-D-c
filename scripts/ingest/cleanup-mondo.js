'use strict';
/**
 * Removes records that MONDO imports from external ontologies (CHEBI, etc.)
 * and non-human animal disease branches, keeping only human disease classes.
 */
const fs = require('node:fs');
const db = require('../../server/db');
const { parseObo } = require('./lib');

function isAnimalName(name) {
  return /,\s*(dog|cat|mouse|rat|cattle|pig|horse|sheep|goat|rabbit|guinea pig|hamster|chicken|zebrafish|fish|frog|monkey|primate|fly|worm|nematode|drosophila|yeast|mink|ferret|llama|alpaca|camel|deer|fox|wolf|bird|duck|turkey)\b/i.test(name)
    || /non-human animal/i.test(name)
    || /\b(dog|mouse|rat|zebrafish)-related\b/i.test(name);
}

const conn = db.open();
const terms = parseObo(fs.readFileSync('data/cache/mondo.obo', 'utf8'))
  .filter(t => t.id && t.name && !t.obsolete);
const byId = new Map(terms.map(t => [t.id, t]));

function reachesNonHuman(term) {
  const seen = new Set();
  let frontier = [...(term.isA || [])];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (id === 'MONDO:0005583') return true;
      const node = byId.get(id);
      if (!node) continue;
      if (isAnimalName(node.name)) return true;
      next.push(...node.isA);
    }
    frontier = next;
  }
  return false;
}

const keep = new Set();
let nonMondo = 0, animal = 0;
for (const term of terms) {
  if (!term.id.startsWith('MONDO:')) { nonMondo++; continue; }
  if (isAnimalName(term.name) || reachesNonHuman(term)) { animal++; continue; }
  const inTaxon = (term.properties || []).filter(p => p.startsWith('in_taxon NCBITaxon:'));
  if (inTaxon.length && !inTaxon.some(p => p.includes('NCBITaxon:9606'))) { animal++; continue; }
  keep.add(term.id);
}

console.log(`Giữ ${keep.size} bệnh người; loại ${nonMondo} thuật ngữ ngoài MONDO và ${animal} bệnh động vật.`);

const ids = new Set(conn.prepare("SELECT id, mondo_id FROM diseases WHERE mondo_id IS NOT NULL").all()
  .filter(r => !keep.has(r.mondo_id)).map(r => r.id));
console.log(`Xóa ${ids.size} bản ghi bệnh khỏi cơ sở dữ liệu…`);
conn.exec('BEGIN');
const del = conn.prepare('DELETE FROM diseases WHERE id = ?');
for (const id of ids) del.run(id);
// Clear stale running jobs left by an interrupted process.
conn.prepare("UPDATE data_import_jobs SET status='failed', finished_at=?, message=COALESCE(message,'Tiến trình bị gián đoạn') WHERE status='running' AND id NOT IN (SELECT MAX(id) FROM data_import_jobs WHERE status='running')").run(new Date().toISOString());
conn.exec('COMMIT');

const remaining = conn.prepare('SELECT COUNT(*) AS c FROM diseases').get().c;
const byCat = conn.prepare(`SELECT c.name_vi, COUNT(*) c FROM diseases d JOIN categories c ON c.id=d.category_id GROUP BY c.id ORDER BY c DESC LIMIT 8`).all();
console.log(`Còn ${remaining} bệnh.`, byCat);
db.setMeta(conn, 'mondo_human_filter_at', new Date().toISOString());
conn.close();
