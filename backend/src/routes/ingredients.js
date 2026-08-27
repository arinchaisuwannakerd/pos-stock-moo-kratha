import { Router } from 'express';
import { query } from '../db.js';
import { AppError, wrap } from '../utils.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/ingredients — วัตถุดิบคงเหลือ real-time
 * query: ?grp=MEAT|VEGETABLE|DRINK|ICE|OTHER  ?status=LOW|OUT_OF_STOCK|WARNING|OK  ?q=
 */
router.get('/', authRequired, wrap(async (req, res) => {
  const { grp, status, q } = req.query;
  const { rows } = await query(
    `SELECT * FROM v_stock_on_hand
      WHERE ($1::text IS NULL OR grp::text = $1)
        AND ($2::text IS NULL OR stock_status = $2)
        AND ($3::text IS NULL OR name_th ILIKE '%' || $3 || '%' OR sku ILIKE '%' || $3 || '%')
      ORDER BY grp, name_th`,
    [grp || null, status || null, q || null]
  );

  const summary = {
    total_items: rows.length,
    low: rows.filter((r) => r.stock_status === 'LOW').length,
    out_of_stock: rows.filter((r) => r.stock_status === 'OUT_OF_STOCK').length,
    stock_value: Math.round(rows.reduce((s, r) => s + Number(r.stock_value), 0) * 100) / 100,
  };
  res.json({ ok: true, summary, data: rows });
}));

/** GET /api/ingredients/:id — วัตถุดิบ 1 รายการ + ประวัติการเคลื่อนไหวล่าสุด */
router.get('/:id', authRequired, wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM v_stock_on_hand WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new AppError(404, 'ไม่พบวัตถุดิบที่ระบุ');

  const { rows: movements } = await query(
    `SELECT sm.*, u.full_name AS created_by_name
       FROM stock_movements sm LEFT JOIN users u ON u.id = sm.created_by
      WHERE sm.ingredient_id = $1 ORDER BY sm.id DESC LIMIT 50`,
    [req.params.id]
  );

  const { rows: usedIn } = await query(
    `SELECT m.id, m.sku, m.name_th, r.qty_per_unit
       FROM recipes r JOIN menu_items m ON m.id = r.menu_item_id
      WHERE r.ingredient_id = $1 ORDER BY m.sku`,
    [req.params.id]
  );

  res.json({ ok: true, data: { ...rows[0], movements, used_in_menu: usedIn } });
}));

/** POST /api/ingredients — เพิ่มวัตถุดิบใหม่ */
router.post('/', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { sku, name_th, grp = 'OTHER', unit, qty_on_hand = 0, min_qty = 0, cost_per_unit = 0 } = req.body || {};
  if (!sku || !name_th || !unit) throw new AppError(400, 'ต้องระบุ sku, name_th และ unit');

  const { rows } = await query(
    `INSERT INTO ingredients (sku, name_th, grp, unit, qty_on_hand, min_qty, cost_per_unit)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sku, name_th, grp, unit, qty_on_hand, min_qty, cost_per_unit]
  );
  res.status(201).json({ ok: true, data: rows[0] });
}));

/**
 * PATCH /api/ingredients/:id — แก้ไขข้อมูลวัตถุดิบ
 * หมายเหตุ: ไม่แก้ qty_on_hand ตรงนี้ ต้องใช้ /api/stock/adjust เพื่อให้มี ledger เสมอ
 */
router.patch('/:id', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { name_th, grp, unit, min_qty, cost_per_unit, is_active } = req.body || {};
  const { rows } = await query(
    `UPDATE ingredients SET
       name_th       = COALESCE($2, name_th),
       grp           = COALESCE($3::ingredient_group, grp),
       unit          = COALESCE($4, unit),
       min_qty       = COALESCE($5, min_qty),
       cost_per_unit = COALESCE($6, cost_per_unit),
       is_active     = COALESCE($7, is_active),
       updated_at    = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, name_th ?? null, grp ?? null, unit ?? null,
     min_qty ?? null, cost_per_unit ?? null, is_active ?? null]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบวัตถุดิบที่ระบุ');
  res.json({ ok: true, data: rows[0] });
}));

export default router;
