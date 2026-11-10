importScripts("https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/sql-wasm.js");

let db = null;

self.onmessage = async function(e) {
    const data = e.data;

    if (data.action === 'init') {
        try {
            const SQL = await initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${file}`
            });
            
            if (!data.buffer || data.buffer.byteLength === 0) {
                throw new Error("Dữ liệu tệp rỗng hoặc không hợp lệ.");
            }

            db = new SQL.Database(new Uint8Array(data.buffer));
            
            // Basic integrity test
            db.exec("SELECT 1");
            
            self.postMessage({ action: 'init_done' });
        } catch (err) {
            let userFriendlyError = err.message;
            if (err.message.includes("malformed")) {
                userFriendlyError = "Cơ sở dữ liệu đang được đồng bộ hóa. Vui lòng tải lại trang sau vài giây.";
            }
            self.postMessage({ action: 'error', error: userFriendlyError, code: 'INIT_ERROR' });
        }
    } 
    else if (data.action === 'query') {
        if (!db) {
            self.postMessage({ action: 'error', error: 'Cơ sở dữ liệu chưa sẵn sàng.', code: 'DB_NOT_READY' });
            return;
        }

        try {
            let sql = data.sql;
            let params = data.params;
            
            const results = [];
            const stmt = db.prepare(sql);
            stmt.bind(params);
            while(stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();

            self.postMessage({ 
                action: 'query_result', 
                id: data.id, 
                results: results 
            });
        } catch (err) {
            self.postMessage({ action: 'error', id: data.id, error: err.message });
        }
    }
    else if (data.action === 'count') {
        if (!db) return;
        try {
            const result = db.exec(data.sql, data.params);
            const count = result.length > 0 ? result[0].values[0][0] : 0;
            self.postMessage({
                action: 'count_result',
                id: data.id,
                count: count
            });
        } catch (err) {
            self.postMessage({ action: 'error', id: data.id, error: err.message });
        }
    }
    else if (data.action === 'get_categories') {
        if (!db) return;
        try {
            const result = db.exec("SELECT DISTINCT category FROM entries ORDER BY category");
            let categories = [];
            if (result.length > 0) {
                categories = result[0].values.map(row => row[0]);
            }
            self.postMessage({ action: 'categories_result', categories: categories });
        } catch (err) {
            self.postMessage({ action: 'error', error: err.message });
        }
    }
};
