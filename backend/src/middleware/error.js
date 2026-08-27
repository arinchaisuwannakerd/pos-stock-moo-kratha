import { AppError } from '../utils.js';

export function notFound(req, res) {
  res.status(404).json({ ok: false, error: `ไม่พบปลายทาง ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: err.message, details: err.details });
  }

  // แปลงข้อผิดพลาดของ PostgreSQL ให้อ่านรู้เรื่อง
  switch (err.code) {
    case '23505': // unique_violation
      if (err.constraint === 'uq_orders_open_per_table') {
        return res.status(409).json({ ok: false, error: 'โต๊ะนี้มีบิลที่ยังไม่ปิดอยู่แล้ว' });
      }
      return res.status(409).json({ ok: false, error: 'ข้อมูลซ้ำกับที่มีอยู่ในระบบ', details: err.detail });
    case '23503': // foreign_key_violation
      return res.status(409).json({ ok: false, error: 'อ้างอิงข้อมูลที่ไม่มีอยู่จริง', details: err.detail });
    case '23514': // check_violation
      return res.status(400).json({ ok: false, error: 'ค่าที่ส่งมาไม่อยู่ในเงื่อนไขที่กำหนด', details: err.constraint });
    case '22P02': // invalid_text_representation
      return res.status(400).json({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง', details: err.message });
    default:
      break;
  }

  console.error('[error]', err);
  res.status(500).json({ ok: false, error: 'เกิดข้อผิดพลาดภายในระบบ', details: err.message });
}
