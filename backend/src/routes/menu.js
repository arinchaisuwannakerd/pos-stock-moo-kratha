import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, wrap } from '../utils.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

/** GET /api/menu/categories — หมวดหมู่เมนู */
router.get('/categories', authRequired, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT c.*, COUNT(m.id)::int AS item_count
       FROM categories c LEFT JOIN menu_items m ON m.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order`
  );
  res.json({ ok: true, data: rows });
}));

/**
 * GET /api/menu — รายการเมนูอาหาร
 * query: ?category=BBQ ?q=หมู ?available=true ?with_stock=true
 */
router.get('/', authRequired, wrap(async (req, res) => {
  const { category, q, available, with_stock } = req.query;
  const { rows } = await query(
    `SELECT m.*, c.code AS category_code, c.name_th AS category_name,
            (SELECT COUNT(*)::int FROM recipes r WHERE r.menu_item_id = m.id) AS recipe_count
       FROM menu_items m JOIN categories c ON c.id = m.category_id
      WHERE ($1::text IS NULL OR c.code = $1)
        AND ($2::text IS NULL OR m.name_th ILIKE '%' || $2 || '%' OR m.sku ILIKE '%' || $2 || '%')
        AND ($3::bool IS NULL OR m.is_available = $3)
      ORDER BY c.sort_order, m.sku`,
    [category || null, q || null, available === undefined ? null : available === 'true']
  );

  // แนบจำนวนที่ทำได้สูงสุดตามวัตถุดิบคงเหลือ (ใช้บนหน้าสั่งอาหาร)
  if (with_stock === 'true' && rows.length) {
    const { rows: caps } = await query(
      `SELECT r.menu_item_id,
              FLOOR(MIN(i.qty_on_hand / r.qty_per_unit))::int AS max_servable
         FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.menu_item_id = ANY($1::int[])
        GROUP BY r.menu_item_id`,
      [rows.map((r) => r.id)]
    );
    const map = new Map(caps.map((c) => [c.menu_item_id, c.max_servable]));
    for (const r of rows) r.max_servable = r.recipe_count === 0 ? null : Math.max(map.get(r.id) ?? 0, 0);
  }

  res.json({ ok: true, count: rows.length, data: rows });
}));

/** GET /api/menu/:id — เมนู 1 รายการ พร้อมสูตร BOM */
router.get('/:id', authRequired, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, c.code AS category_code, c.name_th AS category_name
       FROM menu_items m JOIN categories c ON c.id = m.category_id
      WHERE m.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบเมนูที่ระบุ');

  const { rows: recipe } = await query(
    `SELECT r.id, r.ingredient_id, r.qty_per_unit,
            i.sku, i.name_th, i.unit, i.qty_on_hand, i.min_qty, i.cost_per_unit,
            ROUND(r.qty_per_unit * i.cost_per_unit, 2) AS line_cost
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
      WHERE r.menu_item_id = $1 ORDER BY i.grp, i.name_th`,
    [req.params.id]
  );

  const foodCost = recipe.reduce((s, r) => s + Number(r.line_cost), 0);
  res.json({
    ok: true,
    data: {
      ...rows[0],
      recipe,
      food_cost: Math.round(foodCost * 100) / 100,
      margin: Math.round((Number(rows[0].price) - foodCost) * 100) / 100,
    },
  });
}));

/** POST /api/menu — เพิ่มเมนูใหม่ (พร้อมสูตร BOM ได้เลย) */
router.post('/', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { sku, category_code, category_id, name_th, description, price, unit = 'จาน', image_url, recipe = [] } = req.body || {};
  if (!sku || !name_th || price === undefined) throw new AppError(400, 'ต้องระบุ sku, name_th และ price');
  if (!category_code && !category_id) throw new AppError(400, 'ต้องระบุ category_code หรือ category_id');

  const data = await withTransaction(async (client) => {
    const { rows: cat } = await client.query(
      'SELECT id FROM categories WHERE ($1::int IS NOT NULL AND id = $1) OR code = $2',
      [category_id ?? null, category_code ?? null]
    );
    if (!cat[0]) throw new AppError(404, 'ไม่พบหมวดหมู่ที่ระบุ');

    const { rows } = await client.query(
      `INSERT INTO menu_items (sku, category_id, name_th, description, price, unit, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sku, cat[0].id, name_th, description ?? null, price, unit, image_url ?? null]
    );
    await upsertRecipe(client, rows[0].id, recipe, true);
    return rows[0];
  });

  res.status(201).json({ ok: true, data });
}));

/** PATCH /api/menu/:id — แก้ไขเมนู */
router.patch('/:id', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { name_th, description, price, unit, image_url, is_available, category_code } = req.body || {};
  const { rows } = await query(
    `UPDATE menu_items SET
       name_th      = COALESCE($2, name_th),
       description  = COALESCE($3, description),
       price        = COALESCE($4, price),
       unit         = COALESCE($5, unit),
       image_url    = COALESCE($6, image_url),
       is_available = COALESCE($7, is_available),
       category_id  = COALESCE((SELECT id FROM categories WHERE code = $8), category_id)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name_th ?? null, description ?? null, price ?? null, unit ?? null,
     image_url ?? null, is_available ?? null, category_code ?? null]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบเมนูที่ระบุ');
  res.json({ ok: true, data: rows[0] });
}));

/** PUT /api/menu/:id/recipe — กำหนดสูตรอาหาร (BOM) ใหม่ทั้งชุด */
router.put('/:id/recipe', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const lines = req.body?.recipe ?? req.body;
  if (!Array.isArray(lines)) throw new AppError(400, 'ต้องส่ง recipe เป็น array ของ { ingredient_sku | ingredient_id, qty_per_unit }');

  const data = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id FROM menu_items WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new AppError(404, 'ไม่พบเมนูที่ระบุ');
    await upsertRecipe(client, rows[0].id, lines, false);
    const { rows: out } = await client.query(
      `SELECT r.ingredient_id, r.qty_per_unit, i.sku, i.name_th, i.unit
         FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.menu_item_id = $1 ORDER BY i.name_th`,
      [rows[0].id]
    );
    return out;
  });

  res.json({ ok: true, count: data.length, data });
}));

/** DELETE /api/menu/:id — ปิดการขายเมนู (soft delete) */
router.delete('/:id', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { rows } = await query(
    'UPDATE menu_items SET is_available = FALSE WHERE id = $1 RETURNING id, sku, name_th, is_available',
    [req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบเมนูที่ระบุ');
  res.json({ ok: true, message: 'ปิดการขายเมนูเรียบร้อย', data: rows[0] });
}));

async function upsertRecipe(client, menuItemId, lines, skipClear) {
  if (!skipClear) await client.query('DELETE FROM recipes WHERE menu_item_id = $1', [menuItemId]);
  for (const line of lines) {
    const { rows: ing } = await client.query(
      'SELECT id FROM ingredients WHERE ($1::int IS NOT NULL AND id = $1) OR sku = $2',
      [line.ingredient_id ?? null, line.ingredient_sku ?? null]
    );
    if (!ing[0]) throw new AppError(404, `ไม่พบวัตถุดิบ ${line.ingredient_sku || line.ingredient_id}`);
    await client.query(
      `INSERT INTO recipes (menu_item_id, ingredient_id, qty_per_unit) VALUES ($1,$2,$3)
       ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE SET qty_per_unit = EXCLUDED.qty_per_unit`,
      [menuItemId, ing[0].id, line.qty_per_unit]
    );
  }
}

export default router;
