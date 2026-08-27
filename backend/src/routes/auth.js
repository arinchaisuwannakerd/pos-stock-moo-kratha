import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { AppError, wrap } from '../utils.js';
import { signToken, authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

/** POST /api/auth/login — เข้าสู่ระบบ รับ JWT */
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new AppError(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !user.is_active) throw new AppError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new AppError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

  res.json({
    ok: true,
    token: signToken(user),
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
  });
}));

/** GET /api/auth/me — ข้อมูลผู้ใช้ที่ล็อกอินอยู่ */
router.get('/me', authRequired, wrap(async (req, res) => {
  const { rows } = await query(
    'SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบผู้ใช้');
  res.json({ ok: true, data: rows[0] });
}));

/** GET /api/auth/users — รายชื่อผู้ใช้ (เจ้าของร้านเท่านั้น) */
router.get('/users', authRequired, requireRole('OWNER'), wrap(async (_req, res) => {
  const { rows } = await query(
    'SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY id'
  );
  res.json({ ok: true, data: rows });
}));

/** POST /api/auth/users — เพิ่มผู้ใช้ใหม่ (เจ้าของร้านเท่านั้น) */
router.post('/users', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { username, password, full_name, role = 'STAFF' } = req.body || {};
  if (!username || !password || !full_name) {
    throw new AppError(400, 'ต้องระบุ username, password และ full_name');
  }
  if (password.length < 6) throw new AppError(400, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
  if (!['OWNER', 'STAFF'].includes(role)) throw new AppError(400, 'role ต้องเป็น OWNER หรือ STAFF');

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1,$2,$3,$4) RETURNING id, username, full_name, role, is_active, created_at`,
    [username, hash, full_name, role]
  );
  res.status(201).json({ ok: true, data: rows[0] });
}));

/** PATCH /api/auth/users/:id — แก้ไข/ปิดการใช้งานผู้ใช้ */
router.patch('/users/:id', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const { full_name, role, is_active, password } = req.body || {};
  const hash = password ? await bcrypt.hash(password, 10) : null;
  const { rows } = await query(
    `UPDATE users SET
       full_name     = COALESCE($2, full_name),
       role          = COALESCE($3::user_role, role),
       is_active     = COALESCE($4, is_active),
       password_hash = COALESCE($5, password_hash)
     WHERE id = $1
     RETURNING id, username, full_name, role, is_active, created_at`,
    [req.params.id, full_name ?? null, role ?? null, is_active ?? null, hash]
  );
  if (!rows[0]) throw new AppError(404, 'ไม่พบผู้ใช้');
  res.json({ ok: true, data: rows[0] });
}));

export default router;
