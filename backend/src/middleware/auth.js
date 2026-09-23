import jwt from 'jsonwebtoken';
import { AppError } from '../utils.js';

/**
 * กุญแจสำหรับเซ็น JWT
 *
 * โค้ดนี้เป็นโปรเจกต์เปิด ใครก็อ่านได้ ถ้าปล่อยให้ใช้ค่าเริ่มต้นที่เขียนไว้ในไฟล์
 * ใครก็ปลอม token เป็นเจ้าของร้านได้ทันที จึงบังคับว่าตอนใช้งานจริงต้องตั้ง
 * JWT_SECRET เองเสมอ ไม่เช่นนั้นเซิร์ฟเวอร์จะไม่ยอมเริ่มทำงาน
 */
const SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ไม่ได้ตั้งค่า JWT_SECRET — ห้ามใช้งานจริงโดยไม่กำหนดกุญแจของตัวเอง ' +
      '(คัดลอก backend/.env.example เป็น backend/.env แล้วใส่ค่าสุ่มยาว ๆ)'
    );
  }

  console.warn(
    '\n  คำเตือน: ไม่พบ JWT_SECRET จึงใช้ค่าเริ่มต้นสำหรับการพัฒนาเท่านั้น' +
    '\n  ก่อนนำขึ้นใช้งานจริง ให้สร้างไฟล์ backend/.env แล้วกำหนด JWT_SECRET ของตัวเอง\n'
  );
  return 'dev-only-insecure-secret';
})();

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.full_name },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

/** ต้องล็อกอินก่อนถึงจะเรียกได้ */
export function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'ต้องเข้าสู่ระบบก่อนใช้งาน (ไม่พบ Bearer token)'));
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: payload.sub, username: payload.username, role: payload.role, name: payload.name };
    next();
  } catch {
    next(new AppError(401, 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
  }
}

/** จำกัดสิทธิ์ตามบทบาท เช่น requireRole('OWNER') */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, 'ต้องเข้าสู่ระบบก่อนใช้งาน'));
  if (!roles.includes(req.user.role)) {
    return next(new AppError(403, `ต้องมีสิทธิ์ ${roles.join(' หรือ ')} จึงจะใช้งานเมนูนี้ได้`));
  }
  next();
};
