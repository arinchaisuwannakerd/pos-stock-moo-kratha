/** ข้อผิดพลาดที่รู้สาเหตุ ส่ง HTTP status กลับได้ตรง ๆ */
export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** ครอบ async route handler ให้ error เด้งเข้า error middleware */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** yyyymmdd ตามเวลาไทย */
export function todayCode(date = new Date()) {
  const th = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return `${th.getFullYear()}${String(th.getMonth() + 1).padStart(2, '0')}${String(th.getDate()).padStart(2, '0')}`;
}

/**
 * สร้างเลขเอกสารรันนิ่งต่อวัน เช่น OD20260827-0001
 * ใช้ client เดียวกับทรานแซกชันเพื่อกันเลขชนกัน
 */
export async function nextDocNo(client, { table, column, prefix }) {
  const code = todayCode();
  const like = `${prefix}${code}-%`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(${column} FROM '[0-9]{4}$')::int), 0) + 1 AS seq
       FROM ${table} WHERE ${column} LIKE $1`,
    [like]
  );
  return `${prefix}${code}-${String(rows[0].seq).padStart(4, '0')}`;
}

/** ปัดทศนิยม 2 ตำแหน่งแบบเงินบาท */
export const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** ปัดปริมาณวัตถุดิบ 3 ตำแหน่ง */
export const qty3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** แปลง array ของ object เป็น CSV (มี BOM ให้ Excel อ่านภาษาไทยได้) */
export function toCsv(rows, headers) {
  if (!rows.length && !headers) return '﻿';
  const cols = headers || Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}

/** ช่วงวันที่จาก query string โดยดีฟอลต์เป็นวันนี้ (เวลาไทย) */
export function dateRange(q) {
  const today = todayCode();
  const iso = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  return { from: q.from || iso, to: q.to || q.from || iso };
}

/**
 * สร้าง payload มาตรฐาน EMVCo สำหรับ PromptPay QR
 * (ฝั่งหน้าเว็บนำสตริงนี้ไป render เป็น QR ได้เลย)
 */
export function promptPayPayload(target, amount) {
  const id = String(target).replace(/\D/g, '');
  const acc =
    id.length === 13 ? `0213${id}` // เลขประจำตัวผู้เสียภาษี
    : id.length === 10 ? `0113${'0066' + id.slice(1)}` // เบอร์มือถือ -> 0066xxxxxxxxx
    : `0113${id.padStart(13, '0')}`;

  const f = (tag, val) => `${tag}${String(val.length).padStart(2, '0')}${val}`;
  const merchant = f('29', `0016A000000677010111${acc}`);
  const amt = amount ? f('54', Number(amount).toFixed(2)) : '';
  const body =
    f('00', '01') +
    f('01', amount ? '12' : '11') +
    merchant +
    f('53', '764') +
    amt +
    f('58', 'TH') +
    '6304';

  // CRC-16/CCITT-FALSE
  let crc = 0xffff;
  for (let i = 0; i < body.length; i++) {
    crc ^= body.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return body + crc.toString(16).toUpperCase().padStart(4, '0');
}
