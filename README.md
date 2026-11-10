# Global Medical Encyclopedia — Bách Khoa Toàn Thư Y Khoa Toàn Cầu

Nền tảng tra cứu y khoa chạy thật, dữ liệu nhập từ các bộ dữ liệu mở có giấy phép rõ ràng. Không có danh sách mẫu, không có số liệu minh họa và không có nút bấm giả.

> **Cảnh báo y khoa:** This platform is for educational and informational purposes only. It does not replace professional medical advice, diagnosis, or treatment. Nền tảng không chẩn đoán, không kê đơn và không thay thế bác sĩ. Trong trường hợp cấp cứu, hãy liên hệ dịch vụ cấp cứu tại địa phương.

---

## 1. Kiến trúc

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| Máy chủ | Node.js ≥ 22.5 (đã kiểm thử với Node 26) | HTTP server thuần, không framework |
| Cơ sở dữ liệu | `node:sqlite` (SQLite, WAL) | Không cần cài native module |
| Tìm kiếm | SQLite FTS5 + trigram | BM25, gợi ý tiền tố, tìm gần đúng |
| Giao diện | HTML + CSS + ES Modules | Không build step, không CDN bắt buộc |
| Giải phẫu 3D | Three.js (vendored) + WebGL | Mô hình giáo dục, thuật ngữ từ Uberon |
| API ngoài | Europe PMC, PubMed, Crossref, OpenAlex, ClinicalTrials.gov, openFDA, MedlinePlus | Gọi phía máy chủ, có cache |

Toàn bộ dữ liệu nằm trong `data/medical.db`; frontend chỉ tải từng trang qua API, không tải cả cơ sở dữ liệu vào trình duyệt.

```
index.html, css/, js/        Giao diện (hash router, view, 3D viewer)
server/index.js              HTTP server, API, static, CSP, rate limit, export
server/db.js                 Schema, seed nguồn/danh mục, FTS5
server/queries.js            Truy vấn danh sách/chi tiết/tìm kiếm/thống kê
server/external.js           PubMed, Europe PMC, ClinicalTrials, nhãn thuốc
server/assistant.js          RAG trích xuất có nguồn, từ chối khi thiếu dữ liệu
scripts/ingest/              Bộ nhập dữ liệu theo từng nguồn
scripts/test/smoke.js        Kiểm thử end-to-end
```

---

## 2. Chức năng đã triển khai

- **Bệnh học toàn cầu:** danh mục, tìm kiếm, lọc theo chuyên khoa/bệnh hiếm, trang chi tiết với mã MONDO/ORPHA/ICD-10, định nghĩa, phân cấp bệnh, triệu chứng, gene, tác nhân, nghiên cứu, nguồn và ngày cập nhật.
- **Symptom Explorer:** chọn nhiều triệu chứng để lọc các bệnh có liên kết thật trong HPO/Orphanet; không tính “xác suất mắc bệnh”, không chẩn đoán.
- **Giải phẫu 3D:** mô hình WebGL xoay 360°, zoom, bật/tắt lớp, chọn cơ quan, tìm kiếm thuật ngữ, liên kết bệnh liên quan.
- **Dược điển:** sản phẩm thuốc openFDA (hoạt chất, dạng bào chế, hãng, NDC), nhãn thuốc tải theo yêu cầu từ DailyMed/openFDA.
- **Xét nghiệm:** mục đích, loại mẫu, quy trình, đơn vị, khoảng tham chiếu có cảnh báo phụ thuộc phòng xét nghiệm.
- **Vi sinh:** phân loại NCBI Taxonomy, liên kết tác nhân–bệnh từ MONDO.
- **Gene & di truyền:** toàn bộ gene người từ NCBI Gene, alias, liên kết gene–bệnh Orphanet, pathway Reactome và protein reviewed UniProt; kèm cảnh báo không dùng để chẩn đoán cá nhân.
- **Mã ICD-10-CM:** tra mã và mô tả chính thức từ bộ CMS 2026; lọc theo chương, tìm theo mã hoặc mô tả.
- **Nghiên cứu:** tìm PubMed, Europe PMC, Crossref và OpenAlex theo từ khóa, tác giả, năm, DOI/PMID; thử nghiệm lâm sàng từ ClinicalTrials.gov.
- **Tìm kiếm toàn hệ thống:** tiếng Việt không dấu, tiếng Anh, mã định danh, gợi ý, fuzzy, lọc theo loại, phân trang, đếm kết quả thật.
- **Trợ lý tri thức:** RAG trích xuất từ bản ghi đã nhập, trả lời kèm trích dẫn; không gọi LLM tự do và từ chối khi không đủ nguồn.
- **Trung tâm dữ liệu:** thống kê thật, trạng thái nguồn, nhật ký nhập, kiểm tra chất lượng, xuất JSON, chạy đồng bộ nền có kiểm soát.
- **Xuất dữ liệu:** JSON qua API và in/lưu PDF bằng trình duyệt.
- **Đa ngôn ngữ:** giao diện tiếng Việt; tên gốc tiếng Anh luôn hiển thị. Một số bệnh/triệu chứng phổ biến có nhãn tiếng Việt do nền tảng biên tập, lưu trạng thái `machine_draft` và hiển thị nhãn “chưa xác thực”.

---

## 3. Nguồn dữ liệu và giấy phép

| Nguồn | Dữ liệu dùng | Giấy phép |
|---|---|---|
| [MONDO](https://mondo.monarchinitiative.org/) | Danh mục bệnh, mã, đồng nghĩa, phân cấp, ICD-10/11 khi có | CC BY 4.0 |
| [HPO](https://hpo.jax.org/) | Thuật ngữ kiểu hình, liên kết bệnh–triệu chứng | CC BY 4.0 |
| [Orphanet / Orphadata](https://www.orphadata.com/) | Bệnh hiếm, định nghĩa, gene, di truyền, dịch tễ | CC BY 4.0 |
| [Uberon](https://uberon.github.io/) | Thuật ngữ giải phẫu | CC BY 3.0 |
| [openFDA](https://open.fda.gov/apis/) | Sản phẩm thuốc, NDC, nhãn thuốc | Public domain (U.S. Government) |
| [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy) | Phân loại vi sinh vật | Public domain |
| [PubMed](https://pubmed.ncbi.nlm.nih.gov/) / [Europe PMC](https://europepmc.org/) | Metadata và abstract nghiên cứu | Theo từng bài; hiển thị liên kết nguồn |
| [ClinicalTrials.gov](https://clinicaltrials.gov/) | Thử nghiệm lâm sàng | Public domain |
| [MedlinePlus](https://medlineplus.gov/) | Thông tin sức khỏe (truy vấn khi cần) | Public domain |
| [Human Disease Ontology](https://disease-ontology.org/) | Mã DOID, định nghĩa, synonym, phân cấp | CC0 1.0 |
| [NCBI Gene](https://www.ncbi.nlm.nih.gov/gene/) | Gene người, symbol, alias, vị trí, GeneID | Public domain |
| [ICD-10-CM — CMS](https://www.cms.gov/medicare/coding-billing/icd-10-codes) | Mã và mô tả chẩn đoán | Public domain |
| [Reactome](https://reactome.org/) | Pathway người và liên kết gene–pathway | CC0 1.0 |
| [UniProt](https://www.uniprot.org/) | Protein reviewed của người | CC BY 4.0 |
| [Crossref](https://www.crossref.org/) | Metadata bài báo, DOI | Metadata mở; giấy phép theo từng bài |
| [OpenAlex](https://openalex.org/) | Metadata học thuật, abstract index | CC0 1.0 (metadata) |

Giấy phép, URL và ngày lấy dữ liệu được lưu trong bảng `sources` và hiển thị trong mục **Phương pháp & nguồn**. ICD-11 chưa tích hợp vì WHO yêu cầu đăng ký và điều khoản truy cập riêng.

---

## 4. Cài đặt và chạy

Yêu cầu: Node.js ≥ 22.5 (bắt buộc có `node:sqlite`).

```bash
npm start                 # http://127.0.0.1:8787
npm run dev               # tự khởi động lại khi sửa server
npm test                  # kiểm thử end-to-end trên cổng 8799
```

Lần chạy đầu, server tạo schema và seed danh mục/nguồn. Nếu chưa có dữ liệu, các trang sẽ hiển thị đúng trạng thái trống; hãy chạy bộ nhập dữ liệu bên dưới.

### Biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `PORT` | `8787` | Cổng HTTP |
| `HOST` | `127.0.0.1` | Đặt `0.0.0.0` khi chạy trong Docker |
| `MEDENC_DB` | `data/medical.db` | Đường dẫn SQLite |
| `ADMIN_TOKEN` | (trống) | Token quản trị; nếu trống chỉ loopback được phép thao tác |
| `FDA_API_KEY` | (trống) | Tăng hạn mức openFDA |
| `NCBI_API_KEY` | (trống) | Tăng hạn mức NCBI E-utilities |

Xem `.env.example`. Không đặt khóa bí mật trong mã frontend.

---

## 5. Nhập và cập nhật dữ liệu

```bash
npm run ingest:mondo
npm run ingest:hpo
node scripts/ingest/orphadata.js          # thêm SKIP_ORPHA_PHENO=1 để bỏ qua product4
npm run ingest:uberon
npm run ingest:taxonomy
npm run ingest:labs
npm run ingest:openfda                    # có thể mất vài phút; API giới hạn skip 25.000
npm run ingest:doid                       # DOID CC0: định nghĩa, synonym, phân cấp
npm run ingest:ncbi-gene                  # toàn bộ gene người từ NCBI Gene
npm run ingest:icd10cm                    # 74.706 mã ICD-10-CM từ CMS 2026
npm run ingest:reactome                   # pathway và liên kết gene–pathway
npm run ingest:uniprot                    # protein reviewed của người
npm run ingest:vi                         # hoặc node scripts/ingest/vi-terms.js           # nhãn tiếng Việt biên tập, trạng thái machine_draft
npm run reindex                           # bắt buộc sau khi dữ liệu thay đổi
```

Hoặc chạy toàn bộ chuỗi: `npm run ingest` (xem `scripts/ingest/run.js`).

Đặc điểm của data engine:

- Tải qua HTTPS/HTTP có theo dõi chuyển hướng, retry và giới hạn tốc độ.
- Cache tệp nguồn trong `data/cache/` để chạy lại mà không tải lại.
- Upsert theo mã định danh (MONDO ID, ORPHA code, HPO ID, NDC, TaxID), không dùng tên làm khóa.
- Ghi `data_import_jobs` và `data_update_logs` cho từng lần chạy; lỗi một nguồn không làm mất dữ liệu nguồn khác.
- Có thể chạy lại sau gián đoạn; dữ liệu tốt không bị ghi đè bởi bản ghi lỗi.
- `cleanup-mondo.js` loại thuật ngữ ngoài MONDO và bệnh động vật không phải người khỏi danh mục.

Sau khi nhập, chạy `npm run reindex` để dựng lại FTS5/trigram. Nếu không, tìm kiếm sẽ không phản ánh dữ liệu mới.

---

## 6. Tìm kiếm và ngôn ngữ

- Chuẩn hóa bỏ dấu tiếng Việt (kể cả `đ → d`) trước khi lập chỉ mục.
- FTS5 `unicode61`, xếp hạng BM25; gợi ý tiền tố khi nhập; fallback trigram cho lỗi chính tả nhẹ.
- Tìm theo tên, tên đồng nghĩa, mã MONDO/ORPHA/ICD-10/HPO/NDC/TaxID.
- Kết quả trả về kèm loại, tiêu đề, phụ đề, trích đoạn và URL.
- Bản dịch tiếng Việt do nền tảng biên tập chỉ áp dụng cho một danh sách giới hạn; trạng thái `machine_draft` và nhãn “chưa xác thực” luôn hiển thị. Không có bản dịch nào được coi là thuật ngữ y khoa đã xác thực.

---

## 7. Trợ lý tri thức y khoa

`server/assistant.js` là RAG trích xuất, không phải chatbot tự do:

1. Phân loại câu hỏi (bệnh, triệu chứng, thuốc, xét nghiệm, gene, nghiên cứu, so sánh).
2. Truy xuất bản ghi từ SQLite và metadata nghiên cứu.
3. Trả lời bằng các đoạn trích có cấu trúc, kèm mã định danh và nguồn.
4. Nếu không tìm thấy bản ghi phù hợp, trả lời rõ “không đủ dữ liệu”.
5. Không chẩn đoán, không kê đơn, không tạo DOI/mã bệnh/study giả.

Không cần API key LLM. Nếu muốn bổ sung mô hình ngôn ngữ, phải giữ nguyên nguyên tắc: chỉ sinh câu từ ngữ cảnh đã truy xuất và luôn kèm trích dẫn.

---

## 8. API chính

```
GET  /api/health
GET  /api/stats
GET  /api/sources
GET  /api/search?q=&type=&page=&pageSize=
GET  /api/suggest?q=
GET  /api/diseases?q=&category=&rare=&page=&pageSize=&sort=
GET  /api/diseases/:slug
GET  /api/symptoms?q=&system=&page=
GET  /api/symptoms/:slug
GET  /api/anatomy?q=&system=
GET  /api/drugs?q=&page=
GET  /api/drugs/:slug
GET  /api/labs?q=&page=
GET  /api/labs/:slug
GET  /api/organisms?q=&page=
GET  /api/organisms/:slug
GET  /api/genes?q=&page=
GET  /api/genes/:slug
GET  /api/codes?q=&chapter=&page=
GET  /api/research?q=&source=&page=
GET  /api/trials?q=&status=&page=
POST /api/assistant
GET  /api/admin/overview | /jobs | /logs | /quality
POST /api/admin/sync
GET  /api/export/disease/:slug
```

Lỗi trả về JSON `{ error, code }` với HTTP status phù hợp.

---

## 9. Bảo mật

- Truy vấn SQL tham số hóa; không nối chuỗi đầu vào người dùng.
- CSP nghiêm ngặt, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
- Rate limit theo IP cho API.
- Thao tác quản trị yêu cầu `ADMIN_TOKEN` hoặc kết nối loopback.
- POST kiểm tra same-origin.
- Không phục vụ trực tiếp `server/`, `scripts/`, `data/`, `node_modules/`.
- API key chỉ đọc từ biến môi trường phía máy chủ.

Khi triển khai công khai: bật HTTPS, đặt `ADMIN_TOKEN` mạnh, sao lưu định kỳ `data/medical.db` (kèm WAL), và không công khai thư mục dữ liệu.

---

## 10. Kiểm thử

```bash
npm test
```

Smoke test khởi động server riêng ở cổng 8799 và kiểm tra: health, thống kê thật, danh sách bệnh, chi tiết bệnh, tìm kiếm có dấu/không dấu, chống injection/XSS, liên kết triệu chứng–bệnh, API nghiên cứu. Test không thay thế kiểm thử y khoa lâm sàng.

---

## 11. Triển khai

Ứng dụng cần một máy chủ Node chạy lâu dài và ổn định vì dùng SQLite ghi trên đĩa. Các lựa chọn phù hợp: VPS, Docker, Render, Fly.io, Railway hoặc máy chủ nội bộ.

### Docker

```bash
docker build -t medical-encyclopedia .
docker run -d --name medenc -p 8787:8787 \
  -e HOST=0.0.0.0 -e ADMIN_TOKEN='thay-bang-token-manh' \
  -v "$PWD/data:/app/data" medical-encyclopedia
```

Giữ volume `/app/data` để không mất cơ sở dữ liệu và cache. Chạy bộ nhập dữ liệu trong container hoặc mount một DB đã nhập sẵn.

### Netlify

Bản hiện tại **không thể chạy trên Netlify static hosting**: Netlify chỉ phục vụ tệp tĩnh, còn ứng dụng cần tiến trình Node và SQLite ghi được. Netlify Functions có thời gian chạy ngắn và không có đĩa bền vững. Muốn dùng Netlify phải thay SQLite bằng PostgreSQL (hoặc dịch vụ DB khác), chuyển toàn bộ truy vấn sang lớp DB mới và cấu hình kết nối bí mật — đây là thay đổi kiến trúc, không phải cấu hình `netlify.toml`. README này không tuyên bố đã triển khai phương án đó.

### Sau khi deploy

1. Mở `/api/health`, kiểm tra `/api/stats`.
2. Chạy `npm test` trên môi trường staging.
3. Kiểm tra trang chủ, tìm kiếm, chi tiết bệnh, 3D, xuất PDF/JSON.
4. Đặt lịch sao lưu DB và chạy đồng bộ dữ liệu định kỳ.

---

## 12. Giới hạn đã biết

- Chưa có tài khoản người dùng, yêu thích, ghi chú hay lịch sử đọc.
- Chưa có bản dịch tiếng Việt chính thức cho toàn bộ danh mục; nhãn biên tập chỉ là bản nháp có ghi chú.
- Chưa tích hợp ICD-11 do điều khoản truy cập của WHO.
- Ranh giới dữ liệu: openFDA là sản phẩm/thuốc tại Hoa Kỳ; không đại diện cho mọi quốc gia. API NDC giới hạn `skip` ở 25.000 nên lần nhập hiện tại lấy 25.000 sản phẩm đầu tiên; muốn mở rộng cần phân trang theo trường khác hoặc dùng nguồn bổ sung.
- Khoảng tham chiếu xét nghiệm chỉ mang tính giáo dục; mỗi phòng xét nghiệm có phương pháp và khoảng riêng.
- Orphanet lần nhập đầy đủ đã bao gồm `en_product4`; số liên kết kiểu hình thực tế được hiển thị trong Trung tâm dữ liệu.
- DOID chỉ được ánh xạ vào bệnh đã có mã DOID hoặc identifier tương ứng; thuật ngữ không khớp không được tự tạo thành bệnh mới. Nguồn giữ nguyên mã và định nghĩa gốc.
- ICD-10-CM là bộ mã dùng cho Hoa Kỳ; không đại diện cho ICD-11 hoặc mã thanh toán của mọi quốc gia.
- Crossref/OpenAlex là truy vấn metadata trực tiếp, không lưu toàn bộ bài báo; abstract có thể thiếu hoặc bị giới hạn bởi nguồn.
- Dữ liệu thay đổi theo thời gian; luôn kiểm tra ngày cập nhật và nguồn gốc trên trang chi tiết.

---

## 13. Giấy phép

Mã nguồn: MIT. Dữ liệu thuộc giấy phép của từng nguồn như bảng trên; khi tái sử dụng phải giữ ghi công và liên kết nguồn tương ứng.
