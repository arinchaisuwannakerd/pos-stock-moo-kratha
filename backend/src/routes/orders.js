import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, wrap, nextDocNo, money } from '../utils.js';
import { authRequired } from '../middleware/auth.js';
import { applyRecipe, checkAvailability } from '../services/stockService.js';
import { recalcOrder, getOrderFull, syncTableStatus } from '../services/orderService.js';

const router = Router();

/**
 * GET /api/orders — รายการบิล
 * query: ?status=OPEN|BILLING|PAID|VOID ?table_no=T01 ?from=YYYY-MM-DD ?to=YYYY-MM-DD ?limit=50
 */
router.get('/', authRequired, wrap(async (req, res) => {
  const { status, table_no, from, to, limit = 50 } = req.query;
  const { rows } = await query(
    `SELECT o.*, t.table_no, t.zone, u.full_name AS opened_by_name,
            (SELECT COUNT(*)::int FROM order_items oi
              WHERE oi.order_id = o.id AND oi.status <> 'CANCELLED') AS item_lines
       FROM orders o
       JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN users u ON u.id = o.opened_by
      WHERE ($1::text IS NULL OR o.status::text = $1)
        AND ($2::text IS NULL OR t.table_no = $2)
        AND ($3::date IS NULL OR (o.opened_at AT TIME ZONE 'Asia/Bangkok')::date >= $3)
        AND ($4::date IS NULL OR (o.opened_at AT TIME ZONE 'Asia/Bangkok')::date <= $4)
      ORDER BY o.id DESC
      LIMIT $5`,
    [status || null, table_no || null, from || null, to || null, Math.min(Number(limit) || 50, 500)]
  );
  res.json({ ok: true, count: rows.length, data: rows });
}));

/** GET /api/orders/:id — บิล 1 ใบ พร้อมรายการอาหารและการชำระเงิน */
router.get('/:id', authRequired, wrap(async (req, res) => {
  const data = await withTransaction((c) => getOrderFull(c, req.params.id));
  res.json({ ok: true, data });
}));

/**
 * POST /api/orders — เปิดบิลใหม่ให้โต๊ะ
 * body: { table_no | table_id, guest_count, note, items?: [{menu_sku|menu_item_id, qty, note}] }
 */
router.post('/', authRequired, wrap(async (req, res) => {
  const { table_no, table_id, guest_count = 1, note, items = [] } = req.body || {};
  if (!table_no && !table_id) throw new AppError(400, 'ต้องระบุ table_no หรือ table_id');

  const data = await withTransaction(async (client) => {
    const { rows: tbl } = await client.query(
      'SELECT * FROM dining_tables WHERE ($1::int IS NOT NULL AND id = $1) OR table_no = $2',
      [table_id ?? null, table_no ?? null]
    );
    if (!tbl[0]) throw new AppError(404, `ไม่พบโต๊ะ ${table_no || table_id}`);

    const orderNo = await nextDocNo(client, { table: 'orders', column: 'order_no', prefix: 'OD' });
    const { rows } = await client.query(
      `INSERT INTO orders (order_no, table_id, guest_count, note, opened_by, channel)
       VALUES ($1,$2,$3,$4,$5,'STAFF') RETURNING *`,
      [orderNo, tbl[0].id, guest_count, note ?? null, req.user.id]
    );

    const alerts = [];
    for (const it of items) {
      alerts.push(...await addItem(client, rows[0], it, req.user.id));
    }
    await recalcOrder(client, rows[0].id);
    await syncTableStatus(client, tbl[0].id);
    return { order: await getOrderFull(client, rows[0].id), stock_alerts: dedupeAlerts(alerts) };
  });

  res.status(201).json({ ok: true, message: `เปิดบิล ${data.order.order_no} เรียบร้อย`, ...data });
}));

/**
 * POST /api/orders/:id/items — สั่งอาหารเพิ่มระหว่างทาน
 * body: { items: [{ menu_sku | menu_item_id, qty, note }] }  หรือ { menu_sku, qty }
 * ระบบจะตัดสต็อกวัตถุดิบตามสูตร BOM ทันทีที่บันทึกรายการ
 */
router.post('/:id/items', authRequired, wrap(async (req, res) => {
  const items = req.body?.items ?? [req.body];
  if (!Array.isArray(items) || !items.length) throw new AppError(400, 'ต้องระบุรายการอาหารอย่างน้อย 1 รายการ');

  const data = await withTransaction(async (client) => {
    const order = await lockOpenOrder(client, req.params.id);
    const roundNo = await nextRound(client, order.id);
    const alerts = [];
    for (const it of items) alerts.push(...await addItem(client, order, it, req.user.id, roundNo));
    await recalcOrder(client, order.id);
    await syncTableStatus(client, order.table_id);
    return { order: await getOrderFull(client, order.id), stock_alerts: dedupeAlerts(alerts) };
  });

  res.status(201).json({ ok: true, message: 'บันทึกรายการอาหารและตัดสต็อกเรียบร้อย', ...data });
}));

/** PATCH /api/orders/:id/items/:itemId — แก้จำนวน (ปรับสต็อกตามส่วนต่าง) */
router.patch('/:id/items/:itemId', authRequired, wrap(async (req, res) => {
  const { qty, note } = req.body || {};
  if (qty === undefined && note === undefined) throw new AppError(400, 'ต้องระบุ qty หรือ note');

  const data = await withTransaction(async (client) => {
    const order = await lockOpenOrder(client, req.params.id);
    const { rows } = await client.query(
      `SELECT * FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [req.params.itemId, order.id]
    );
    const item = rows[0];
    if (!item) throw new AppError(404, 'ไม่พบรายการอาหารในบิลนี้');
    if (item.status === 'CANCELLED') throw new AppError(409, 'รายการนี้ถูกยกเลิกไปแล้ว');

    let alerts = [];
    if (qty !== undefined) {
      if (Number(qty) <= 0) throw new AppError(400, 'จำนวนต้องมากกว่า 0 (ถ้าต้องการยกเลิกให้ใช้ DELETE)');
      const diff = Number(qty) - Number(item.qty);
      if (diff !== 0) {
        if (diff > 0) {
          const short = await checkAvailability(client, item.menu_item_id, diff);
          if (short.length) throw new AppError(409, `วัตถุดิบไม่พอสำหรับเพิ่มจำนวน: ${short.map((s) => s.name_th).join(', ')}`, short);
        }
        alerts = await applyRecipe(client, {
          menuItemId: item.menu_item_id,
          qty: Math.abs(diff),
          sign: diff > 0 ? -1 : 1,
          refType: 'ORDER',
          refId: order.id,
          refNo: order.order_no,
          userId: req.user.id,
          note: `แก้ไขจำนวน ${item.qty} -> ${qty}`,
        });
      }
      await client.query(
        'UPDATE order_items SET qty = $2, line_total = $2 * unit_price WHERE id = $1',
        [item.id, qty]
      );
    }
    if (note !== undefined) {
      await client.query('UPDATE order_items SET note = $2 WHERE id = $1', [item.id, note]);
    }

    await recalcOrder(client, order.id);
    return { order: await getOrderFull(client, order.id), stock_alerts: dedupeAlerts(alerts) };
  });

  res.json({ ok: true, message: 'แก้ไขรายการเรียบร้อย', ...data });
}));

/** DELETE /api/orders/:id/items/:itemId — ยกเลิกรายการอาหาร (คืนสต็อกอัตโนมัติ) */
router.delete('/:id/items/:itemId', authRequired, wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const order = await lockOpenOrder(client, req.params.id);
    const { rows } = await client.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [req.params.itemId, order.id]
    );
    const item = rows[0];
    if (!item) throw new AppError(404, 'ไม่พบรายการอาหารในบิลนี้');
    if (item.status === 'CANCELLED') throw new AppError(409, 'รายการนี้ถูกยกเลิกไปแล้ว');

    await applyRecipe(client, {
      menuItemId: item.menu_item_id,
      qty: item.qty,
      sign: 1,
      refType: 'ORDER',
      refId: order.id,
      refNo: order.order_no,
      userId: req.user.id,
      note: `ยกเลิกรายการในบิล ${order.order_no}`,
    });
    await client.query(`UPDATE order_items SET status = 'CANCELLED' WHERE id = $1`, [item.id]);
    await recalcOrder(client, order.id);
    return getOrderFull(client, order.id);
  });

  res.json({ ok: true, message: 'ยกเลิกรายการและคืนสต็อกเรียบร้อย', data });
}));

/** POST /api/orders/:id/bill — ขอเช็คบิล (โต๊ะเปลี่ยนเป็นสถานะ "รอชำระเงิน") */
router.post('/:id/bill', authRequired, wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const order = await lockOpenOrder(client, req.params.id);
    if (order.status === 'BILLING') throw new AppError(409, 'บิลนี้อยู่ในสถานะรอชำระเงินอยู่แล้ว');
    await client.query(`UPDATE orders SET status = 'BILLING' WHERE id = $1`, [order.id]);
    await recalcOrder(client, order.id);
    await syncTableStatus(client, order.table_id);
    return getOrderFull(client, order.id);
  });
  res.json({ ok: true, message: 'เรียกเช็คบิลเรียบร้อย', data });
}));

/** PATCH /api/orders/:id — แก้ส่วนลด / จำนวนลูกค้า / หมายเหตุ */
router.patch('/:id', authRequired, wrap(async (req, res) => {
  const { discount, guest_count, note } = req.body || {};
  const data = await withTransaction(async (client) => {
    const order = await lockOpenOrder(client, req.params.id);
    if (discount !== undefined && Number(discount) < 0) throw new AppError(400, 'ส่วนลดต้องไม่ติดลบ');
    await client.query(
      `UPDATE orders SET
         discount    = COALESCE($2, discount),
         guest_count = COALESCE($3, guest_count),
         note        = COALESCE($4, note)
       WHERE id = $1`,
      [order.id, discount ?? null, guest_count ?? null, note ?? null]
    );
    await recalcOrder(client, order.id);
    return getOrderFull(client, order.id);
  });
  res.json({ ok: true, data });
}));

/** POST /api/orders/:id/void — ยกเลิกทั้งบิล (คืนสต็อกทุกรายการ) */
router.post('/:id/void', authRequired, wrap(async (req, res) => {
  const reason = req.body?.reason;
  const data = await withTransaction(async (client) => {
    const order = await lockOpenOrder(client, req.params.id);
    const { rows: items } = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED'`,
      [order.id]
    );
    for (const item of items) {
      await applyRecipe(client, {
        menuItemId: item.menu_item_id,
        qty: item.qty,
        sign: 1,
        refType: 'ORDER',
        refId: order.id,
        refNo: order.order_no,
        userId: req.user.id,
        note: `ยกเลิกบิล ${order.order_no}`,
      });
    }
    await client.query(`UPDATE order_items SET status = 'CANCELLED' WHERE order_id = $1`, [order.id]);
    await client.query(
      `UPDATE orders SET status = 'VOID', closed_at = now(), closed_by = $2,
              note = COALESCE(note || ' | ', '') || $3
        WHERE id = $1`,
      [order.id, req.user.id, `ยกเลิกบิล: ${reason || 'ไม่ระบุเหตุผล'}`]
    );
    await recalcOrder(client, order.id);
    await syncTableStatus(client, order.table_id);
    return getOrderFull(client, order.id);
  });
  res.json({ ok: true, message: 'ยกเลิกบิลและคืนสต็อกเรียบร้อย', data });
}));

// ------------------------------------------------------------------ helpers

/** ล็อกบิลที่ยังเปิดอยู่ ป้องกันแก้ไขพร้อมกันจากหลายเครื่อง */
export async function lockOpenOrder(client, orderId) {
  const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  const order = rows[0];
  if (!order) throw new AppError(404, `ไม่พบบิล id=${orderId}`);
  if (order.status === 'PAID') throw new AppError(409, 'บิลนี้ชำระเงินแล้ว ไม่สามารถแก้ไขได้');
  if (order.status === 'VOID') throw new AppError(409, 'บิลนี้ถูกยกเลิกไปแล้ว');
  return order;
}

/** หมายเลขรอบถัดไปของบิล ใช้แยก "สั่งเพิ่มระหว่างทาน" ออกจากรอบแรก */
export async function nextRound(client, orderId) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(round_no), 0) + 1 AS next FROM order_items WHERE order_id = $1',
    [orderId]
  );
  return Number(rows[0].next);
}

/** เพิ่มรายการอาหาร 1 บรรทัด + ตัดสต็อกตาม BOM */
export async function addItem(client, order, input, userId, roundNo = 1) {
  const qty = Number(input.qty ?? 1);
  if (!(qty > 0)) throw new AppError(400, 'จำนวนต้องมากกว่า 0');

  const { rows: menu } = await client.query(
    `SELECT m.*, c.name_th AS category_name FROM menu_items m
       JOIN categories c ON c.id = m.category_id
      WHERE ($1::int IS NOT NULL AND m.id = $1) OR m.sku = $2`,
    [input.menu_item_id ?? null, input.menu_sku ?? null]
  );
  const item = menu[0];
  if (!item) throw new AppError(404, `ไม่พบเมนู ${input.menu_sku || input.menu_item_id}`);
  if (!item.is_available) throw new AppError(409, `เมนู "${item.name_th}" ปิดการขายอยู่`);

  const short = await checkAvailability(client, item.id, qty);
  if (short.length) {
    throw new AppError(409,
      `วัตถุดิบไม่พอสำหรับ "${item.name_th}" จำนวน ${qty} ${item.unit}: ${short.map((s) => `${s.name_th} (เหลือ ${s.qty_on_hand} ${s.unit} ต้องใช้ ${s.required})`).join(', ')}`,
      short);
  }

  await client.query(
    `INSERT INTO order_items (order_id, menu_item_id, qty, unit_price, line_total, note, round_no)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [order.id, item.id, qty, item.price, money(qty * Number(item.price)), input.note ?? null, roundNo]
  );

  return applyRecipe(client, {
    menuItemId: item.id,
    qty,
    sign: -1,
    refType: 'ORDER',
    refId: order.id,
    refNo: order.order_no,
    userId,
    note: `ขาย ${item.name_th} x${qty}`,
  });
}

/** รวมการแจ้งเตือนวัตถุดิบซ้ำ ๆ ให้เหลือรายการละ 1 บรรทัด */
export function dedupeAlerts(alerts) {
  const map = new Map();
  for (const a of alerts) map.set(a.ingredient_id, a);
  return [...map.values()];
}

export default router;
