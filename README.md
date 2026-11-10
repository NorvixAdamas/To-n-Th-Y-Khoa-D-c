# Global Medical Encyclopedia — Bách Khoa Toàn Thư Y Khoa Toàn Cầu

Bách khoa tra cứu y khoa **chạy hoàn toàn tĩnh trên trình duyệt**. Dữ liệu được nhập từ các bộ dữ liệu mở có giấy phép rõ ràng, đóng gói thành snapshot nén tại thời điểm build và tra cứu ngay trong trình duyệt. Không có backend công khai, không có cơ sở dữ liệu ghi, không có nút giả và không có số liệu minh họa.

> **Cảnh báo y khoa:** This platform is for educational and informational purposes only. It does not replace professional medical advice, diagnosis, or treatment. Nền tảng không chẩn đoán, không kê đơn và không thay thế bác sĩ. Trong trường hợp cấp cứu, hãy liên hệ dịch vụ cấp cứu tại địa phương.

---

## 1. Kiến trúc bản công khai

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| Giao diện | HTML + CSS + ES Modules | Hash router, không build frontend framework |
| Dữ liệu | Snapshot JSON nén gzip trong `static-snapshot/data/` | Sinh từ SQLite lúc build; public chỉ đọc |
| Tìm kiếm | Chỉ mục tĩnh phía client | Tách `search_core` và `search_genes`; gợi ý dùng `suggest` riêng |
| Giải phẫu 3D | Three.js vendored + WebGL | Mô hình giáo dục; thuật ngữ từ Uberon |
| Nghiên cứu | PubMed, Europe PMC, Crossref, OpenAlex, ClinicalTrials.gov | Gọi trực tiếp từ browser tới API công khai có CORS |
| Nhãn thuốc | openFDA | Tải theo từng NDC khi mở trang thuốc |
| Triển khai | Vercel static hoặc bất kỳ static host | Chỉ cần tệp trong `dist/`; không cần Node khi chạy |

Luồng dữ liệu:

```
data/medical.db (chỉ trên máy nhập liệu)
        │  npm run build:static
        ▼
static-snapshot/data/*.json.gz  ──commit──▶  Vercel build
        │                                      │
        └────────────── copy ──────────────────┘
                                               ▼
                                            dist/
                                      (HTML, JS, CSS, data)
```

`data/medical.db` không được đưa lên Git. Snapshot đã tạo thì có thể tái tạo trên máy khác mà không cần database.

---

## 2. Chức năng đang hoạt động

- **Bệnh học:** danh mục, lọc chuyên khoa/bệnh hiếm, tìm kiếm, chi tiết bệnh với mã MONDO/ORPHA/ICD-10/DOID, định nghĩa, triệu chứng, gene, tác nhân, bệnh tương đồng, nguồn và ngày lấy dữ liệu.
- **Triệu chứng:** tìm kiếm 19.938 thuật ngữ HPO/Orphanet; xem bệnh liên kết và triệu chứng đồng xuất hiện. Không tính xác suất mắc bệnh.
- **Giải phẫu:** mô hình WebGL xoay/zoom/lọc lớp, chọn cơ quan; tra cứu thuật ngữ Uberon và trang chi tiết.
- **Dược điển:** 25.648 sản phẩm openFDA, hoạt chất, dạng bào chế, labeler, NDC; nhãn thuốc tải từ openFDA khi mở chi tiết.
- **Xét nghiệm:** 67 mục MedlinePlus; nêu rõ giới hạn khoảng tham chiếu theo phòng xét nghiệm.
- **Vi sinh:** 253 taxon NCBI Taxonomy và liên kết bệnh MONDO.
- **Gene:** 193.931 gene người NCBI Gene, alias, bệnh liên kết Orphanet, pathway Reactome, protein UniProt.
- **ICD-10-CM:** 74.706 mã CMS 2026, tra theo mã/mô tả/chương.
- **Nghiên cứu:** tìm PubMed, Europe PMC, Crossref, OpenAlex; abstract khi nguồn cung cấp.
- **Thử nghiệm lâm sàng:** ClinicalTrials.gov API v2, lọc trạng thái/quốc gia, phân trang theo `pageToken`.
- **Tìm kiếm toàn hệ thống:** bệnh, triệu chứng, thuốc, giải phẫu, vi sinh, xét nghiệm; gene có bộ lọc riêng. Hỗ trợ tiếng Việt có dấu/không dấu, mã định danh, gợi ý và fuzzy fallback.
- **Trợ lý tri thức:** RAG trích xuất từ snapshot; trả lời kèm nguồn, từ chối khi thiếu dữ liệu; không gọi LLM tự do.
- **Xuất dữ liệu:** JSON bệnh được tạo bằng Blob phía client; in/lưu PDF bằng hộp thoại in của trình duyệt.
- **Không còn trên public UI:** admin, đồng bộ dữ liệu, nhật ký nhập, xuất CSV toàn bộ. Đây là lựa chọn có chủ đích của bản tĩnh.

---

## 3. Chạy và build

Yêu cầu: **Node.js ≥ 22.5** cho bước nhập liệu/build local. Website đã build không cần Node.

```bash
npm run build:static      # tạo static-snapshot/data/ và dist/
npm run serve:static      # xem thử tại http://127.0.0.1:8788
npm test                  # smoke test API local (không kiểm tra static browser)
```

Nếu `data/medical.db` tồn tại, build xuất snapshot mới từ SQLite. Nếu không có database, build dùng `static-snapshot/data/` đã commit — đây là đường dẫn Vercel sử dụng.

Kiểm tra nhanh sau build:

```bash
find dist -type f | head
du -sh dist static-snapshot
curl -I http://127.0.0.1:8788/
```

### Chạy server dữ liệu local (tùy chọn)

Server Node/SQLite vẫn được giữ để nhập liệu và kiểm tra dữ liệu trên máy, nhưng **không phải backend của bản công khai**:

```bash
npm start                 # http://127.0.0.1:8787
npm run dev               # tự khởi động lại
```

Các biến môi trường local (`PORT`, `HOST`, `MEDENC_DB`, `ADMIN_TOKEN`, `FDA_API_KEY`, `NCBI_API_KEY`) chỉ dùng cho server local. Không có khóa bí mật nào trong frontend hoặc snapshot.

---

## 4. Cập nhật dữ liệu

Dữ liệu công khai là **đóng băng**. Muốn cập nhật:

1. Chạy bộ nhập dữ liệu local (xem mục 6).
2. Chạy `npm run reindex`.
3. Chạy `npm run build:static`.
4. Kiểm tra `dist/` bằng `npm run serve:static`.
5. Commit `static-snapshot/` (không commit `data/medical.db` hay `dist/`).
6. Push và để Vercel build lại.

Mỗi lần build ghi `catalog.build.builtAt` và `catalog.build.dataAsOf` để trang About hiển thị đúng mốc dữ liệu.

---

## 5. Triển khai Vercel

Repo đã có `vercel.json`:

- Build command: `node scripts/build-static.js`
- Output directory: `dist`
- Không cần biến môi trường hay database trên Vercel.
- Snapshot nằm trong `static-snapshot/`, nên Vercel chỉ cần repo.
- `dist/` và `data/` bị loại khỏi upload/build context; `static-snapshot/` được giữ.

Quy trình: import repo → để Vercel đọc `vercel.json` → deploy preview → kiểm tra trang chủ, một bệnh, tìm kiếm, gene, nghiên cứu, thử nghiệm, trợ lý và xuất JSON. Bản preview và production là hai môi trường độc lập.

Có thể dùng Netlify, Cloudflare Pages hoặc bất kỳ static host nào: build `dist/` rồi upload. Không cần rewrite vì ứng dụng dùng hash router.

---

## 6. Nguồn dữ liệu và giấy phép

| Nguồn | Dữ liệu dùng | Giấy phép |
|---|---|---|
| [MONDO](https://mondo.monarchinitiative.org/) | Bệnh, mã, đồng nghĩa, phân cấp, ICD-10/11 khi có | CC BY 4.0 |
| [HPO](https://hpo.jax.org/) | Kiểu hình, liên kết bệnh–triệu chứng | CC BY 4.0 |
| [Orphanet / Orphadata](https://www.orphadata.com/) | Bệnh hiếm, định nghĩa, gene, di truyền, dịch tễ | CC BY 4.0 |
| [Uberon](https://uberon.github.io/) | Thuật ngữ giải phẫu | CC BY 3.0 |
| [openFDA](https://open.fda.gov/apis/) | Sản phẩm thuốc, NDC, nhãn thuốc | Public domain (U.S. Government) |
| [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy) | Phân loại vi sinh vật | Public domain |
| [PubMed](https://pubmed.ncbi.nlm.nih.gov/) / [Europe PMC](https://europepmc.org/) | Metadata và abstract nghiên cứu | Theo từng bài; giữ liên kết nguồn |
| [ClinicalTrials.gov](https://clinicaltrials.gov/) | Thử nghiệm lâm sàng | Public domain |
| [MedlinePlus](https://medlineplus.gov/) | Thông tin xét nghiệm | Public domain |
| [Human Disease Ontology](https://disease-ontology.org/) | DOID, định nghĩa, synonym, phân cấp | CC0 1.0 |
| [NCBI Gene](https://www.ncbi.nlm.nih.gov/gene/) | Gene người, symbol, alias, vị trí, GeneID | Public domain |
| [ICD-10-CM — CMS](https://www.cms.gov/medicare/coding-billing/icd-10-codes) | Mã và mô tả chẩn đoán | Public domain |
| [Reactome](https://reactome.org/) | Pathway người và liên kết gene–pathway | CC0 1.0 |
| [UniProt](https://www.uniprot.org/) | Protein reviewed của người | CC BY 4.0 |
| [Crossref](https://www.crossref.org/) | Metadata bài báo, DOI | Metadata mở; giấy phép theo từng bài |
| [OpenAlex](https://openalex.org/) | Metadata học thuật, abstract index | CC0 1.0 (metadata) |

Giấy phép, URL và ngày lấy dữ liệu được lưu trong snapshot `catalog.sources` và hiển thị tại **Phương pháp, nguồn dữ liệu và giới hạn**. ICD-11 chưa tích hợp vì yêu cầu đăng ký và điều khoản truy cập riêng của WHO.

---

## 7. Nhập dữ liệu local

```bash
npm run ingest:mondo
npm run ingest:hpo
node scripts/ingest/orphadata.js
npm run ingest:uberon
npm run ingest:taxonomy
npm run ingest:labs
npm run ingest:openfda
npm run ingest:doid
npm run ingest:ncbi-gene
npm run ingest:icd10cm
npm run ingest:reactome
npm run ingest:uniprot
npm run ingest:vi
npm run reindex
```

Hoặc `npm run ingest` để chạy chuỗi. Bộ nhập dùng cache `data/cache/`, upsert theo mã định danh và ghi nhật ký vào SQLite. Sau khi dữ liệu thay đổi, **bắt buộc chạy `npm run reindex`** trước khi build static.

---

## 8. Cấu trúc thư mục

```
index.html, css/, js/          Giao diện, router, view, static client API
js/static-data.js              Tải/giải nén snapshot, danh sách/chi tiết/tìm kiếm
js/static-api.js               Router /api/* cho bản tĩnh
js/static-external.js          PubMed/Europe PMC/Crossref/OpenAlex/Trials/openFDA
js/static-assistant.js         RAG trích xuất phía client
scripts/build-static.js        Xuất snapshot và tạo dist/
scripts/serve-static.js        Static server để xem thử
static-snapshot/data/          Snapshot JSON gzip được commit
server/, scripts/ingest/       Công cụ local để nhập và kiểm tra dữ liệu
data/medical.db                Database local, bị Git ignore
vercel.json                    Build/static/CSP headers
```

---

## 9. Kiểm thử và kiểm tra thủ công

```bash
npm test
```

Smoke test local kiểm tra health, thống kê, danh sách/chi tiết bệnh, tìm kiếm có dấu/không dấu, chống injection/XSS, liên kết triệu chứng–bệnh và API nghiên cứu. Nó không thay thế kiểm thử trình duyệt cho bản tĩnh.

Checklist bản tĩnh:

- Mở trang chủ: số liệu lấy từ snapshot, không có lỗi console.
- Danh sách bệnh và chi tiết bệnh có dữ liệu; bản ghi thiếu hiển thị “Chưa có dữ liệu đáng tin cậy”.
- Tìm kiếm bệnh/thuốc, gợi ý header, lọc gene riêng.
- Mở một gene, một thuốc (nhãn openFDA), một xét nghiệm, một mã ICD-10.
- Mở mô hình 3D, xoay/zoom/lọc lớp; mở chi tiết thuật ngữ giải phẫu.
- Tìm Europe PMC/PubMed, mở một bài; tìm ClinicalTrials.gov.
- Hỏi trợ lý một câu có dữ liệu và một câu không có dữ liệu; kiểm tra trích dẫn và cảnh báo.
- Bấm “Tải JSON” trên trang bệnh; kiểm tra tệp JSON tải xuống. In/lưu PDF bằng trình duyệt.
- Kiểm tra không còn liên kết `#/admin` hoặc nút đồng bộ.

---

## 10. Giới hạn đã biết

- **Dữ liệu đóng băng:** bản công khai không tự cập nhật; phải build lại và triển khai.
- **Không có tài khoản:** không có đăng nhập, yêu thích, ghi chú hay lịch sử đọc.
- **Tìm kiếm tĩnh:** chỉ mục tĩnh có thể tải vài MB; gene tách riêng để giảm tải. Kết quả gần đúng có thể khác FTS5/BM25 của bản server. Gene vẫn có trang danh sách và tìm kiếm riêng.
- **Dữ liệu y khoa không đầy đủ:** 26.468 bệnh chưa phải toàn bộ y học; 78 bệnh có bản dịch tiếng Việt chính thức trong snapshot hiện tại. Tên tiếng Anh luôn được hiển thị.
- **Dịch tiếng Việt:** một số nhãn biên tập có trạng thái `machine_draft` và được ghi “chưa xác thực”.
- **Xét nghiệm:** không đưa một khoảng tham chiếu chung; kết quả phải được bác sĩ diễn giải.
- **Nghiên cứu/thử nghiệm:** phụ thuộc kết nối mạng, CORS và giới hạn của nguồn; abstract/giấy phép có thể thiếu.
- **Nhãn thuốc:** openFDA có thể không trả nhãn cho một NDC; khi đó trang vẫn hiển thị dữ liệu sản phẩm NDC.
- **Dữ liệu Hoa Kỳ:** openFDA và ICD-10-CM phản ánh phạm vi Hoa Kỳ, không đại diện mọi quốc gia.
- **Không dùng cho chẩn đoán:** mọi nội dung chỉ nhằm giáo dục; không thay thế nhân viên y tế.

---

## 11. Bảo mật

- Bản công khai không có API ghi, không có admin, không có token máy chủ, không có database kết nối.
- `vercel.json` đặt CSP, chặn frame, nosniff và giới hạn `connect-src` đúng các API nghiên cứu.
- Dữ liệu snapshot là công khai; không chứa khóa bí mật.
- Server local, nếu chạy, dùng SQLite tham số hóa và kiểm tra quyền admin; không công khai server này khi chỉ muốn dùng bản tĩnh.
- Trước khi cập nhật snapshot, kiểm tra lại giấy phép nguồn và không đưa dữ liệu không có quyền phân phối vào repo.

---

## 12. Giấy phép

Mã nguồn: MIT. Dữ liệu thuộc giấy phép của từng nguồn như bảng trên; khi tái sử dụng phải giữ ghi công và liên kết nguồn tương ứng.
