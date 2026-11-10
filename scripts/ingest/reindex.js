'use strict';
/** Rebuild the FTS5 search index from current database rows. */
const db = require('../../server/db');

const conn = db.open();
db.init(conn);
const started = Date.now();
db.rebuildSearch(conn, line => console.log(line));
db.setMeta(conn, 'search_indexed_at', new Date().toISOString());
const total = conn.prepare('SELECT COUNT(*) AS c FROM search_index').get().c;
console.log(`Đã lập chỉ mục ${total.toLocaleString('vi-VN')} bản ghi trong ${((Date.now() - started) / 1000).toFixed(1)}s`);
conn.close();
