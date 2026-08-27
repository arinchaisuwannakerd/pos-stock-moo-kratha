import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, wrap, nextDocNo, money, promptPayPayload } from '../utils.js';
import { authRequired } from '../middleware/auth.js';
import { getOrderFull, syncTableStatus, getSettings, recalcOrder } from '../services/orderService.js';

const router = Router();

/**
 * POST /api/payments — ชำระเงินและปิดบิล
 * body: { order_id, method: CASH|TRANSFER|QR, amount?, received?, reference_no? }
 * ถ้าไม่ส่ง amount จะถือว่าชำระเต็มยอดคงเหลือ
 */
router.post('/', authRequired, wrap(async (req, res) => {
  const { order_id, method, amount, received, reference_no } = req.body || {};
  if (!order_id) throw new AppError(400, 'ต้องระบุ order_id');
  if (!['CASH', 'TRANSFER', 'QR'].includes(method)) {
    throw new AppError(400, 'method ต้องเป็น CASH, TRANSFER หรือ QR');
  }

  const data = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order_id]);
    const order = rows[0];
    if (!order) throw new AppError(404, `ไม่พบบิล id=${order_id}`);
    if (order.status === 'PAID') throw new AppError(409, 'บิลนี้ชำระเงินเรียบร้อยแล้ว');
    if (order.status === 'VOID') throw new AppError(409, 'บิลนี้ถูกยกเลิกไปแล้ว');

    await recalcOrder(client, order.id);
    const full = await getOrderFull(client, order.id);
    if (!full.items.some((i) => i.status !== 'CANCELLED')) {
      throw new AppError(409, 'บิลนี้ยังไม่มีรายการอาหาร ไม่สามารถชำระเงินได้');
    }

    const payAmount = money(amount ?? full.outstanding);
    if (payAmount <= 0) throw new AppError(400, 'ยอดชำระต้องมากกว่า 0');
    if (payAmount > full.outstanding + 0.001) {
      throw new AppError(400, `ยอดชำระ ${payAmount} บาท เกินยอดคงเหลือ ${full.outstanding} บาท`);
    }

    // เงินสด: คำนวณเงินทอนจากเงินที่รับมา
    let change = 0;
    if (method === 'CASH' && received !== undefined) {
      if (Number(received) < payAmount) {
        throw new AppError(400, `รับเงินมา ${received} บาท น้อยกว่ายอดที่ต้องชำระ ${payAmount} บาท`);
      }
      change = money(Number(received) - payAmount);
    }
    if (method !== 'CASH' && !reference_no) {
      // ไม่บังคับ แต่เตือนไว้ในผลลัพธ์
    }

    const receiptNo = await nextDocNo(client, { table: 'payments', column: 'receipt_no', prefix: 'RC' });
    const { rows: pay } = await client.query(
      `INSERT INTO payments (order_id, method, amount, received, change_amount, reference_no, receipt_no, cashier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [order.id, method, payAmount, received ?? null, change, reference_no ?? null, receiptNo, req.user.id]
    );

    // ชำระครบแล้วจึงปิดบิลและคืนโต๊ะให้ว่าง
    const after = await getOrderFull(client, order.id);
    if (after.outstanding <= 0.001) {
      await client.query(
        `UPDATE orders SET status = 'PAID', closed_at = now(), closed_by = $2 WHERE id = $1`,
        [order.id, req.user.id]
      );
    }
    await syncTableStatus(client, order.table_id);

    return { payment: pay[0], order: await getOrderFull(client, order.id) };
  });

  res.status(201).json({
    ok: true,
    message: data.order.status === 'PAID'
      ? `ชำระเงินครบถ้วน ปิดบิล ${data.order.order_no} เรียบร้อย`
      : `รับชำระบางส่วน คงเหลืออีก ${data.order.outstanding} บาท`,
    ...data,
  });
}));

/** GET /api/payments — ประวัติการรับชำระเงิน */
router.get('/', authRequired, wrap(async (req, res) => {
  const { from, to, method, limit = 100 } = req.query;
  const { rows } = await query(
    `SELECT p.*, o.order_no, o.grand_total, t.table_no, u.full_name AS cashier_name
       FROM payments p
       JOIN orders o        ON o.id = p.order_id
       JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN users u    ON u.id = p.cashier_id
      WHERE ($1::date IS NULL OR (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date >= $1)
        AND ($2::date IS NULL OR (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date <= $2)
        AND ($3::text IS NULL OR p.method::text = $3)
      ORDER BY p.id DESC LIMIT $4`,
    [from || null, to || null, method || null, Math.min(Number(limit) || 100, 500)]
  );
  res.json({ ok: true, count: rows.length, data: rows });
}));

/**
 * GET /api/payments/qr/:orderId — ข้อมูลสำหรับสร้าง QR พร้อมเพย์ของบิลนี้
 * คืนสตริง EMVCo ให้หน้าเว็บนำไป render เป็นภาพ QR
 */
router.get('/qr/:orderId', authRequired, wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const settings = await getSettings(client);
    const order = await getOrderFull(client, req.params.orderId);
    const amount = order.outstanding || order.grand_total;
    return {
      order_no: order.order_no,
      table_no: order.table_no,
      amount,
      promptpay_id: settings.promptpay_id,
      shop_name: settings.shop_name,
      qr_payload: promptPayPayload(settings.promptpay_id, amount),
    };
  });
  res.json({ ok: true, data });
}));

/**
 * GET /api/payments/receipt/:orderId — ข้อมูลใบเสร็จรับเงินสำหรับพิมพ์
 */
router.get('/receipt/:orderId', authRequired, wrap(async (req, res) => {
  const data = await withTransaction(async (client) => {
    const settings = await getSettings(client);
    const order = await getOrderFull(client, req.params.orderId);
    return {
      shop: {
        name: settings.shop_name,
        branch: settings.shop_branch,
        address: settings.shop_address,
        phone: settings.shop_phone,
        tax_id: settings.shop_taxid,
      },
      receipt_no: order.payments[0]?.receipt_no ?? null,
      order_no: order.order_no,
      table_no: order.table_no,
      guest_count: order.guest_count,
      opened_at: order.opened_at,
      closed_at: order.closed_at,
      cashier: order.payments[0]?.cashier_name ?? order.closed_by_name,
      items: order.items
        .filter((i) => i.status !== 'CANCELLED')
        .map((i) => ({ name_th: i.name_th, qty: Number(i.qty), unit_price: Number(i.unit_price), line_total: Number(i.line_total) })),
      subtotal: order.subtotal,
      discount: order.discount,
      service_charge: order.service_charge,
      vat_amount: order.vat_amount,
      vat_rate: Number(settings.vat_rate),
      vat_included: settings.vat_included === 'true',
      grand_total: order.grand_total,
      payments: order.payments.map((p) => ({
        method: p.method, amount: Number(p.amount),
        received: p.received === null ? null : Number(p.received),
        change_amount: Number(p.change_amount), reference_no: p.reference_no,
      })),
      status: order.status,
    };
  });
  res.json({ ok: true, data });
}));

export default router;
