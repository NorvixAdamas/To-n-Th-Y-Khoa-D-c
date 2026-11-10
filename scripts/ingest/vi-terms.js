'use strict';
/**
 * Curated Vietnamese labels for a small set of common diseases and symptoms.
 * These are editorial translations of the English source labels, not a
 * substitute for a source-verified translation: every row is stored with
 * status = "machine_draft" and shown with a "chưa xác thực" badge.
 */
const db = require('../../server/db');

const DISEASES = [
  ['MONDO:0005015', 'Đái tháo đường'],
  ['MONDO:0005147', 'Đái tháo đường type 1'],
  ['MONDO:0005148', 'Đái tháo đường type 2'],
  ['MONDO:0004979', 'Hen phế quản'],
  ['MONDO:0005002', 'Bệnh phổi tắc nghẽn mạn tính'],
  ['MONDO:0001134', 'Tăng huyết áp nguyên phát'],
  ['MONDO:0005249', 'Viêm phổi'],
  ['MONDO:0018076', 'Bệnh lao'],
  ['MONDO:0100096', 'COVID-19'],
  ['MONDO:0005136', 'Sốt rét'],
  ['MONDO:0005502', 'Sốt xuất huyết Dengue'],
  ['MONDO:0005344', 'Viêm gan B'],
  ['MONDO:0001106', 'Suy thận'],
  ['MONDO:0005300', 'Bệnh thận mạn'],
  ['MONDO:0005252', 'Suy tim'],
  ['MONDO:0005068', 'Nhồi máu cơ tim'],
  ['MONDO:0005098', 'Đột quỵ'],
  ['MONDO:0005027', 'Động kinh'],
  ['MONDO:0005277', 'Đau nửa đầu'],
  ['MONDO:0004975', 'Bệnh Alzheimer'],
  ['MONDO:0005180', 'Bệnh Parkinson'],
  ['MONDO:0005301', 'Bệnh đa xơ cứng'],
  ['MONDO:0005090', 'Tâm thần phân liệt'],
  ['MONDO:0002009', 'Rối loạn trầm cảm chính'],
  ['MONDO:0004985', 'Rối loạn lưỡng cực'],
  ['MONDO:0005618', 'Rối loạn lo âu'],
  ['MONDO:0008383', 'Viêm khớp dạng thấp'],
  ['MONDO:0005178', 'Thoái hóa khớp'],
  ['MONDO:0005083', 'Vảy nến'],
  ['MONDO:0007254', 'Ung thư vú'],
  ['MONDO:0008903', 'Ung thư phổi'],
  ['MONDO:0005575', 'Ung thư đại trực tràng'],
  ['MONDO:0008315', 'Ung thư tuyến tiền liệt'],
  ['MONDO:0005059', 'Bạch cầu cấp'],
  ['MONDO:0005062', 'U lympho'],
  ['MONDO:0002280', 'Thiếu máu'],
  ['MONDO:0001356', 'Thiếu máu thiếu sắt'],
  ['MONDO:0005420', 'Suy giáp'],
  ['MONDO:0004425', 'Cường giáp'],
  ['MONDO:0011122', 'Béo phì'],
  ['MONDO:0005393', 'Gút'],
  ['MONDO:0005298', 'Loãng xương'],
  ['MONDO:0005649', 'Viêm ruột thừa'],
  ['MONDO:0004247', 'Loét dạ dày - tá tràng'],
  ['MONDO:0005155', 'Xơ gan'],
  ['MONDO:0004982', 'Viêm tụy'],
  ['MONDO:0005346', 'Sỏi mật'],
  ['MONDO:0100338', 'Nhiễm trùng đường tiết niệu'],
  ['MONDO:0005812', 'Cúm'],
  ['MONDO:0004619', 'Bệnh sởi'],
  ['MONDO:0005608', 'Thủy đậu'],
  ['MONDO:0005609', 'Zona thần kinh'],
  ['MONDO:0004656', 'Bệnh rubella'],
  ['MONDO:0000989', 'Bệnh quai bị'],
  ['MONDO:0019173', 'Bệnh dại'],
  ['MONDO:0005526', 'Uốn ván'],
  ['MONDO:0005619', 'Thương hàn'],
  ['MONDO:0015766', 'Bệnh tả'],
  ['MONDO:0005825', 'Bệnh Leptospirosis'],
  ['MONDO:0005779', 'Tay chân miệng'],
  ['MONDO:0005041', 'Glôcôm'],
  ['MONDO:0005129', 'Đục thủy tinh thể'],
  ['MONDO:0005441', 'Viêm tai giữa'],
  ['MONDO:0005961', 'Viêm xoang'],
  ['MONDO:0001627', 'Sa sút trí tuệ'],
  ['MONDO:0004981', 'Rung nhĩ'],
  ['MONDO:0007186', 'Trào ngược dạ dày - thực quản'],
  ['MONDO:0005052', 'Hội chứng ruột kích thích'],
  ['MONDO:0005265', 'Bệnh viêm ruột'],
  ['MONDO:0005011', 'Bệnh Crohn'],
  ['MONDO:0005101', 'Viêm loét đại tràng'],
  ['MONDO:0005130', 'Bệnh celiac'],
  ['MONDO:0008661', 'Bạch biến'],
  ['MONDO:0011438', 'Mụn trứng cá'],
  ['MONDO:0005492', 'Mày đay'],
  ['MONDO:0700226', 'Dị ứng thức ăn'],
  ['MONDO:0100053', 'Sốc phản vệ'],
  ['MONDO:0021187', 'Rối loạn lipid máu']
];

const SYMPTOMS = [
  ['HP:0001945', 'Sốt'],
  ['HP:0012735', 'Ho'],
  ['HP:0002094', 'Khó thở'],
  ['HP:0002315', 'Đau đầu'],
  ['HP:0002018', 'Buồn nôn'],
  ['HP:0002013', 'Nôn'],
  ['HP:0002014', 'Tiêu chảy'],
  ['HP:0002019', 'Táo bón'],
  ['HP:0002027', 'Đau bụng'],
  ['HP:0100749', 'Đau ngực'],
  ['HP:0012378', 'Mệt mỏi'],
  ['HP:0000989', 'Ngứa'],
  ['HP:0000969', 'Phù'],
  ['HP:0001279', 'Ngất'],
  ['HP:0001250', 'Co giật'],
  ['HP:0001289', 'Lú lẫn'],
  ['HP:0001824', 'Sụt cân'],
  ['HP:0030166', 'Đổ mồ hôi đêm'],
  ['HP:0031417', 'Chảy nước mũi'],
  ['HP:0030828', 'Khò khè'],
  ['HP:0001962', 'Hồi hộp'],
  ['HP:0000952', 'Vàng da'],
  ['HP:0000790', 'Tiểu máu'],
  ['HP:0100518', 'Tiểu buốt'],
  ['HP:0003418', 'Đau lưng'],
  ['HP:0002829', 'Đau khớp'],
  ['HP:0003326', 'Đau cơ'],
  ['HP:0100785', 'Mất ngủ'],
  ['HP:0000739', 'Lo âu'],
  ['HP:0033834', 'Mệt lả'],
  ['HP:0002039', 'Chán ăn'],
  ['HP:0001649', 'Nhịp tim nhanh'],
  ['HP:0001662', 'Nhịp tim chậm'],
  ['HP:0002615', 'Huyết áp thấp'],
  ['HP:0000822', 'Huyết áp cao'],
  ['HP:0000961', 'Tím tái'],
  ['HP:0001541', 'Cổ trướng'],
  ['HP:0002716', 'Hạch to'],
  ['HP:0002240', 'Gan to'],
  ['HP:0001744', 'Lách to'],
  ['HP:0001337', 'Run'],
  ['HP:0001251', 'Mất điều hòa'],
  ['HP:0003401', 'Dị cảm'],
  ['HP:0002015', 'Khó nuốt'],
  ['HP:0002248', 'Nôn ra máu'],
  ['HP:0002249', 'Phân đen'],
  ['HP:0002105', 'Ho ra máu'],
  ['HP:0000017', 'Tiểu đêm'],
  ['HP:0000103', 'Tiểu nhiều'],
  ['HP:0001959', 'Khát nhiều'],
  ['HP:0025143', 'Ớn lạnh'],
  ['HP:0001742', 'Nghẹt mũi'],
  ['HP:0030766', 'Đau tai'],
  ['HP:0000622', 'Nhìn mờ'],
  ['HP:0000613', 'Sợ ánh sáng'],
  ['HP:0000651', 'Nhìn đôi'],
  ['HP:0000360', 'Ù tai'],
  ['HP:0002321', 'Chóng mặt'],
  ['HP:0012764', 'Khó thở khi nằm'],
  ['HP:0010307', 'Thở rít'],
  ['HP:0031352', 'Tức ngực'],
  ['HP:0410281', 'Khó tiêu'],
  ['HP:0033589', 'Đầy hơi'],
  ['HP:0040319', 'Nước tiểu sẫm màu'],
  ['HP:0000020', 'Són tiểu'],
  ['HP:0040279', 'Tiểu nhiều lần'],
  ['HP:0100520', 'Thiểu niệu'],
  ['HP:0100519', 'Vô niệu'],
  ['HP:0010783', 'Ban đỏ'],
  ['HP:0000967', 'Chấm xuất huyết'],
  ['HP:0031364', 'Vết bầm'],
  ['HP:0000979', 'Ban xuất huyết'],
  ['HP:0001596', 'Rụng tóc'],
  ['HP:0000975', 'Tăng tiết mồ hôi'],
  ['HP:6000855', 'Sợ lạnh'],
  ['HP:0002046', 'Sợ nóng'],
  ['HP:0000853', 'Bướu giáp']
];

const conn = db.open();
const provider = 'Biên tập nền tảng — bản dịch chưa xác thực';
let diseases = 0, symptoms = 0;
conn.exec('BEGIN');
const upDisease = conn.prepare("UPDATE diseases SET name_vi=?, name_vi_status='machine_draft' WHERE mondo_id=?");
const upSymptom = conn.prepare("UPDATE symptoms SET name_vi=?, name_vi_status='machine_draft' WHERE hpo_id=?");
const tr = conn.prepare(`INSERT INTO translations (entity_type, entity_id, lang, field, value, status, provider, created_at)
  VALUES (?, ?, 'vi', 'name', ?, 'machine_draft', ?, ?)
  ON CONFLICT(entity_type, entity_id, lang, field) DO UPDATE SET value=excluded.value, status=excluded.status, provider=excluded.provider, created_at=excluded.created_at`);
const findDisease = conn.prepare('SELECT id FROM diseases WHERE mondo_id=?');
const findSymptom = conn.prepare('SELECT id FROM symptoms WHERE hpo_id=?');
const now = new Date().toISOString();
for (const [mondo, vi] of DISEASES) {
  const info = upDisease.run(vi, mondo);
  if (!info.changes) continue;
  diseases++;
  const row = findDisease.get(mondo);
  if (row) tr.run('disease', row.id, vi, provider, now);
}
for (const [hpo, vi] of SYMPTOMS) {
  const info = upSymptom.run(vi, hpo);
  if (!info.changes) continue;
  symptoms++;
  const row = findSymptom.get(hpo);
  if (row) tr.run('symptom', row.id, vi, provider, now);
}
conn.exec('COMMIT');
console.log(`Đã gắn nhãn tiếng Việt (chưa xác thực): ${diseases} bệnh, ${symptoms} triệu chứng.`);
conn.close();
