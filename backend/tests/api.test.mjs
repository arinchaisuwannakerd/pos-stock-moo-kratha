const BASE = 'http://localhost:4000/api';
let token = '';
let pass = 0, fail = 0;

async function call(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.noAuth ? {} : token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`, JSON.stringify(extra)?.slice(0, 400)); }
}

const r = (n) => Math.round(n * 100) / 100;

console.log('\n=== 1. Health & Auth ===');
let x = await call('GET', '/health', null, { noAuth: true });
check('GET /health', x.status === 200 && x.json.ok, x.json);

x = await call('POST', '/auth/login', { username: 'owner', password: 'wrong' }, { noAuth: true });
check('login รหัสผิด -> 401', x.status === 401, x.json);

x = await call('POST', '/auth/login', { username: 'owner', password: 'owner123' }, { noAuth: true });
check('login สำเร็จ -> token', x.status === 200 && !!x.json.token, x.json);
token = x.json.token;

x = await call('GET', '/tables', null, { noAuth: true });
check('เรียก /tables โดยไม่มี token -> 401', x.status === 401, x.json);

x = await call('GET', '/auth/me');
check('GET /auth/me', x.status === 200 && x.json.data.username === 'owner', x.json);

console.log('\n=== 2. ผังโต๊ะ / เมนู / วัตถุดิบ ===');
x = await call('GET', '/tables');
check('มีโต๊ะครบ 20 โต๊ะ', x.json.data.length === 20, { n: x.json.data?.length });
check('โต๊ะว่างทั้งหมดตอนเริ่ม', x.json.summary.FREE === 20, x.json.summary);

x = await call('GET', '/menu?with_stock=true');
check('GET /menu = 31 เมนู', x.json.count === 31, { n: x.json.count });
const bbqSet = x.json.data.find((m) => m.sku === 'MN-B01');
check('เมนู MN-B01 มี max_servable', typeof bbqSet.max_servable === 'number', bbqSet);

x = await call('GET', '/menu/' + bbqSet.id);
check('GET /menu/:id มีสูตร BOM 12 รายการ', x.json.data.recipe.length === 12, { n: x.json.data.recipe?.length });
check('คำนวณ food_cost ได้', x.json.data.food_cost > 0, x.json.data.food_cost);

x = await call('GET', '/ingredients');
check('GET /ingredients = 34 รายการ', x.json.data.length === 34, { n: x.json.data?.length });
const porkBefore = x.json.data.find((i) => i.sku === 'ING-M01').qty_on_hand;
check('หมูสไลซ์ตั้งต้น 45 กก.', porkBefore === 45, porkBefore);

console.log('\n=== 3. เปิดบิล + ตัดสต็อกตาม BOM ===');
x = await call('POST', '/orders', {
  table_no: 'T05', guest_count: 4,
  items: [{ menu_sku: 'MN-B02', qty: 1 }, { menu_sku: 'MN-D02', qty: 4 }],
});
check('เปิดบิลโต๊ะ T05 -> 201', x.status === 201, x.json);
const order = x.json.order;
check('บิลมีเลขที่ OD...', /^OD\d{8}-\d{4}$/.test(order.order_no), order.order_no);
check('ยอดบิล = 549 + 4x25 = 649', r(order.grand_total) === 649, order.grand_total);
const orderId = order.id;

x = await call('GET', '/ingredients');
const porkAfter = x.json.data.find((i) => i.sku === 'ING-M01').qty_on_hand;
check('ตัดหมูสไลซ์ 0.8 กก. (45 -> 44.2)', r(porkAfter) === 44.2, { porkBefore, porkAfter });
const cokeAfter = x.json.data.find((i) => i.sku === 'ING-D02').qty_on_hand;
check('ตัดโค้ก 4 กระป๋อง (96 -> 92)', cokeAfter === 92, cokeAfter);

x = await call('GET', '/tables');
check('โต๊ะ T05 เปลี่ยนเป็น OCCUPIED', x.json.data.find((t) => t.table_no === 'T05').status === 'OCCUPIED');
check('สรุปผัง: ว่าง 19 / ใช้งาน 1', x.json.summary.FREE === 19 && x.json.summary.OCCUPIED === 1, x.json.summary);

console.log('\n=== 4. สั่งเพิ่มระหว่างทาน ===');
x = await call('POST', `/orders/${orderId}/items`, {
  items: [{ menu_sku: 'MN-B04', qty: 2, note: 'ไม่ใส่พริก' }, { menu_sku: 'MN-S01', qty: 1 }],
});
check('สั่งเพิ่ม -> 201', x.status === 201, x.json);
check('ยอดใหม่ = 649 + 158 + 69 = 876', r(x.json.order.grand_total) === 876, x.json.order.grand_total);
check('รายการรอบที่ 2 ถูกบันทึก', x.json.order.items.some((i) => i.round_no === 2), x.json.order.items.map((i) => i.round_no));

x = await call('GET', '/ingredients');
const porkAfter2 = x.json.data.find((i) => i.sku === 'ING-M01').qty_on_hand;
check('ตัดหมูเพิ่ม 0.4 กก. (44.2 -> 43.8)', r(porkAfter2) === 43.8, porkAfter2);

console.log('\n=== 5. ยกเลิกรายการ -> คืนสต็อก ===');
const cancelTarget = x.json.data && null;
let full = (await call('GET', `/orders/${orderId}`)).json.data;
const friesItem = full.items.find((i) => i.sku === 'MN-S01');
x = await call('DELETE', `/orders/${orderId}/items/${friesItem.id}`);
check('ยกเลิกเฟรนช์ฟรายส์ -> 200', x.status === 200, x.json);
check('ยอดลดเหลือ 807', r(x.json.data.grand_total) === 807, x.json.data.grand_total);

console.log('\n=== 6. แก้จำนวน ===');
full = (await call('GET', `/orders/${orderId}`)).json.data;
const porkItem = full.items.find((i) => i.sku === 'MN-B04');
x = await call('PATCH', `/orders/${orderId}/items/${porkItem.id}`, { qty: 3 });
check('เพิ่มหมูสไลซ์เป็น 3 จาน', r(x.json.order.grand_total) === 886, x.json.order.grand_total);

x = await call('GET', '/ingredients');
const porkAfter3 = x.json.data.find((i) => i.sku === 'ING-M01').qty_on_hand;
check('ตัดหมูอีก 0.2 กก. (43.8 -> 43.6)', r(porkAfter3) === 43.6, porkAfter3);

console.log('\n=== 7. วัตถุดิบไม่พอ -> ปฏิเสธ ===');
x = await call('POST', `/orders/${orderId}/items`, { items: [{ menu_sku: 'MN-B08', qty: 999 }] });
check('สั่งเกินสต็อก -> 409', x.status === 409, { status: x.status, err: x.json.error });
check('ข้อความบอกวัตถุดิบที่ขาด', /ไม่พอ/.test(x.json.error || ''), x.json.error);

console.log('\n=== 8. เช็คบิล + QR + ชำระเงิน ===');
x = await call('POST', `/orders/${orderId}/bill`);
check('เรียกเช็คบิล -> BILLING', x.json.data.status === 'BILLING', x.json.data?.status);

x = await call('GET', '/tables');
check('โต๊ะ T05 = BILLING (รอชำระเงิน)', x.json.data.find((t) => t.table_no === 'T05').status === 'BILLING');

x = await call('GET', `/payments/qr/${orderId}`);
check('สร้าง QR พร้อมเพย์ได้', x.status === 200 && x.json.data.qr_payload.startsWith('000201'), x.json.data?.qr_payload?.slice(0, 30));
check('QR ระบุยอด 886.00', x.json.data.qr_payload.includes('5406886.00'), x.json.data?.qr_payload);

x = await call('POST', '/payments', { order_id: orderId, method: 'CASH', received: 500 });
check('รับเงินน้อยกว่ายอด -> 400', x.status === 400, { status: x.status, err: x.json.error });

x = await call('POST', '/payments', { order_id: orderId, method: 'CASH', received: 1000 });
check('ชำระเงินสด -> 201', x.status === 201, x.json);
check('เงินทอน = 114', r(x.json.payment.change_amount) === 114, x.json.payment?.change_amount);
check('บิลปิดเป็น PAID', x.json.order.status === 'PAID', x.json.order?.status);
check('มีเลขใบเสร็จ RC...', /^RC\d{8}-\d{4}$/.test(x.json.payment.receipt_no), x.json.payment?.receipt_no);

x = await call('GET', '/tables');
check('โต๊ะ T05 กลับมาว่าง', x.json.data.find((t) => t.table_no === 'T05').status === 'FREE');

x = await call('POST', '/payments', { order_id: orderId, method: 'CASH', received: 1000 });
check('ชำระซ้ำ -> 409', x.status === 409, { status: x.status, err: x.json.error });

x = await call('GET', `/payments/receipt/${orderId}`);
check('ดึงข้อมูลใบเสร็จได้', x.status === 200 && x.json.data.items.length === 3, x.json.data?.items?.length);
check('ใบเสร็จมีชื่อร้าน', !!x.json.data.shop.name, x.json.data?.shop);

console.log('\n=== 9. ฝั่งลูกค้า (ไม่ต้องล็อกอิน) ===');
x = await call('GET', '/public/menu', null, { noAuth: true });
check('ลูกค้าดูเมนูได้โดยไม่ต้องล็อกอิน', x.status === 200 && x.json.count === 31, x.json.count);

x = await call('POST', '/public/tables/T12/order', {
  items: [{ menu_sku: 'MN-B01', qty: 1 }, { menu_sku: 'MN-D01', qty: 2 }],
}, { noAuth: true });
check('ลูกค้าสั่งอาหารเอง -> 201', x.status === 201, x.json);
check('เปิดบิลใหม่อัตโนมัติ', x.json.is_new_order === true, x.json.is_new_order);
check('ยอด = 299 + 30 = 329', r(x.json.order.grand_total) === 329, x.json.order?.grand_total);
const custOrderId = x.json.order.id;

x = await call('POST', '/public/tables/T12/order', { items: [{ menu_sku: 'MN-B16', qty: 2 }] }, { noAuth: true });
check('ลูกค้าสั่งเพิ่ม รอบที่ 2', x.json.round_no === 2, x.json.round_no);
check('ยอด = 329 + 30 = 359', r(x.json.order.grand_total) === 359, x.json.order?.grand_total);

x = await call('GET', '/public/tables/T12/bill', null, { noAuth: true });
check('ลูกค้าดูสรุปบิลได้', x.status === 200 && x.json.data.grand_total === 359, x.json.data?.grand_total);

x = await call('POST', '/public/tables/T12/bill', null, { noAuth: true });
check('ลูกค้าเรียกเช็คบิลเอง', x.json.data.status === 'BILLING', x.json.data?.status);

x = await call('POST', '/public/tables/T12/order', { items: [{ menu_sku: 'MN-D01', qty: 1 }] }, { noAuth: true });
check('เช็คบิลแล้วสั่งเพิ่มไม่ได้ -> 409', x.status === 409, { status: x.status, err: x.json.error });

x = await call('POST', '/payments', { order_id: custOrderId, method: 'QR', reference_no: 'TXN-0099' });
check('ชำระผ่าน QR -> 201', x.status === 201 && x.json.order.status === 'PAID', x.json);

console.log('\n=== 10. รับเข้า / เบิกใช้ / ปรับยอดวัตถุดิบ ===');
x = await call('POST', '/stock/in', {
  supplier: 'ตลาดสดเทศบาลกาญจนบุรี',
  lines: [
    { ingredient_sku: 'ING-M01', qty: 20, unit_cost: 150 },
    { ingredient_sku: 'ING-V01', qty: 15, unit_cost: 30 },
  ],
});
check('บันทึกรับเข้า -> 201', x.status === 201, x.json);
check('เลขเอกสาร IN...', /^IN\d{8}-\d{4}$/.test(x.json.data.doc_no), x.json.data?.doc_no);
check('มูลค่ารับเข้า = 3450', r(x.json.data.total_cost) === 3450, x.json.data?.total_cost);

x = await call('GET', '/ingredients');
const porkFinal = x.json.data.find((i) => i.sku === 'ING-M01');
check('หมูสไลซ์เพิ่มเป็น 63.2 กก.', r(porkFinal.qty_on_hand) === 63.2, porkFinal.qty_on_hand);
check('ต้นทุนอัปเดตเป็น 150', porkFinal.cost_per_unit === 150, porkFinal.cost_per_unit);

x = await call('POST', '/stock/issue', { note: 'เบิกไปเตรียมครัว', lines: [{ ingredient_sku: 'ING-V01', qty: 5 }] });
check('บันทึกเบิกใช้ -> 201', x.status === 201 && /^IS/.test(x.json.data.doc_no), x.json.data?.doc_no);

x = await call('POST', '/stock/adjust', { ingredient_sku: 'ING-V06', counted_qty: 2 });
check('ปรับยอดจากการนับ -> 200', x.status === 200, x.json);
check('ยอดหลังปรับ = 2', x.json.data.balance_after === 2, x.json.data?.balance_after);
check('แจ้งว่าต่ำกว่าขั้นต่ำ', x.json.data.is_low === true, x.json.data);

console.log('\n=== 11. แจ้งเตือนวัตถุดิบใกล้หมด ===');
x = await call('GET', '/stock/low');
check('GET /stock/low ทำงาน', x.status === 200, x.json);
check('พบวัตถุดิบใกล้หมด', x.json.count > 0, { count: x.json.count, items: x.json.data?.map((d) => d.name_th) });
check('เห็ดออรินจิอยู่ในรายการเตือน', x.json.data.some((d) => d.sku === 'ING-V06'), x.json.data?.map((d) => d.sku));

console.log('\n=== 12. รายงาน ===');
x = await call('GET', '/reports/dashboard');
check('รายงาน dashboard', x.status === 200 && x.json.data.today.bills === 2, x.json.data?.today);
check('ยอดขายวันนี้ = 886 + 359 = 1245', r(x.json.data.today.sales) === 1245, x.json.data?.today?.sales);
check('นับโต๊ะว่าง 20 โต๊ะ', x.json.data.tables.free === 20, x.json.data?.tables);
check('มีจำนวนวัตถุดิบใกล้หมด', x.json.data.low_stock_count > 0, x.json.data?.low_stock_count);

for (const g of ['day', 'week', 'month']) {
  x = await call('GET', `/reports/sales?group=${g}`);
  check(`รายงานยอดขายราย${g}`, x.status === 200 && x.json.totals.grand_total === 1245, { g, t: x.json.totals });
}

x = await call('GET', '/reports/top-menu');
check('รายงานเมนูขายดี', x.status === 200 && x.json.data.length > 0, x.json.count);
check('อันดับ 1 มี rank = 1', x.json.data[0].rank === 1, x.json.data?.[0]);

x = await call('GET', '/reports/stock?only_low=true');
check('รายงานวัตถุดิบใกล้หมด', x.status === 200 && x.json.data.length > 0, x.json.count);

x = await call('GET', '/reports/stock-movements');
check('รายงานการเคลื่อนไหววัตถุดิบ', x.status === 200 && x.json.data.length > 0, x.json.count);
check('มีทั้ง IN / ISSUE / SALE / ADJUST',
  ['IN', 'ISSUE', 'SALE', 'ADJUST'].every((t) => x.json.data.some((r) => r.movement_type === t)),
  [...new Set(x.json.data.map((r) => r.movement_type))]);

x = await call('GET', '/reports/bills');
check('รายงานบิลขาย', x.status === 200 && x.json.data.length === 2, x.json.count);

x = await call('GET', '/reports/payment-methods');
check('รายงานช่องทางชำระเงิน', x.status === 200 && x.json.data.length === 2, x.json.data);

console.log('\n=== 13. ส่งออก CSV (MS-Excel) ===');
const csvRes = await fetch(`${BASE}/reports/top-menu?format=csv`, { headers: { Authorization: `Bearer ${token}` } });
const csvText = await csvRes.text();
check('ส่งออก CSV ได้', csvRes.headers.get('content-type').includes('text/csv'), csvRes.headers.get('content-type'));
const csvBuf = Buffer.from(await (await fetch(`${BASE}/reports/top-menu?format=csv`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
check('CSV มี BOM ให้ Excel อ่านไทยได้', csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf, [...csvBuf.slice(0,3)]);
check('CSV มีหัวตารางภาษาไทย', csvText.includes('อันดับ') && csvText.includes('ชื่อเมนู'), csvText.split('\r\n')[0]);

console.log('\n=== 14. สิทธิ์ผู้ใช้ ===');
x = await call('POST', '/auth/login', { username: 'staff1', password: 'staff123' }, { noAuth: true });
const staffToken = x.json.token;
const ownerToken = token;
token = staffToken;
x = await call('POST', '/stock/adjust', { ingredient_sku: 'ING-M01', counted_qty: 10 });
check('พนักงานปรับยอดสต็อกไม่ได้ -> 403', x.status === 403, { status: x.status, err: x.json.error });
x = await call('POST', '/menu', { sku: 'X', name_th: 'x', price: 1, category_code: 'BBQ' });
check('พนักงานเพิ่มเมนูไม่ได้ -> 403', x.status === 403, x.status);
x = await call('POST', '/orders', { table_no: 'T01', items: [{ menu_sku: 'MN-D01', qty: 1 }] });
check('พนักงานเปิดบิลได้ -> 201', x.status === 201, x.status);
await call('POST', `/orders/${x.json.order.id}/void`, { reason: 'ทดสอบระบบ' });
token = ownerToken;

console.log('\n=== 15. ยกเลิกบิล -> คืนสต็อกครบ ===');
x = await call('GET', '/ingredients');
const waterBefore = x.json.data.find((i) => i.sku === 'ING-D01').qty_on_hand;
x = await call('POST', '/orders', { table_no: 'T20', items: [{ menu_sku: 'MN-D01', qty: 5 }] });
const voidId = x.json.order.id;
x = await call('GET', '/ingredients');
check('ตัดน้ำดื่ม 5 ขวด', x.json.data.find((i) => i.sku === 'ING-D01').qty_on_hand === waterBefore - 5);
x = await call('POST', `/orders/${voidId}/void`, { reason: 'ลูกค้ายกเลิก' });
check('ยกเลิกบิล -> VOID', x.json.data.status === 'VOID', x.json.data?.status);
x = await call('GET', '/ingredients');
check('คืนน้ำดื่มครบ 5 ขวด', x.json.data.find((i) => i.sku === 'ING-D01').qty_on_hand === waterBefore, {
  before: waterBefore, after: x.json.data.find((i) => i.sku === 'ING-D01').qty_on_hand,
});
x = await call('GET', '/tables');
check('โต๊ะ T20 กลับมาว่าง', x.json.data.find((t) => t.table_no === 'T20').status === 'FREE');

console.log('\n=== 16. กติกาความถูกต้องของข้อมูล ===');
x = await call('POST', '/orders', { table_no: 'T07', items: [{ menu_sku: 'MN-D01', qty: 1 }] });
const dupTableOrder = x.json.order.id;
x = await call('POST', '/orders', { table_no: 'T07' });
check('เปิดบิลซ้ำโต๊ะเดิม -> 409', x.status === 409, { status: x.status, err: x.json.error });
await call('POST', `/orders/${dupTableOrder}/void`, { reason: 'cleanup' });

x = await call('POST', '/orders', { table_no: 'T99' });
check('โต๊ะไม่มีจริง -> 404', x.status === 404, x.status);
x = await call('POST', '/orders', { guest_count: 2 });
check('ไม่ระบุโต๊ะ -> 400', x.status === 400, x.status);
x = await call('GET', '/orders/999999');
check('บิลไม่มีจริง -> 404', x.status === 404, x.status);
x = await call('GET', '/nope');
check('เส้นทางไม่มีจริง -> 404', x.status === 404, x.status);

console.log(`\n${'='.repeat(50)}`);
console.log(`  ผ่าน ${pass} รายการ / ไม่ผ่าน ${fail} รายการ`);
console.log(`${'='.repeat(50)}\n`);
process.exit(fail ? 1 : 0);
