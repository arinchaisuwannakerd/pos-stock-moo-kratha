# พจนานุกรมข้อมูล — ระบบ POS & Stock ร้านย่างให้หมูกระทะ บ้านน้องโฟค

ฐานข้อมูล **PostgreSQL 16** ชื่อ `pos_stock` — 12 ตาราง 3 view

## ความสัมพันธ์โดยรวม

```
users ─────────┬──< orders ──< order_items >── menu_items >── categories
               │      │                            │
               │      └──< payments                └──< recipes >── ingredients
               │                                                        │
               ├──< stock_docs ──< stock_doc_lines >────────────────────┤
               └──< stock_movements >───────────────────────────────────┘

dining_tables ──< orders
settings (คีย์-ค่า ตั้งค่าร้าน)
```

จุดเชื่อมสำคัญคือ **`recipes`** ซึ่งเป็นตารางสูตรอาหาร (BOM) ที่ทำให้ระบบรู้ว่าขายเมนูหนึ่ง
ต้องตัดวัตถุดิบอะไรบ้าง อย่างละเท่าไร

---

## ตารางข้อมูลหลัก

### `users` — ผู้ใช้งานระบบ

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | SERIAL PK | รหัสผู้ใช้ |
| `username` | VARCHAR(50) UNIQUE | ชื่อผู้ใช้สำหรับเข้าสู่ระบบ |
| `password_hash` | TEXT | รหัสผ่านที่เข้ารหัสด้วย bcrypt |
| `full_name` | VARCHAR(120) | ชื่อ-นามสกุล |
| `role` | `user_role` | `OWNER` เจ้าของร้าน / `STAFF` พนักงาน |
| `is_active` | BOOLEAN | ปิดการใช้งานได้โดยไม่ต้องลบ |

### `dining_tables` — ผังโต๊ะ 20 โต๊ะ

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `table_no` | VARCHAR(10) UNIQUE | T01 – T20 |
| `zone` | VARCHAR(40) | โซนในร้าน (แอร์) / โซนนอกร้าน / โซนระเบียง |
| `seats` | SMALLINT | จำนวนที่นั่ง |
| `status` | `table_status` | `FREE` ว่าง / `OCCUPIED` กำลังใช้งาน / `BILLING` รอชำระเงิน |

### `categories` — หมวดหมู่เมนู

`BBQ` หมูกระทะ · `SNACK` อาหารทานเล่น · `DRINK` เครื่องดื่ม · `ICE` น้ำแข็ง

### `menu_items` — รายการเมนูอาหาร

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `sku` | VARCHAR(30) UNIQUE | รหัสเมนู เช่น MN-B02 |
| `category_id` | FK → `categories` | หมวดหมู่ |
| `name_th` | VARCHAR(120) | ชื่อเมนู |
| `price` | NUMERIC(12,2) | ราคาขาย |
| `unit` | VARCHAR(20) | ชุด / จาน / ขวด / ถัง |
| `is_available` | BOOLEAN | เปิด-ปิดการขาย (ปิดแทนการลบ) |

### `ingredients` — วัตถุดิบในคลัง

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `sku` | VARCHAR(30) UNIQUE | รหัสวัตถุดิบ เช่น ING-M01 |
| `name_th` | VARCHAR(120) | ชื่อวัตถุดิบ |
| `grp` | `ingredient_group` | `MEAT` เนื้อสัตว์ / `VEGETABLE` ผัก / `DRINK` เครื่องดื่ม / `ICE` น้ำแข็ง / `OTHER` |
| `unit` | VARCHAR(20) | หน่วยนับ เช่น กก. ขวด ฟอง ถุง |
| `qty_on_hand` | NUMERIC(12,3) | **ยอดคงเหลือจริง** อัปเดตทุกครั้งที่มีการเคลื่อนไหว |
| `min_qty` | NUMERIC(12,3) | จุดสั่งซื้อขั้นต่ำ — ต่ำกว่านี้จะแจ้งเตือน |
| `cost_per_unit` | NUMERIC(12,2) | ต้นทุนต่อหน่วยล่าสุด (อัปเดตเมื่อรับเข้า) |

### `recipes` — สูตรอาหาร (BOM)

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `menu_item_id` | FK → `menu_items` | เมนู |
| `ingredient_id` | FK → `ingredients` | วัตถุดิบที่ใช้ |
| `qty_per_unit` | NUMERIC(12,4) | ใช้กี่หน่วยต่อเมนู 1 หน่วย |

มี `UNIQUE (menu_item_id, ingredient_id)` — วัตถุดิบหนึ่งชนิดปรากฏในสูตรของเมนูหนึ่งได้ครั้งเดียว

---

## ตารางการขาย

### `orders` — บิล

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `order_no` | VARCHAR(24) UNIQUE | เลขที่บิล รูปแบบ `OD20260827-0001` |
| `table_id` | FK → `dining_tables` | โต๊ะ |
| `status` | `order_status` | `OPEN` / `BILLING` / `PAID` / `VOID` |
| `channel` | `order_channel` | `STAFF` พนักงานรับออเดอร์ / `CUSTOMER` ลูกค้าสั่งเอง |
| `guest_count` | SMALLINT | จำนวนลูกค้า |
| `subtotal` `discount` `service_charge` `vat_amount` `grand_total` | NUMERIC(12,2) | ยอดเงิน คำนวณใหม่ทุกครั้งที่รายการเปลี่ยน |
| `opened_at` / `closed_at` | TIMESTAMPTZ | เวลาเปิด-ปิดบิล |

**ข้อบังคับสำคัญ** — partial unique index:

```sql
CREATE UNIQUE INDEX uq_orders_open_per_table
    ON orders (table_id) WHERE status IN ('OPEN', 'BILLING');
```

ทำให้ฐานข้อมูลรับประกันว่าหนึ่งโต๊ะมีบิลค้างได้ครั้งละ 1 ใบเท่านั้น

### `order_items` — รายการอาหารในบิล

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `order_id` | FK → `orders` | บิล |
| `menu_item_id` | FK → `menu_items` | เมนู |
| `qty` `unit_price` `line_total` | NUMERIC | จำนวนและยอดเงินของบรรทัดนี้ |
| `round_no` | SMALLINT | **รอบการสั่ง** — 1 = รอบแรก, 2+ = สั่งเพิ่มระหว่างทาน |
| `status` | `order_item_status` | `ORDERED` / `SERVED` / `CANCELLED` |

รายการที่ยกเลิกจะเปลี่ยนเป็น `CANCELLED` แทนการลบ เพื่อให้ตรวจสอบย้อนหลังได้

### `payments` — การชำระเงิน

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `order_id` | FK → `orders` | บิล (หนึ่งบิลชำระหลายครั้งได้) |
| `method` | `payment_method` | `CASH` เงินสด / `TRANSFER` โอนเงิน / `QR` QR Code |
| `amount` | NUMERIC(12,2) | ยอดที่รับชำระ |
| `received` / `change_amount` | NUMERIC(12,2) | เงินที่รับมาและเงินทอน (เฉพาะเงินสด) |
| `reference_no` | VARCHAR(60) | เลขอ้างอิงการโอน/สลิป |
| `receipt_no` | VARCHAR(24) UNIQUE | เลขที่ใบเสร็จ รูปแบบ `RC20260827-0001` |

---

## ตารางคลังวัตถุดิบ

### `stock_docs` / `stock_doc_lines` — เอกสารรับเข้าและเบิกใช้

หัวเอกสารเก็บ `doc_no` (`IN20260827-0001` รับเข้า / `IS20260827-0001` เบิกใช้), ผู้จำหน่าย และมูลค่ารวม
ส่วนบรรทัดเก็บวัตถุดิบ จำนวน ต้นทุนต่อหน่วย

### `stock_movements` — บัญชีเดินสะพัดวัตถุดิบ

**ตารางสำคัญที่สุดของฝั่งสต็อก** — ทุกการเคลื่อนไหวของวัตถุดิบถูกบันทึกที่นี่โดยไม่มีข้อยกเว้น

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `ingredient_id` | FK → `ingredients` | วัตถุดิบ |
| `movement_type` | `movement_type` | `IN` รับเข้า / `ISSUE` เบิกใช้ / `SALE` ตัดจากการขาย / `RETURN` คืนสต็อก / `ADJUST` ปรับยอด |
| `qty_change` | NUMERIC(12,3) | จำนวนที่เปลี่ยน (+ เข้า / − ออก) |
| `balance_after` | NUMERIC(12,3) | ยอดคงเหลือหลังทำรายการ — ทำให้ตรวจย้อนหลังได้ว่ายอด ณ เวลาใดเป็นเท่าไร |
| `ref_type` / `ref_id` / `ref_no` | | อ้างอิงกลับไปยังบิลหรือเอกสารต้นทาง |
| `created_by` | FK → `users` | ผู้ทำรายการ (เป็น NULL เมื่อลูกค้าสั่งเอง) |

---

## View สำหรับการสืบค้น

| View | ใช้ทำอะไร |
|---|---|
| `v_table_status` | ผังสถานะโต๊ะ 20 โต๊ะ พร้อมยอดเงินคงค้างและจำนวนรายการของแต่ละโต๊ะ |
| `v_stock_on_hand` | วัตถุดิบคงเหลือ real-time พร้อมคำนวณ `stock_status` เป็น `OK` / `WARNING` / `LOW` / `OUT_OF_STOCK` และมูลค่าคงคลัง |
| `v_daily_sales` | ยอดขายรายวันจากบิลที่ชำระแล้ว (แปลงเวลาเป็น Asia/Bangkok ก่อนตัดวัน) |

---

## ชนิดข้อมูลที่นิยามเอง (ENUM)

```sql
user_role         : OWNER, STAFF
table_status      : FREE, OCCUPIED, BILLING
order_status      : OPEN, BILLING, PAID, VOID
order_item_status : ORDERED, SERVED, CANCELLED
order_channel     : STAFF, CUSTOMER
payment_method    : CASH, TRANSFER, QR
ingredient_group  : MEAT, VEGETABLE, DRINK, ICE, OTHER
movement_type     : IN, ISSUE, SALE, RETURN, ADJUST
stock_doc_type    : IN, ISSUE
```

การใช้ ENUM แทนข้อความอิสระทำให้ฐานข้อมูลปฏิเสธค่าที่ไม่ถูกต้องตั้งแต่ชั้นล่างสุด

---

## หมายเหตุเรื่องเวลา

ทุกคอลัมน์เวลาเป็น `TIMESTAMPTZ` และรายงานทั้งหมดแปลงเป็น `Asia/Bangkok` ก่อนตัดวัน
เพื่อให้ "ยอดขายวันนี้" ตรงกับวันตามเวลาไทยเสมอ ไม่ใช่ UTC
