import { AppError, qty3 } from '../utils.js';

/**
 * บันทึกการเคลื่อนไหวของวัตถุดิบ 1 รายการ แล้วอัปเดตยอดคงเหลือ
 * ล็อกแถววัตถุดิบด้วย FOR UPDATE เพื่อกันยอดเพี้ยนเมื่อมีการขายพร้อมกันหลายโต๊ะ
 *
 * @returns {{ingredient, balance_after, is_low}}
 */
export async function applyMovement(client, {
  ingredientId,
  movementType,
  qtyChange,          // + รับเข้า / - ตัดออก
  unitCost = null,
  refType = null,
  refId = null,
  refNo = null,
  note = null,
  userId = null,
  allowNegative = false,
}) {
  const { rows } = await client.query(
    `SELECT id, sku, name_th, unit, qty_on_hand, min_qty, cost_per_unit
       FROM ingredients WHERE id = $1 FOR UPDATE`,
    [ingredientId]
  );
  const ing = rows[0];
  if (!ing) throw new AppError(404, `ไม่พบวัตถุดิบรหัส id=${ingredientId}`);

  const balance = qty3(Number(ing.qty_on_hand) + Number(qtyChange));
  if (balance < 0 && !allowNegative) {
    throw new AppError(409,
      `วัตถุดิบ "${ing.name_th}" ไม่พอตัดสต็อก (คงเหลือ ${ing.qty_on_hand} ${ing.unit} ต้องใช้ ${Math.abs(qtyChange)} ${ing.unit})`,
      { ingredient_id: ing.id, sku: ing.sku, name_th: ing.name_th, on_hand: ing.qty_on_hand, required: Math.abs(qtyChange) }
    );
  }

  const cost = unitCost === null ? Number(ing.cost_per_unit) : Number(unitCost);

  await client.query(
    `UPDATE ingredients
        SET qty_on_hand = $2,
            cost_per_unit = CASE WHEN $3 > 0 THEN $4 ELSE cost_per_unit END,
            updated_at = now()
      WHERE id = $1`,
    [ing.id, balance, movementType === 'IN' ? 1 : 0, cost]
  );

  await client.query(
    `INSERT INTO stock_movements
       (ingredient_id, movement_type, qty_change, balance_after, unit_cost,
        ref_type, ref_id, ref_no, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ing.id, movementType, qtyChange, balance, cost, refType, refId, refNo, note, userId]
  );

  return {
    ingredient_id: ing.id,
    sku: ing.sku,
    name_th: ing.name_th,
    unit: ing.unit,
    qty_change: Number(qtyChange),
    balance_after: balance,
    min_qty: Number(ing.min_qty),
    is_low: balance <= Number(ing.min_qty),
    is_out: balance <= 0,
  };
}

/**
 * ตัด / คืนสต็อกวัตถุดิบตามสูตรอาหาร (BOM) ของเมนูหนึ่งรายการ
 *
 * @param sign -1 = ตัดสต็อกตอนบันทึกการขาย, +1 = คืนสต็อกตอนยกเลิกรายการ
 * @returns {Array} รายการวัตถุดิบที่ต่ำกว่าจุดสั่งซื้อหลังทำรายการ (Low Stock Alert)
 */
export async function applyRecipe(client, { menuItemId, qty, sign, refType, refId, refNo, userId, note }) {
  const { rows: recipe } = await client.query(
    `SELECT r.ingredient_id, r.qty_per_unit, i.name_th
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
      WHERE r.menu_item_id = $1
      ORDER BY r.ingredient_id`,
    [menuItemId]
  );

  const alerts = [];
  for (const line of recipe) {
    const change = qty3(sign * Number(line.qty_per_unit) * Number(qty));
    if (change === 0) continue;
    const result = await applyMovement(client, {
      ingredientId: line.ingredient_id,
      movementType: sign < 0 ? 'SALE' : 'RETURN',
      qtyChange: change,
      refType,
      refId,
      refNo,
      note,
      userId,
      // การคืนสต็อกไม่ต้องเช็คติดลบ
      allowNegative: sign > 0,
    });
    if (result.is_low) alerts.push(result);
  }
  return alerts;
}

/** ตรวจว่าวัตถุดิบพอสำหรับเมนู+จำนวนที่จะสั่งหรือไม่ (ไม่แตะยอดคงเหลือ) */
export async function checkAvailability(client, menuItemId, qty) {
  const { rows } = await client.query(
    `SELECT i.id, i.sku, i.name_th, i.unit, i.qty_on_hand, r.qty_per_unit,
            (r.qty_per_unit * $2) AS required
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
      WHERE r.menu_item_id = $1 AND i.qty_on_hand < r.qty_per_unit * $2`,
    [menuItemId, qty]
  );
  return rows;
}

/** รายการวัตถุดิบใกล้หมด / หมด สำหรับแสดงข้อความแจ้งเตือน */
export async function lowStockList(client) {
  const { rows } = await client.query(
    `SELECT * FROM v_stock_on_hand
      WHERE stock_status IN ('LOW', 'OUT_OF_STOCK')
      ORDER BY (qty_on_hand / NULLIF(min_qty, 0)) NULLS FIRST, name_th`
  );
  return rows;
}
