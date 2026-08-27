import jwt from 'jsonwebtoken';
import { AppError } from '../utils.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

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
