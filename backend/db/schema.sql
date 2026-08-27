-- ============================================================================
--  ระบบจัดการร้านย่างให้หมูกระทะ บ้านน้องโฟค กาญจนบุรี
--  Module : POS & Inventory Management
--  DBMS   : PostgreSQL 16
-- ============================================================================
BEGIN;

DROP VIEW  IF EXISTS v_daily_sales       CASCADE;
DROP VIEW  IF EXISTS v_stock_on_hand     CASCADE;
DROP VIEW  IF EXISTS v_table_status      CASCADE;

DROP TABLE IF EXISTS stock_movements     CASCADE;
DROP TABLE IF EXISTS stock_doc_lines     CASCADE;
DROP TABLE IF EXISTS stock_docs          CASCADE;
DROP TABLE IF EXISTS payments            CASCADE;
DROP TABLE IF EXISTS order_items         CASCADE;
DROP TABLE IF EXISTS orders              CASCADE;
DROP TABLE IF EXISTS recipes             CASCADE;
DROP TABLE IF EXISTS menu_items          CASCADE;
DROP TABLE IF EXISTS categories          CASCADE;
DROP TABLE IF EXISTS ingredients         CASCADE;
DROP TABLE IF EXISTS dining_tables       CASCADE;
DROP TABLE IF EXISTS users               CASCADE;
DROP TABLE IF EXISTS settings            CASCADE;

DROP TYPE IF EXISTS user_role         CASCADE;
DROP TYPE IF EXISTS table_status      CASCADE;
DROP TYPE IF EXISTS order_status      CASCADE;
DROP TYPE IF EXISTS order_item_status CASCADE;
DROP TYPE IF EXISTS order_channel     CASCADE;
DROP TYPE IF EXISTS payment_method    CASCADE;
DROP TYPE IF EXISTS ingredient_group  CASCADE;
DROP TYPE IF EXISTS movement_type     CASCADE;
DROP TYPE IF EXISTS stock_doc_type    CASCADE;

-- ---------------------------------------------------------------- ENUM TYPES
CREATE TYPE user_role         AS ENUM ('OWNER', 'STAFF');
CREATE TYPE table_status      AS ENUM ('FREE', 'OCCUPIED', 'BILLING');
CREATE TYPE order_status      AS ENUM ('OPEN', 'BILLING', 'PAID', 'VOID');
CREATE TYPE order_item_status AS ENUM ('ORDERED', 'SERVED', 'CANCELLED');
CREATE TYPE order_channel     AS ENUM ('STAFF', 'CUSTOMER');
CREATE TYPE payment_method    AS ENUM ('CASH', 'TRANSFER', 'QR');
CREATE TYPE ingredient_group  AS ENUM ('MEAT', 'VEGETABLE', 'DRINK', 'ICE', 'OTHER');
CREATE TYPE movement_type     AS ENUM ('IN', 'ISSUE', 'SALE', 'RETURN', 'ADJUST');
CREATE TYPE stock_doc_type    AS ENUM ('IN', 'ISSUE');

-- ------------------------------------------------------------------ SETTINGS
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT
);

-- --------------------------------------------------------------------- USERS
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    full_name     VARCHAR(120) NOT NULL,
    role          user_role    NOT NULL DEFAULT 'STAFF',
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------- ผังโต๊ะ (20 โต๊ะ)
CREATE TABLE dining_tables (
    id         SERIAL PRIMARY KEY,
    table_no   VARCHAR(10)  NOT NULL UNIQUE,
    zone       VARCHAR(40)  NOT NULL DEFAULT 'โซนในร้าน',
    seats      SMALLINT     NOT NULL DEFAULT 4 CHECK (seats > 0),
    status     table_status NOT NULL DEFAULT 'FREE',
    sort_order SMALLINT     NOT NULL DEFAULT 0
);

-- --------------------------------------------------------- หมวดหมู่เมนูอาหาร
CREATE TABLE categories (
    id         SERIAL PRIMARY KEY,
    code       VARCHAR(20) NOT NULL UNIQUE,
    name_th    VARCHAR(80) NOT NULL,
    sort_order SMALLINT    NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------ วัตถุดิบในคลัง
CREATE TABLE ingredients (
    id            SERIAL PRIMARY KEY,
    sku           VARCHAR(30)      NOT NULL UNIQUE,
    name_th       VARCHAR(120)     NOT NULL,
    grp           ingredient_group NOT NULL DEFAULT 'OTHER',
    unit          VARCHAR(20)      NOT NULL,
    qty_on_hand   NUMERIC(12,3)    NOT NULL DEFAULT 0,
    min_qty       NUMERIC(12,3)    NOT NULL DEFAULT 0,
    cost_per_unit NUMERIC(12,2)    NOT NULL DEFAULT 0,
    is_active     BOOLEAN          NOT NULL DEFAULT TRUE,
    updated_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingredients_grp ON ingredients (grp);

-- ------------------------------------------------------------ รายการเมนูอาหาร
CREATE TABLE menu_items (
    id           SERIAL PRIMARY KEY,
    sku          VARCHAR(30)   NOT NULL UNIQUE,
    category_id  INT           NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name_th      VARCHAR(120)  NOT NULL,
    description  TEXT,
    price        NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    unit         VARCHAR(20)   NOT NULL DEFAULT 'จาน',
    image_url    TEXT,
    is_available BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_menu_items_category ON menu_items (category_id);

-- ------------------------------------- สูตรอาหาร BOM (เมนู 1 -> วัตถุดิบ N)
CREATE TABLE recipes (
    id            SERIAL PRIMARY KEY,
    menu_item_id  INT           NOT NULL REFERENCES menu_items(id)  ON DELETE CASCADE,
    ingredient_id INT           NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    qty_per_unit  NUMERIC(12,4) NOT NULL CHECK (qty_per_unit > 0),
    UNIQUE (menu_item_id, ingredient_id)
);

-- ------------------------------------------------------------------- ออเดอร์
CREATE TABLE orders (
    id             SERIAL PRIMARY KEY,
    order_no       VARCHAR(24)   NOT NULL UNIQUE,
    table_id       INT           NOT NULL REFERENCES dining_tables(id) ON DELETE RESTRICT,
    status         order_status  NOT NULL DEFAULT 'OPEN',
    channel        order_channel NOT NULL DEFAULT 'STAFF',
    guest_count    SMALLINT      NOT NULL DEFAULT 1 CHECK (guest_count > 0),
    subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
    service_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
    vat_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    grand_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
    note           TEXT,
    opened_by      INT           REFERENCES users(id),
    closed_by      INT           REFERENCES users(id),
    opened_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    closed_at      TIMESTAMPTZ
);
CREATE INDEX idx_orders_table  ON orders (table_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_opened ON orders (opened_at);

-- หนึ่งโต๊ะเปิดบิลค้างได้ครั้งละ 1 ใบเท่านั้น
CREATE UNIQUE INDEX uq_orders_open_per_table
    ON orders (table_id) WHERE status IN ('OPEN', 'BILLING');

-- -------------------------------------------------------- รายการในออเดอร์
CREATE TABLE order_items (
    id           SERIAL PRIMARY KEY,
    order_id     INT               NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INT               NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
    qty          NUMERIC(10,2)     NOT NULL CHECK (qty > 0),
    unit_price   NUMERIC(12,2)     NOT NULL,
    line_total   NUMERIC(12,2)     NOT NULL,
    note         TEXT,
    status       order_item_status NOT NULL DEFAULT 'ORDERED',
    round_no     SMALLINT          NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_menu  ON order_items (menu_item_id);

-- --------------------------------------------------------------- ชำระเงิน
CREATE TABLE payments (
    id            SERIAL PRIMARY KEY,
    order_id      INT            NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    method        payment_method NOT NULL,
    amount        NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
    received      NUMERIC(12,2),
    change_amount NUMERIC(12,2)  NOT NULL DEFAULT 0,
    reference_no  VARCHAR(60),
    receipt_no    VARCHAR(24)    NOT NULL UNIQUE,
    cashier_id    INT            REFERENCES users(id),
    paid_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_paid_at ON payments (paid_at);

-- ------------------------- เอกสารรับเข้า / เบิกใช้วัตถุดิบ (หัวเอกสาร)
CREATE TABLE stock_docs (
    id         SERIAL PRIMARY KEY,
    doc_no     VARCHAR(24)    NOT NULL UNIQUE,
    doc_type   stock_doc_type NOT NULL,
    doc_date   DATE           NOT NULL DEFAULT CURRENT_DATE,
    supplier   VARCHAR(120),
    note       TEXT,
    total_cost NUMERIC(12,2)  NOT NULL DEFAULT 0,
    created_by INT            REFERENCES users(id),
    created_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_docs_date ON stock_docs (doc_date);

CREATE TABLE stock_doc_lines (
    id            SERIAL PRIMARY KEY,
    doc_id        INT           NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
    ingredient_id INT           NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    qty           NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    unit_cost     NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_cost     NUMERIC(12,2) NOT NULL DEFAULT 0,
    note          TEXT
);
CREATE INDEX idx_stock_doc_lines_doc ON stock_doc_lines (doc_id);

-- --------------------- บัญชีเดินสะพัดวัตถุดิบ (ledger ทุกการเคลื่อนไหว)
CREATE TABLE stock_movements (
    id            SERIAL PRIMARY KEY,
    ingredient_id INT           NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    movement_type movement_type NOT NULL,
    qty_change    NUMERIC(12,3) NOT NULL,
    balance_after NUMERIC(12,3) NOT NULL,
    unit_cost     NUMERIC(12,2) NOT NULL DEFAULT 0,
    ref_type      VARCHAR(20),
    ref_id        INT,
    ref_no        VARCHAR(24),
    note          TEXT,
    created_by    INT           REFERENCES users(id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_ingredient ON stock_movements (ingredient_id);
CREATE INDEX idx_movements_created    ON stock_movements (created_at);
CREATE INDEX idx_movements_type       ON stock_movements (movement_type);

-- ========================================================= VIEWS (การสืบค้น)

-- แสดงผังสถานะโต๊ะทั้ง 20 โต๊ะ + ยอดเงินคงค้างรายโต๊ะ
CREATE VIEW v_table_status AS
SELECT t.id,
       t.table_no,
       t.zone,
       t.seats,
       t.status,
       t.sort_order,
       o.id                       AS order_id,
       o.order_no,
       o.guest_count,
       o.opened_at,
       COALESCE(o.grand_total, 0) AS current_total,
       COALESCE((SELECT SUM(oi.qty) FROM order_items oi
                  WHERE oi.order_id = o.id AND oi.status <> 'CANCELLED'), 0) AS item_count
FROM dining_tables t
LEFT JOIN orders o
       ON o.table_id = t.id AND o.status IN ('OPEN', 'BILLING');

-- แสดงปริมาณวัตถุดิบคงเหลือจริงในคลังแบบ Real-time
CREATE VIEW v_stock_on_hand AS
SELECT i.id,
       i.sku,
       i.name_th,
       i.grp,
       i.unit,
       i.qty_on_hand,
       i.min_qty,
       i.cost_per_unit,
       ROUND(i.qty_on_hand * i.cost_per_unit, 2) AS stock_value,
       CASE WHEN i.qty_on_hand <= 0               THEN 'OUT_OF_STOCK'
            WHEN i.qty_on_hand <= i.min_qty       THEN 'LOW'
            WHEN i.qty_on_hand <= i.min_qty * 1.5 THEN 'WARNING'
            ELSE 'OK' END                         AS stock_status
FROM ingredients i
WHERE i.is_active;

-- รายงานยอดขายประจำวัน
CREATE VIEW v_daily_sales AS
SELECT (o.closed_at AT TIME ZONE 'Asia/Bangkok')::date AS sale_date,
       COUNT(*)                     AS bill_count,
       SUM(o.guest_count)           AS guest_count,
       SUM(o.subtotal)              AS subtotal,
       SUM(o.discount)              AS discount,
       SUM(o.vat_amount)            AS vat_amount,
       SUM(o.grand_total)           AS grand_total,
       ROUND(AVG(o.grand_total), 2) AS avg_bill
FROM orders o
WHERE o.status = 'PAID'
GROUP BY 1;

COMMIT;
