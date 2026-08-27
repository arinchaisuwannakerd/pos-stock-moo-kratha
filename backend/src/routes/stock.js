import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, wrap, nextDocNo, money } from '../utils.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { applyMovement, lowStockList } from '../services/stockService.js';

const router = Router();

/** GET /api/stock/low — วัตถุดิบใกล้หมด / หมด (Low Stock Alert) */
router.get('/low', authRequired, wrap(async (_req, res) => {
  const rows = await withTransaction((c) => lowStockList(c));
  res.json({
    ok: true,
    alert: rows.length > 0,
    message: rows.length
      ? `มีวัตถุดิบ ${rows.length} รายการที่ถึงจุดสั่งซื้อขั้นต่ำแล้ว`
      : 'วัตถุดิบทุกรายการอยู่ในระดับปกติ',
    count: rows.length,
    data: rows,
  });
}));

/**
 * GET /api/stock/movements — ประวัติการเคลื่อนไหววัตถุดิบทั้งหมด
 * query: ?type=IN|ISSUE|SALE|RETURN|ADJUST ?ingredient_id= ?from= ?to= ?limit=
 */
router.get('/movements', authRequired, wrap(async (req, res) => {
  const { type, ingredient_id, from, to, limit = 200 } = req.query;
  const { rows } = await query(
    `SELECT sm.*, i.sku, i.name_th, i.unit, i.grp, u.full_name AS created_by_name
       FROM stock_movements sm
       JOIN ingredients i ON i.id = sm.ingredient_id
       LEFT JOIN users u  ON u.id = sm.created_by
      WHERE ($1::text IS NULL OR sm.movement_type::text = $1)
        AND ($2::int  IS NULL OR sm.ingredient_id = $2)
        AND ($3::date IS NULL OR (sm.created_at AT TIME ZONE 'Asia/Bangkok')::date >= $3)
        AND ($4::date IS NULL OR (sm.created_at AT TIME ZONE 'Asia/Bangkok')::date <= $4)
      ORDER BY sm.id DESC LIMIT $5`,
    [type || null, ingredient_id || null, from || null, to || null, Math.min(Number(limit) || 200, 1000)]
  );
  res.json({ ok: true, count: rows.length, data: rows });
}));

/** GET /api/stock/docs — เอกสารรับเข้า / เบิกใช้ */
router.get('/docs', authRequired, wrap(async (req, res) => {
  const { type, from, to, limit = 100 } = req.query;
  const { rows } = await query(
    `SELECT d.*, u.full_name AS created_by_name,
            (SELECT COUNT(*)::int FROM stock_doc_lines l WHERE l.doc_id = d.id) AS line_count
       FROM stock_docs d LEFT JOIN users u ON u.id = d.created_by
      WHERE ($1::text IS NULL OR d.doc_type::text = $1)
        AND ($2::date IS NULL OR d.doc_date >= $2)
        AND ($3::date IS NULL OR d.doc_date <= $3)
      ORDER BY d.id DESC LIMIT $4`,
    [type || null, from || null, to || null, Math.min(Number(limit) || 100, 500)]
  );
  res.json({ ok: true, count: rows.length, data: rows });
}));

/** GET /api/stock/docs/:id — เอกสาร 1 ใบพร้อมรายการ */
router.get('/docs/:id', authRequired, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, u.full_name AS created_by_name
       FROM stock_docs d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบเอกสารที่ระบุ');

  const { rows: lines } = await query(
    `SELECT l.*, i.sku, i.name_th, i.unit, i.grp
       FROM stock_doc_lines l JOIN ingredients i ON i.id = l.ingredient_id
      WHERE l.doc_id = $1 ORDER BY l.id`,
    [req.params.id]
  );
  res.json({ ok: true, data: { ...rows[0], lines } });
}));

/**
 * POST /api/stock/in — บันทึกการรับเข้าวัตถุดิบ (Stock In)
 * body: { supplier, doc_date, note, lines: [{ ingredient_sku|ingredient_id, qty, unit_cost }] }
 */
router.post('/in', authRequired, wrap(async (req, res) => {
  const data = await createStockDoc(req, 'IN');
  res.status(201).json({ ok: true, message: `บันทึกรับเข้าวัตถุดิบ ${data.doc_no} เรียบร้อย`, data });
}));

/**
 * POST /api/stock/issue — บันทึกการเบิกใช้วัตถุดิบ
 * body เหมือน /in
 */
router.post('/issue', authRequired, wrap(async (req, res) => {
  const data = await createStockDoc(req, 'ISSUE');
  res.status(201).json({ ok: true, message: `บันทึกเบิกใช้วัตถุดิบ ${data.doc_no} เรียบร้อย`, data });
}));

/**
 * POST /api/stock/adjust — ปรับยอดคงเหลือให้ตรงกับที่นับได้จริง
 * body: { ingredient_sku|ingredient_id, counted_qty, note }
 */
router.post('/adjust', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { ingredient_id, ingredient_sku, counted_qty, note } = req.body || {};
  if (counted_qty === undefined) throw new AppError(400, 'ต้องระบุ counted_qty (ยอดที่นับได้จริง)');
  if (Number(counted_qty) < 0) throw new AppError(400, 'ยอดที่นับได้ต้องไม่ติดลบ');

  const data = await withTransaction(async (client) => {
    const ing = await resolveIngredient(client, { ingredient_id, ingredient_sku });
    const diff = Number(counted_qty) - Number(ing.qty_on_hand);
    if (diff === 0) return { message: 'ยอดตรงกับระบบอยู่แล้ว ไม่มีการปรับ', ...ing };

    return applyMovement(client, {
      ingredientId: ing.id,
      movementType: 'ADJUST',
      qtyChange: diff,
      refType: 'MANUAL',
      note: note || `ปรับยอดจากการนับสต็อก (ระบบ ${ing.qty_on_hand} -> นับได้ ${counted_qty})`,
      userId: req.user.id,
      allowNegative: true,
    });
  });

  res.json({ ok: true, message: 'ปรับยอดวัตถุดิบเรียบร้อย', data });
}));

// ------------------------------------------------------------------ helpers

async function createStockDoc(req, docType) {
  const { supplier, doc_date, note, lines } = req.body || {};
  if (!Array.isArray(lines) || !lines.length) {
    throw new AppError(400, 'ต้องระบุ lines อย่างน้อย 1 รายการ');
  }

  return withTransaction(async (client) => {
    const prefix = docType === 'IN' ? 'IN' : 'IS';
    const docNo = await nextDocNo(client, { table: 'stock_docs', column: 'doc_no', prefix });

    const { rows: docRows } = await client.query(
      `INSERT INTO stock_docs (doc_no, doc_type, doc_date, supplier, note, created_by)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6) RETURNING *`,
      [docNo, docType, doc_date ?? null, supplier ?? null, note ?? null, req.user.id]
    );
    const doc = docRows[0];

    let totalCost = 0;
    const results = [];
    for (const line of lines) {
      const ing = await resolveIngredient(client, line);
      const qty = Number(line.qty);
      if (!(qty > 0)) throw new AppError(400, `จำนวนของ "${ing.name_th}" ต้องมากกว่า 0`);

      const unitCost = line.unit_cost !== undefined ? Number(line.unit_cost) : Number(ing.cost_per_unit);
      const lineCost = money(qty * unitCost);
      totalCost += lineCost;

      await client.query(
        `INSERT INTO stock_doc_lines (doc_id, ingredient_id, qty, unit_cost, line_cost, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [doc.id, ing.id, qty, unitCost, lineCost, line.note ?? null]
      );

      results.push(await applyMovement(client, {
        ingredientId: ing.id,
        movementType: docType,
        qtyChange: docType === 'IN' ? qty : -qty,
        unitCost,
        refType: 'STOCK_DOC',
        refId: doc.id,
        refNo: doc.doc_no,
        note: line.note ?? doc.note,
        userId: req.user.id,
      }));
    }

    await client.query('UPDATE stock_docs SET total_cost = $2 WHERE id = $1', [doc.id, money(totalCost)]);

    return {
      ...doc,
      total_cost: money(totalCost),
      lines: results,
      stock_alerts: results.filter((r) => r.is_low),
    };
  });
}

async function resolveIngredient(client, { ingredient_id, ingredient_sku }) {
  const { rows } = await client.query(
    'SELECT * FROM ingredients WHERE ($1::int IS NOT NULL AND id = $1) OR sku = $2',
    [ingredient_id ?? null, ingredient_sku ?? null]
  );
  if (!rows[0]) throw new AppError(404, `ไม่พบวัตถุดิบ ${ingredient_sku || ingredient_id}`);
  return rows[0];
}

export default router;
