/**
 * สร้างฐานข้อมูล + ใส่ข้อมูลตั้งต้น
 *   node scripts/migrate.js          -> สร้างโครงสร้างและข้อมูลตั้งต้น
 *   node scripts/migrate.js --reset  -> ลบข้อมูลเดิมทั้งหมดแล้วสร้างใหม่ (เหมือนกัน เพราะ schema.sql มี DROP อยู่แล้ว)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = (f) => path.join(dir, '..', 'db', f);

const DEFAULT_USERS = [
  { username: 'owner',  password: 'owner123', full_name: 'นายพงศพัทธ์ ดวงจิตต์',   role: 'OWNER' },
  { username: 'arin',   password: 'staff123', full_name: 'นายอริญชัย สุวรรณเกิด',   role: 'OWNER' },
  { username: 'staff1', password: 'staff123', full_name: 'นางสาวแสงรัส จองดี',      role: 'STAFF' },
  { username: 'staff2', password: 'staff123', full_name: 'พนักงานหน้าร้าน 2',       role: 'STAFF' },
];

async function main() {
  const client = await pool.connect();
  try {
    console.log('[1/3] สร้างโครงสร้างตาราง (schema.sql) ...');
    await client.query(fs.readFileSync(sqlPath('schema.sql'), 'utf8'));

    console.log('[2/3] ใส่ข้อมูลตั้งต้น (seed.sql) ...');
    await client.query(fs.readFileSync(sqlPath('seed.sql'), 'utf8'));

    console.log('[3/3] สร้างบัญชีผู้ใช้ ...');
    for (const u of DEFAULT_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO users (username, password_hash, full_name, role)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               full_name     = EXCLUDED.full_name,
               role          = EXCLUDED.role`,
        [u.username, hash, u.full_name, u.role]
      );
    }

    const counts = await client.query(`
      SELECT (SELECT COUNT(*) FROM dining_tables) AS tables,
             (SELECT COUNT(*) FROM categories)    AS categories,
             (SELECT COUNT(*) FROM menu_items)    AS menu_items,
             (SELECT COUNT(*) FROM ingredients)   AS ingredients,
             (SELECT COUNT(*) FROM recipes)       AS recipes,
             (SELECT COUNT(*) FROM users)         AS users`);

    console.log('\n  สร้างฐานข้อมูลเรียบร้อย');
    console.table(counts.rows[0]);
    console.log('\n  บัญชีสำหรับเข้าสู่ระบบ:');
    for (const u of DEFAULT_USERS) console.log(`    ${u.username.padEnd(8)} / ${u.password.padEnd(9)} (${u.role})`);
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n  สร้างฐานข้อมูลไม่สำเร็จ:', err.message);
  console.error(err.detail || err.where || '');
  process.exit(1);
});
