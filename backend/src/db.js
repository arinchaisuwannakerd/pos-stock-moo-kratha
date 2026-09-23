import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// NUMERIC มาจาก pg เป็น string โดยดีฟอลต์ -> แปลงเป็น number ให้ JSON ใช้งานง่าย
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));

export const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'pos_stock',
  user: process.env.PGUSER || 'pos_admin',
  // ค่าเริ่มต้นตรงกับ docker-compose.yml สำหรับรันบนเครื่องตัวเองเท่านั้น
  // ใช้งานจริงต้องกำหนด PGPASSWORD ในไฟล์ .env เสมอ
  password: process.env.PGPASSWORD || 'pos_pass123',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/**
 * รันงานหลายคำสั่งภายในทรานแซกชันเดียว
 * ใช้กับการบันทึกออเดอร์ / ตัดสต็อก ที่ต้อง atomic
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
