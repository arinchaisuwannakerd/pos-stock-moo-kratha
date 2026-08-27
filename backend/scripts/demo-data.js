/**
 * สร้างข้อมูลขายย้อนหลังสำหรับสาธิตรายงาน
 *   node scripts/demo-data.js [จำนวนวัน]     (ค่าเริ่มต้น 45 วัน)
 *
 * สคริปต์นี้เขียนบิลที่ปิดแล้วลงฐานข้อมูลโดยตรง พร้อมบันทึก ledger การตัดสต็อก
 * และเติมวัตถุดิบเข้าคลังเป็นระยะ เพื่อไม่ให้สต็อกติดลบระหว่างจำลอง
 */
import 'dotenv/config';
import { pool } from '../src/db.js';

const DAYS = Number(process.argv[2]) || 45;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const money = (n) => Math.round(n * 100) / 100;
const q3 = (n) => Math.round(n * 1000) / 1000;

async function main() {
  const client = await pool.connect();
  try {
    const { rows: menu } = await client.query(
      `SELECT m.id, m.price, m.name_th, c.code FROM menu_items m JOIN categories c ON c.id = m.category_id
        WHERE m.is_available`
    );
    const { rows: tables } = await client.query('SELECT id, table_no, seats FROM dining_tables ORDER BY id');
    const { rows: users } = await client.query(`SELECT id FROM users WHERE role = 'STAFF' OR role = 'OWNER'`);
    const { rows: recipes } = await client.query('SELECT menu_item_id, ingredient_id, qty_per_unit FROM recipes');

    const bomOf = new Map();
    for (const r of recipes) {
      if (!bomOf.has(r.menu_item_id)) bomOf.set(r.menu_item_id, []);
      bomOf.get(r.menu_item_id).push(r);
    }

    const sets = menu.filter((m) => m.code === 'BBQ' && m.price >= 299);
    const extras = menu.filter((m) => m.code === 'BBQ' && m.price < 299);
    const snacks = menu.filter((m) => m.code === 'SNACK');
    const drinks = menu.filter((m) => m.code === 'DRINK');
    const ices = menu.filter((m) => m.code === 'ICE');

    let bills = 0;
    let revenue = 0;

    for (let d = DAYS; d >= 1; d--) {
      const day = new Date();
      day.setDate(day.getDate() - d);
      const dow = day.getDay();
      // ศุกร์-อาทิตย์ ลูกค้าเยอะกว่าวันธรรมดา
      const busy = dow === 5 || dow === 6 || dow === 0;
      const billCount = Math.round(rnd(busy ? 14 : 6, busy ? 26 : 14));

      // เติมสต็อกตอนเช้าทุกวัน เพื่อให้จำลองการขายได้ต่อเนื่อง
      await restock(client, day, users[0].id);

      for (let b = 0; b < billCount; b++) {
        const table = pick(tables);
        const guests = Math.max(2, Math.round(rnd(2, table.seats)));
        const staff = pick(users).id;

        const openHour = rnd(16, 21);
        const openedAt = new Date(day);
        openedAt.setHours(Math.floor(openHour), Math.floor(rnd(0, 59)), 0, 0);
        const closedAt = new Date(openedAt.getTime() + rnd(50, 130) * 60000);

        // ประกอบรายการอาหารของบิลนี้
        const lines = [];
        const set = pick(sets);
        lines.push({ m: set, qty: 1, round: 1 });
        for (const dk of drinks) if (Math.random() < 0.25) lines.push({ m: dk, qty: Math.ceil(rnd(1, guests)), round: 1 });
        if (Math.random() < 0.55) lines.push({ m: pick(ices), qty: 1, round: 1 });
        if (Math.random() < 0.5) lines.push({ m: pick(snacks), qty: 1, round: 1 });
        // สั่งเพิ่มระหว่างทาน
        const extraCount = Math.round(rnd(0, 4));
        for (let i = 0; i < extraCount; i++) lines.push({ m: pick(extras), qty: Math.ceil(rnd(1, 2)), round: 2 });

        const subtotal = money(lines.reduce((s, l) => s + Number(l.m.price) * l.qty, 0));
        const discount = Math.random() < 0.12 ? Math.round(rnd(20, 80) / 10) * 10 : 0;
        const grand = money(Math.max(subtotal - discount, 0));

        const orderNo = await docNo(client, 'orders', 'order_no', 'OD', openedAt);
        const { rows: [order] } = await client.query(
          `INSERT INTO orders (order_no, table_id, status, channel, guest_count, subtotal, discount,
                               grand_total, opened_by, closed_by, opened_at, closed_at)
           VALUES ($1,$2,'PAID',$3,$4,$5,$6,$7,$8,$8,$9,$10) RETURNING id`,
          [orderNo, table.id, Math.random() < 0.25 ? 'CUSTOMER' : 'STAFF', guests,
           subtotal, discount, grand, staff, openedAt, closedAt]
        );

        for (const l of lines) {
          await client.query(
            `INSERT INTO order_items (order_id, menu_item_id, qty, unit_price, line_total, round_no, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [order.id, l.m.id, l.qty, l.m.price, money(Number(l.m.price) * l.qty), l.round, openedAt]
          );
          await consume(client, bomOf.get(l.m.id) ?? [], l.qty, order.id, orderNo, staff, openedAt);
        }

        const method = Math.random() < 0.5 ? 'CASH' : Math.random() < 0.6 ? 'QR' : 'TRANSFER';
        const received = method === 'CASH' ? Math.ceil(grand / 100) * 100 : null;
        const receiptNo = await docNo(client, 'payments', 'receipt_no', 'RC', closedAt);
        await client.query(
          `INSERT INTO payments (order_id, method, amount, received, change_amount, receipt_no, cashier_id, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [order.id, method, grand, received, received ? money(received - grand) : 0, receiptNo, staff, closedAt]
        );

        bills++;
        revenue += grand;
      }
      process.stdout.write(`\r  สร้างข้อมูล... วันที่ ${DAYS - d + 1}/${DAYS}  (${bills} บิล)`);
    }

    await client.query(`UPDATE dining_tables SET status = 'FREE'`);

    console.log(`\n\n  สร้างข้อมูลสาธิตเรียบร้อย`);
    console.log(`    ช่วงเวลา   : ${DAYS} วันย้อนหลัง`);
    console.log(`    จำนวนบิล   : ${bills.toLocaleString('th-TH')} บิล`);
    console.log(`    ยอดขายรวม : ${money(revenue).toLocaleString('th-TH')} บาท\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

/** ตัดสต็อกตามสูตร BOM พร้อมเขียน ledger ย้อนหลังตามเวลาที่กำหนด */
async function consume(client, bom, qty, orderId, orderNo, userId, at) {
  for (const line of bom) {
    const change = q3(-Number(line.qty_per_unit) * qty);
    const { rows } = await client.query(
      `UPDATE ingredients SET qty_on_hand = GREATEST(qty_on_hand + $2, 0), updated_at = $3
        WHERE id = $1 RETURNING qty_on_hand, cost_per_unit`,
      [line.ingredient_id, change, at]
    );
    await client.query(
      `INSERT INTO stock_movements (ingredient_id, movement_type, qty_change, balance_after, unit_cost,
                                    ref_type, ref_id, ref_no, note, created_by, created_at)
       VALUES ($1,'SALE',$2,$3,$4,'ORDER',$5,$6,'ตัดสต็อกจากการขาย',$7,$8)`,
      [line.ingredient_id, change, rows[0].qty_on_hand, rows[0].cost_per_unit, orderId, orderNo, userId, at]
    );
  }
}

/** เติมวัตถุดิบที่ต่ำกว่า 2 เท่าของจุดสั่งซื้อ ให้กลับไปอยู่ระดับปลอดภัย */
async function restock(client, day, userId) {
  const at = new Date(day);
  at.setHours(8, 0, 0, 0);

  const { rows: low } = await client.query(
    'SELECT id, min_qty, qty_on_hand, cost_per_unit FROM ingredients WHERE qty_on_hand < min_qty * 2.5'
  );
  if (!low.length) return;

  const docNoStr = await docNo(client, 'stock_docs', 'doc_no', 'IN', at);
  const { rows: [doc] } = await client.query(
    `INSERT INTO stock_docs (doc_no, doc_type, doc_date, supplier, note, created_by, created_at)
     VALUES ($1,'IN',$2,'ตลาดสดเทศบาลกาญจนบุรี','รับของประจำวัน',$3,$4) RETURNING id`,
    [docNoStr, at, userId, at]
  );

  let total = 0;
  for (const ing of low) {
    const target = Number(ing.min_qty) * 4 || 20;
    const addQty = q3(Math.max(target - Number(ing.qty_on_hand), 1));
    const cost = Number(ing.cost_per_unit);
    total += addQty * cost;

    await client.query(
      `INSERT INTO stock_doc_lines (doc_id, ingredient_id, qty, unit_cost, line_cost)
       VALUES ($1,$2,$3,$4,$5)`,
      [doc.id, ing.id, addQty, cost, money(addQty * cost)]
    );
    const { rows } = await client.query(
      `UPDATE ingredients SET qty_on_hand = qty_on_hand + $2, updated_at = $3 WHERE id = $1 RETURNING qty_on_hand`,
      [ing.id, addQty, at]
    );
    await client.query(
      `INSERT INTO stock_movements (ingredient_id, movement_type, qty_change, balance_after, unit_cost,
                                    ref_type, ref_id, ref_no, note, created_by, created_at)
       VALUES ($1,'IN',$2,$3,$4,'STOCK_DOC',$5,$6,'รับของประจำวัน',$7,$8)`,
      [ing.id, addQty, rows[0].qty_on_hand, cost, doc.id, docNoStr, userId, at]
    );
  }
  await client.query('UPDATE stock_docs SET total_cost = $2 WHERE id = $1', [doc.id, money(total)]);
}

/** เลขเอกสารรันนิ่งต่อวัน อิงวันที่ของเอกสาร (ไม่ใช่วันนี้) */
async function docNo(client, table, column, prefix, at) {
  const code = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(${column} FROM '[0-9]{4}$')::int), 0) + 1 AS seq
       FROM ${table} WHERE ${column} LIKE $1`,
    [`${prefix}${code}-%`]
  );
  return `${prefix}${code}-${String(rows[0].seq).padStart(4, '0')}`;
}

main().catch((err) => {
  console.error('\n  สร้างข้อมูลสาธิตไม่สำเร็จ:', err.message);
  process.exit(1);
});
