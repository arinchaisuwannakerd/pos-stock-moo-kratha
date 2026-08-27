import { Router } from 'express';
import { query } from '../db.js';
import { AppError, wrap, toCsv, dateRange } from '../utils.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

/** ส่งผลลัพธ์เป็น JSON หรือดาวน์โหลด CSV (เปิดใน MS-Excel ได้) เมื่อ ?format=csv */
function send(req, res, { rows, filename, headers, extra = {} }) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows, headers));
  }
  res.json({ ok: true, count: rows.length, ...extra, data: rows });
}

/**
 * GET /api/reports/dashboard — สรุปภาพรวมสำหรับหน้ารายงาน
 * query: ?date=YYYY-MM-DD (ดีฟอลต์ = วันนี้)
 */
router.get('/dashboard', authRequired, wrap(async (req, res) => {
  const { from } = dateRange(req.query.date ? { from: req.query.date } : {});

  const [today, month, tables, low, topMenu] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(grand_total),0) AS sales,
              COUNT(*)::int               AS bills,
              COALESCE(SUM(guest_count),0)::int AS guests,
              COALESCE(ROUND(AVG(grand_total),2),0) AS avg_bill
         FROM orders
        WHERE status = 'PAID' AND (closed_at AT TIME ZONE 'Asia/Bangkok')::date = $1`,
      [from]
    ),
    query(
      `SELECT COALESCE(SUM(grand_total),0) AS sales, COUNT(*)::int AS bills
         FROM orders
        WHERE status = 'PAID'
          AND date_trunc('month', (closed_at AT TIME ZONE 'Asia/Bangkok')::date)
            = date_trunc('month', $1::date)`,
      [from]
    ),
    query(
      `SELECT status::text, COUNT(*)::int AS n FROM dining_tables GROUP BY status`
    ),
    query(`SELECT COUNT(*)::int AS n FROM v_stock_on_hand WHERE stock_status IN ('LOW','OUT_OF_STOCK')`),
    query(
      `SELECT m.name_th, SUM(oi.qty) AS qty, SUM(oi.line_total) AS amount
         FROM order_items oi
         JOIN orders o     ON o.id = oi.order_id
         JOIN menu_items m ON m.id = oi.menu_item_id
        WHERE o.status = 'PAID' AND oi.status <> 'CANCELLED'
          AND (o.closed_at AT TIME ZONE 'Asia/Bangkok')::date = $1
        GROUP BY m.id, m.name_th ORDER BY qty DESC LIMIT 5`,
      [from]
    ),
  ]);

  const tableStat = Object.fromEntries(tables.rows.map((r) => [r.status, r.n]));
  res.json({
    ok: true,
    date: from,
    data: {
      today: today.rows[0],
      month: month.rows[0],
      tables: {
        total: Object.values(tableStat).reduce((a, b) => a + b, 0),
        free: tableStat.FREE || 0,
        occupied: tableStat.OCCUPIED || 0,
        billing: tableStat.BILLING || 0,
      },
      low_stock_count: low.rows[0].n,
      top_menu_today: topMenu.rows,
    },
  });
}));

/**
 * GET /api/reports/sales — รายงานยอดขาย รายวัน / รายสัปดาห์ / รายเดือน
 * query: ?group=day|week|month  ?from=YYYY-MM-DD ?to=YYYY-MM-DD  ?format=csv
 */
router.get('/sales', authRequired, wrap(async (req, res) => {
  const group = req.query.group || 'day';
  if (!['day', 'week', 'month'].includes(group)) {
    throw new AppError(400, 'group ต้องเป็น day, week หรือ month');
  }
  const { from, to } = dateRange(req.query);

  const { rows } = await query(
    `SELECT to_char(date_trunc($3, d.sale_day), 'YYYY-MM-DD') AS period_start,
            CASE $3 WHEN 'day'   THEN to_char(d.sale_day, 'DD/MM/YYYY')
                    WHEN 'week'  THEN 'สัปดาห์ ' || to_char(date_trunc('week', d.sale_day), 'DD/MM/YYYY')
                    ELSE to_char(d.sale_day, 'MM/YYYY') END          AS period_label,
            COUNT(*)::int                       AS bill_count,
            SUM(d.guest_count)::int             AS guest_count,
            SUM(d.subtotal)                     AS subtotal,
            SUM(d.discount)                     AS discount,
            SUM(d.vat_amount)                   AS vat_amount,
            SUM(d.grand_total)                  AS grand_total,
            ROUND(AVG(d.grand_total), 2)        AS avg_bill
       FROM (SELECT (closed_at AT TIME ZONE 'Asia/Bangkok')::date AS sale_day,
                    guest_count, subtotal, discount, vat_amount, grand_total
               FROM orders
              WHERE status = 'PAID'
                AND (closed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2) d
      GROUP BY date_trunc($3, d.sale_day), 2
      ORDER BY 1`,
    [from, to, group]
  );

  const totals = rows.reduce(
    (a, r) => ({
      bill_count: a.bill_count + r.bill_count,
      guest_count: a.guest_count + r.guest_count,
      grand_total: Math.round((a.grand_total + Number(r.grand_total)) * 100) / 100,
    }),
    { bill_count: 0, guest_count: 0, grand_total: 0 }
  );

  send(req, res, {
    rows,
    filename: `sales-${group}-${from}-to-${to}`,
    headers: [
      { key: 'period_label', label: 'ช่วงเวลา' },
      { key: 'bill_count', label: 'จำนวนบิล' },
      { key: 'guest_count', label: 'จำนวนลูกค้า' },
      { key: 'subtotal', label: 'ยอดก่อนส่วนลด' },
      { key: 'discount', label: 'ส่วนลด' },
      { key: 'vat_amount', label: 'ภาษีมูลค่าเพิ่ม' },
      { key: 'grand_total', label: 'ยอดขายสุทธิ' },
      { key: 'avg_bill', label: 'เฉลี่ยต่อบิล' },
    ],
    extra: { group, from, to, totals },
  });
}));

/**
 * GET /api/reports/top-menu — รายงานอันดับเมนูขายดี
 * query: ?from= ?to= ?limit=20 ?category=BBQ ?format=csv
 */
router.get('/top-menu', authRequired, wrap(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { rows } = await query(
    `SELECT ROW_NUMBER() OVER (ORDER BY SUM(oi.qty) DESC)::int AS rank,
            m.sku, m.name_th, c.name_th AS category_name,
            SUM(oi.qty)                      AS total_qty,
            SUM(oi.line_total)               AS total_amount,
            COUNT(DISTINCT oi.order_id)::int AS bill_count,
            m.price
       FROM order_items oi
       JOIN orders o     ON o.id = oi.order_id
       JOIN menu_items m ON m.id = oi.menu_item_id
       JOIN categories c ON c.id = m.category_id
      WHERE o.status = 'PAID' AND oi.status <> 'CANCELLED'
        AND (o.closed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR c.code = $3)
      GROUP BY m.id, m.sku, m.name_th, c.name_th, m.price
      ORDER BY total_qty DESC
      LIMIT $4`,
    [from, to, req.query.category || null, Math.min(Number(req.query.limit) || 20, 200)]
  );

  send(req, res, {
    rows,
    filename: `top-menu-${from}-to-${to}`,
    headers: [
      { key: 'rank', label: 'อันดับ' },
      { key: 'sku', label: 'รหัสเมนู' },
      { key: 'name_th', label: 'ชื่อเมนู' },
      { key: 'category_name', label: 'หมวดหมู่' },
      { key: 'total_qty', label: 'จำนวนที่ขายได้' },
      { key: 'total_amount', label: 'ยอดขาย (บาท)' },
      { key: 'bill_count', label: 'จำนวนบิล' },
    ],
    extra: { from, to },
  });
}));

/**
 * GET /api/reports/stock — รายงานวัตถุดิบคงเหลือ
 * query: ?grp=MEAT ?only_low=true ?format=csv
 */
router.get('/stock', authRequired, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT sku, name_th,
            CASE grp WHEN 'MEAT' THEN 'เนื้อสัตว์' WHEN 'VEGETABLE' THEN 'ผัก'
                     WHEN 'DRINK' THEN 'เครื่องดื่ม' WHEN 'ICE' THEN 'น้ำแข็ง'
                     ELSE 'อื่น ๆ' END AS group_name,
            grp, unit, qty_on_hand, min_qty, cost_per_unit, stock_value,
            CASE stock_status WHEN 'OUT_OF_STOCK' THEN 'หมด' WHEN 'LOW' THEN 'ใกล้หมด'
                              WHEN 'WARNING' THEN 'เฝ้าระวัง' ELSE 'ปกติ' END AS status_label,
            stock_status
       FROM v_stock_on_hand
      WHERE ($1::text IS NULL OR grp::text = $1)
        AND ($2::bool IS NOT TRUE OR stock_status IN ('LOW','OUT_OF_STOCK'))
      ORDER BY CASE stock_status WHEN 'OUT_OF_STOCK' THEN 0 WHEN 'LOW' THEN 1
                                 WHEN 'WARNING' THEN 2 ELSE 3 END, grp, name_th`,
    [req.query.grp || null, req.query.only_low === 'true']
  );

  send(req, res, {
    rows,
    filename: req.query.only_low === 'true' ? 'low-stock-alert' : 'stock-on-hand',
    headers: [
      { key: 'sku', label: 'รหัสวัตถุดิบ' },
      { key: 'name_th', label: 'ชื่อวัตถุดิบ' },
      { key: 'group_name', label: 'ประเภท' },
      { key: 'unit', label: 'หน่วย' },
      { key: 'qty_on_hand', label: 'คงเหลือ' },
      { key: 'min_qty', label: 'ขั้นต่ำ' },
      { key: 'cost_per_unit', label: 'ต้นทุน/หน่วย' },
      { key: 'stock_value', label: 'มูลค่าคงเหลือ' },
      { key: 'status_label', label: 'สถานะ' },
    ],
    extra: {
      total_value: Math.round(rows.reduce((s, r) => s + Number(r.stock_value), 0) * 100) / 100,
      low_count: rows.filter((r) => r.stock_status === 'LOW').length,
      out_count: rows.filter((r) => r.stock_status === 'OUT_OF_STOCK').length,
    },
  });
}));

/**
 * GET /api/reports/stock-movements — รายงานการรับเข้า / เบิกใช้วัตถุดิบ
 * query: ?type=IN|ISSUE|SALE|RETURN|ADJUST ?from= ?to= ?format=csv
 */
router.get('/stock-movements', authRequired, wrap(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { rows } = await query(
    `SELECT to_char(sm.created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') AS moved_at,
            i.sku, i.name_th, i.unit,
            CASE sm.movement_type WHEN 'IN' THEN 'รับเข้า' WHEN 'ISSUE' THEN 'เบิกใช้'
                                  WHEN 'SALE' THEN 'ตัดจากการขาย' WHEN 'RETURN' THEN 'คืนสต็อก'
                                  ELSE 'ปรับยอด' END AS type_label,
            sm.movement_type, sm.qty_change, sm.balance_after, sm.unit_cost,
            ROUND(ABS(sm.qty_change) * sm.unit_cost, 2) AS value,
            sm.ref_no, sm.note, u.full_name AS created_by_name
       FROM stock_movements sm
       JOIN ingredients i ON i.id = sm.ingredient_id
       LEFT JOIN users u  ON u.id = sm.created_by
      WHERE ($1::text IS NULL OR sm.movement_type::text = $1)
        AND (sm.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $2 AND $3
      ORDER BY sm.id DESC`,
    [req.query.type || null, from, to]
  );

  const summary = rows.reduce((a, r) => {
    a[r.movement_type] = (a[r.movement_type] || 0) + 1;
    if (r.movement_type === 'IN') a.in_value += Number(r.value);
    return a;
  }, { in_value: 0 });

  send(req, res, {
    rows,
    filename: `stock-movements-${from}-to-${to}`,
    headers: [
      { key: 'moved_at', label: 'วันที่-เวลา' },
      { key: 'sku', label: 'รหัสวัตถุดิบ' },
      { key: 'name_th', label: 'ชื่อวัตถุดิบ' },
      { key: 'type_label', label: 'ประเภทรายการ' },
      { key: 'qty_change', label: 'จำนวน' },
      { key: 'unit', label: 'หน่วย' },
      { key: 'balance_after', label: 'คงเหลือหลังทำรายการ' },
      { key: 'value', label: 'มูลค่า' },
      { key: 'ref_no', label: 'เอกสารอ้างอิง' },
      { key: 'created_by_name', label: 'ผู้ทำรายการ' },
      { key: 'note', label: 'หมายเหตุ' },
    ],
    extra: { from, to, summary: { ...summary, in_value: Math.round(summary.in_value * 100) / 100 } },
  });
}));

/**
 * GET /api/reports/bills — รายงานบิลขายรายใบ (ใช้ตรวจสอบย้อนหลัง)
 */
router.get('/bills', authRequired, wrap(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { rows } = await query(
    `SELECT o.order_no, t.table_no,
            to_char(o.opened_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') AS opened,
            to_char(o.closed_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') AS closed,
            o.guest_count, o.subtotal, o.discount, o.grand_total,
            string_agg(DISTINCT p.method::text, ', ') AS methods,
            u.full_name AS cashier_name
       FROM orders o
       JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN payments p ON p.order_id = o.id
       LEFT JOIN users u    ON u.id = o.closed_by
      WHERE o.status = 'PAID'
        AND (o.closed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
      GROUP BY o.id, t.table_no, u.full_name
      ORDER BY o.closed_at DESC`,
    [from, to]
  );

  send(req, res, {
    rows,
    filename: `bills-${from}-to-${to}`,
    headers: [
      { key: 'order_no', label: 'เลขที่บิล' },
      { key: 'table_no', label: 'โต๊ะ' },
      { key: 'opened', label: 'เปิดบิล' },
      { key: 'closed', label: 'ปิดบิล' },
      { key: 'guest_count', label: 'ลูกค้า' },
      { key: 'subtotal', label: 'ยอดรวม' },
      { key: 'discount', label: 'ส่วนลด' },
      { key: 'grand_total', label: 'ยอดสุทธิ' },
      { key: 'methods', label: 'ช่องทางชำระ' },
      { key: 'cashier_name', label: 'พนักงาน' },
    ],
    extra: { from, to },
  });
}));

/**
 * GET /api/reports/payment-methods — สัดส่วนช่องทางการชำระเงิน
 */
router.get('/payment-methods', authRequired, wrap(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { rows } = await query(
    `SELECT p.method::text,
            CASE p.method WHEN 'CASH' THEN 'เงินสด' WHEN 'TRANSFER' THEN 'โอนเงิน'
                          ELSE 'QR Code' END AS method_label,
            COUNT(*)::int AS txn_count,
            SUM(p.amount) AS total_amount
       FROM payments p
      WHERE (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
      GROUP BY p.method ORDER BY total_amount DESC`,
    [from, to]
  );
  send(req, res, { rows, filename: `payment-methods-${from}-to-${to}`, extra: { from, to } });
}));

export default router;
