/**
 * ฝั่งลูกค้า — ลูกค้าสแกน QR ที่โต๊ะแล้วสั่งอาหารเองได้ ไม่ต้องล็อกอิน
 * ทุกปลายทางผูกกับหมายเลขโต๊ะเสมอ จึงเข้าถึงได้เฉพาะบิลของโต๊ะนั้น
 */
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, wrap, nextDocNo, promptPayPayload } from '../utils.js';
import { recalcOrder, getOrderFull, syncTableStatus, getSettings } from '../services/orderService.js';
import { addItem, nextRound, dedupeAlerts } from './orders.js';

const router = Router();

/** GET /api/public/menu — เมนูอาหารสำหรับลูกค้า (เฉพาะที่เปิดขายและวัตถุดิบพอ) */
router.get('/menu', wrap(async (req, res) => {
  const { rows: categories } = await query('SELECT id, code, name_th FROM categories ORDER BY sort_order');
  const { rows: items } = await query(
    `SELECT m.id, m.sku, m.name_th, m.description, m.price, m.unit, m.image_url,
            c.code AS category_code, c.name_th AS category_name,
            COALESCE((SELECT FLOOR(MIN(i.qty_on_hand / r.qty_per_unit))::int
                        FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
                       WHERE r.menu_item_id = m.id), 999) AS max_servable
       FROM menu_items m JOIN categories c ON c.id = m.category_id
      WHERE m.is_available
        AND ($1::text IS NULL OR c.code = $1)
        AND ($2::text IS NULL OR m.name_th ILIKE '%' || $2 || '%')
      ORDER BY c.sort_order, m.sku`,
    [req.query.category || null, req.query.q || null]
  );

  for (const it of items) it.sold_out = it.max_servable <= 0;
  res.json({ ok: true, categories, count: items.length, data: items });
}));

/** GET /api/public/tables/:tableNo — สถานะโต๊ะและบิลปัจจุบัน (สรุปย่อ) */
router.get('/tables/:tableNo', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM v_table_status WHERE table_no = $1', [req.params.tableNo]);
  if (!rows[0]) throw new AppError(404, `ไม่พบโต๊ะ ${req.params.tableNo}`);
  res.json({ ok: true, data: rows[0] });
}));

/**
 * POST /api/public/tables/:tableNo/order — ลูกค้าสั่งอาหารเอง
 * body: { items: [{ menu_sku | menu_item_id, qty, note }], guest_count? }
 * ถ้าโต๊ะยังไม่มีบิล ระบบจะเปิดบิลใหม่ให้อัตโนมัติ (channel = CUSTOMER)
 */
router.post('/tables/:tableNo/order', wrap(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) {
    throw new AppError(400, 'กรุณาเลือกรายการอาหารอย่างน้อย 1 รายการ');
  }

  const data = await withTransaction(async (client) => {
    const { rows: tbl } = await client.query(
      'SELECT * FROM dining_tables WHERE table_no = $1 FOR UPDATE',
      [req.params.tableNo]
    );
    if (!tbl[0]) throw new AppError(404, `ไม่พบโต๊ะ ${req.params.tableNo}`);

    const { rows: existing } = await client.query(
      `SELECT * FROM orders WHERE table_id = $1 AND status IN ('OPEN','BILLING') FOR UPDATE`,
      [tbl[0].id]
    );

    let order = existing[0];
    let isNew = false;
    if (!order) {
      const orderNo = await nextDocNo(client, { table: 'orders', column: 'order_no', prefix: 'OD' });
      const { rows } = await client.query(
        `INSERT INTO orders (order_no, table_id, guest_count, channel)
         VALUES ($1,$2,$3,'CUSTOMER') RETURNING *`,
        [orderNo, tbl[0].id, req.body?.guest_count ?? tbl[0].seats]
      );
      order = rows[0];
      isNew = true;
    } else if (order.status === 'BILLING') {
      throw new AppError(409, 'โต๊ะนี้เรียกเช็คบิลแล้ว หากต้องการสั่งเพิ่มกรุณาแจ้งพนักงาน');
    }

    const roundNo = isNew ? 1 : await nextRound(client, order.id);
    const alerts = [];
    for (const it of items) alerts.push(...await addItem(client, order, it, null, roundNo));

    await recalcOrder(client, order.id);
    await syncTableStatus(client, tbl[0].id);
    return {
      is_new_order: isNew,
      round_no: roundNo,
      order: await getOrderFull(client, order.id),
      stock_alerts: dedupeAlerts(alerts),
    };
  });

  res.status(201).json({
    ok: true,
    message: data.is_new_order
      ? `รับออเดอร์เรียบร้อย เปิดบิล ${data.order.order_no}`
      : `สั่งเพิ่มรอบที่ ${data.round_no} เรียบร้อย`,
    ...data,
  });
}));

/** GET /api/public/tables/:tableNo/bill — สรุปรายการและยอดเงินของโต๊ะ */
router.get('/tables/:tableNo/bill', wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT o.id FROM orders o JOIN dining_tables t ON t.id = o.table_id
        WHERE t.table_no = $1 AND o.status IN ('OPEN','BILLING')`,
      [req.params.tableNo]
    );
    if (!rows[0]) return null;

    const settings = await getSettings(client);
    const order = await getOrderFull(client, rows[0].id);
    return {
      order_no: order.order_no,
      table_no: order.table_no,
      status: order.status,
      guest_count: order.guest_count,
      opened_at: order.opened_at,
      items: order.items
        .filter((i) => i.status !== 'CANCELLED')
        .map((i) => ({
          id: i.id, name_th: i.name_th, category_name: i.category_name,
          qty: Number(i.qty), unit_price: Number(i.unit_price),
          line_total: Number(i.line_total), round_no: i.round_no, note: i.note,
        })),
      subtotal: order.subtotal,
      discount: order.discount,
      service_charge: order.service_charge,
      vat_amount: order.vat_amount,
      grand_total: order.grand_total,
      shop_name: settings.shop_name,
    };
  });

  if (!data) return res.json({ ok: true, data: null, message: 'โต๊ะนี้ยังไม่มีรายการสั่งอาหาร' });
  res.json({ ok: true, data });
}));

/** POST /api/public/tables/:tableNo/bill — ลูกค้ากดเรียกเช็คบิลเอง */
router.post('/tables/:tableNo/bill', wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT o.* FROM orders o JOIN dining_tables t ON t.id = o.table_id
        WHERE t.table_no = $1 AND o.status = 'OPEN' FOR UPDATE`,
      [req.params.tableNo]
    );
    if (!rows[0]) throw new AppError(404, 'ไม่พบบิลที่เปิดอยู่ของโต๊ะนี้');

    await client.query(`UPDATE orders SET status = 'BILLING' WHERE id = $1`, [rows[0].id]);
    await recalcOrder(client, rows[0].id);
    await syncTableStatus(client, rows[0].table_id);
    return getOrderFull(client, rows[0].id);
  });
  res.json({ ok: true, message: 'เรียกพนักงานเช็คบิลเรียบร้อย กรุณารอสักครู่', data });
}));

/** GET /api/public/tables/:tableNo/qr — QR พร้อมเพย์สำหรับให้ลูกค้าสแกนจ่าย */
router.get('/tables/:tableNo/qr', wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const settings = await getSettings(client);
    const { rows } = await client.query(
      `SELECT o.id FROM orders o JOIN dining_tables t ON t.id = o.table_id
        WHERE t.table_no = $1 AND o.status IN ('OPEN','BILLING')`,
      [req.params.tableNo]
    );
    if (!rows[0]) throw new AppError(404, 'ไม่พบบิลที่เปิดอยู่ของโต๊ะนี้');

    const order = await getOrderFull(client, rows[0].id);
    const amount = order.outstanding || order.grand_total;
    return {
      order_no: order.order_no,
      table_no: order.table_no,
      amount,
      shop_name: settings.shop_name,
      promptpay_id: settings.promptpay_id,
      qr_payload: promptPayPayload(settings.promptpay_id, amount),
    };
  });
  res.json({ ok: true, data });
}));

export default router;
