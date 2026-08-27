const bahtFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('th-TH');

/** 1234.5 -> "1,234.50" */
export const baht = (n) => bahtFmt.format(Number(n || 0));

/** 1234 -> "1,234" */
export const num = (n) => intFmt.format(Number(n || 0));

/** ตัดทศนิยมท้ายที่ไม่จำเป็นออก : 2.500 -> "2.5" */
export const qty = (n) => String(Number(n || 0));

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-';

export const timeOnly = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';

/** ระยะเวลาที่ผ่านมาแบบสั้น ๆ เช่น "1 ชม. 05 น." */
export function since(iso) {
  if (!iso) return '-';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'เพิ่งเปิด';
  if (mins < 60) return `${mins} นาที`;
  return `${Math.floor(mins / 60)} ชม. ${String(mins % 60).padStart(2, '0')} น.`;
}

/** วันที่วันนี้ในรูปแบบ YYYY-MM-DD (เวลาไทย) */
export function todayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const TABLE_STATUS = {
  FREE:     { label: 'ว่าง',          cls: 'pill-free',    card: 'is-free' },
  OCCUPIED: { label: 'กำลังใช้งาน',   cls: 'pill-busy',    card: 'is-occupied' },
  BILLING:  { label: 'รอชำระเงิน',    cls: 'pill-billing', card: 'is-billing' },
};

export const STOCK_STATUS = {
  OK:           { label: 'ปกติ',      cls: 'pill-free' },
  WARNING:      { label: 'เฝ้าระวัง',  cls: 'pill-billing' },
  LOW:          { label: 'ใกล้หมด',    cls: 'pill-danger' },
  OUT_OF_STOCK: { label: 'หมด',       cls: 'pill-danger' },
};

export const GROUP_LABEL = {
  MEAT: 'เนื้อสัตว์', VEGETABLE: 'ผัก', DRINK: 'เครื่องดื่ม', ICE: 'น้ำแข็ง', OTHER: 'อื่น ๆ',
};

export const METHOD_LABEL = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', QR: 'QR Code' };
