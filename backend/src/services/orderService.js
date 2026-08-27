import { AppError, money } from '../utils.js';

/** อ่านค่าตั้งค่าระบบทั้งหมดเป็น object */
export async function getSettings(client) {
  const { rows } = await client.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * คำนวณยอดบิลใหม่จากรายการอาหารในออเดอร์ แล้วเขียนกลับลงตาราง orders
 * เรียกทุกครั้งที่มีการเพิ่ม / แก้ไข / ยกเลิกรายการ
 */
export async function recalcOrder(client, orderId) {
  const settings = await getSettings(client);
  const vatRate = Number(settings.vat_rate || 0) / 100;
  const vatIncluded = String(settings.vat_included) === 'true';
  const serviceRate = Number(settings.service_rate || 0) / 100;

  const { rows: sumRows } = await client.query(
    `SELECT COALESCE(SUM(line_total), 0) AS subtotal
       FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED'`,
    [orderId]
  );
  const subtotal = money(sumRows[0].subtotal);

  const { rows: orderRows } = await client.query('SELECT discount FROM orders WHERE id = $1', [orderId]);
  if (!orderRows[0]) throw new AppError(404, `ไม่พบออเดอร์ id=${orderId}`);
  const discount = money(orderRows[0].discount);

  const net = money(Math.max(subtotal - discount, 0));
  const serviceCharge = money(net * serviceRate);
  const base = money(net + serviceCharge);

  // vat_included = true  -> ราคาขายรวม VAT แล้ว, ถอด VAT ออกมาแสดง
  // vat_included = false -> บวก VAT เพิ่มจากยอดสุทธิ
  const vatAmount = vatRate === 0 ? 0
    : vatIncluded ? money(base - base / (1 + vatRate))
    : money(base * vatRate);
  const grandTotal = vatIncluded ? base : money(base + vatAmount);

  const { rows } = await client.query(
    `UPDATE orders
        SET subtotal = $2, service_charge = $3, vat_amount = $4, grand_total = $5
      WHERE id = $1
      RETURNING *`,
    [orderId, subtotal, serviceCharge, vatAmount, grandTotal]
  );
  return rows[0];
}

/** ดึงออเดอร์ 1 ใบพร้อมรายการอาหาร โต๊ะ และการชำระเงิน */
export async function getOrderFull(client, orderId) {
  const { rows } = await client.query(
    `SELECT o.*, t.table_no, t.zone, t.seats,
            u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
       FROM orders o
       JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN users u1 ON u1.id = o.opened_by
       LEFT JOIN users u2 ON u2.id = o.closed_by
      WHERE o.id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new AppError(404, `ไม่พบออเดอร์ id=${orderId}`);

  const { rows: items } = await client.query(
    `SELECT oi.*, m.sku, m.name_th, m.unit, c.code AS category_code, c.name_th AS category_name
       FROM order_items oi
       JOIN menu_items m  ON m.id = oi.menu_item_id
       JOIN categories c  ON c.id = m.category_id
      WHERE oi.order_id = $1
      ORDER BY oi.round_no, oi.id`,
    [orderId]
  );

  const { rows: payments } = await client.query(
    `SELECT p.*, u.full_name AS cashier_name
       FROM payments p LEFT JOIN users u ON u.id = p.cashier_id
      WHERE p.order_id = $1 ORDER BY p.id`,
    [orderId]
  );

  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  return {
    ...order,
    items,
    payments,
    paid_amount: money(paid),
    outstanding: money(Math.max(Number(order.grand_total) - paid, 0)),
  };
}

/** เปลี่ยนสถานะโต๊ะให้สอดคล้องกับสถานะบิล */
export async function syncTableStatus(client, tableId) {
  const { rows } = await client.query(
    `SELECT status FROM orders WHERE table_id = $1 AND status IN ('OPEN','BILLING') LIMIT 1`,
    [tableId]
  );
  const status = !rows[0] ? 'FREE' : rows[0].status === 'BILLING' ? 'BILLING' : 'OCCUPIED';
  await client.query('UPDATE dining_tables SET status = $2 WHERE id = $1', [tableId, status]);
  return status;
}
