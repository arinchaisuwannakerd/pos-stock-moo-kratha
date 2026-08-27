import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TopBar } from '../components/Layout';
import { useToast, Spinner, Empty } from '../components/ui';
import { baht, num, dateTime, todayISO } from '../lib/format';

const STATUS = {
  OPEN:    { label: 'กำลังใช้งาน', cls: 'pill-busy' },
  BILLING: { label: 'รอชำระเงิน',  cls: 'pill-billing' },
  PAID:    { label: 'ชำระแล้ว',    cls: 'pill-free' },
  VOID:    { label: 'ยกเลิก',      cls: 'pill-muted' },
};

export default function OrderList() {
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ from, to, limit: '200' });
    if (status !== 'ALL') q.set('status', status);
    api.get(`/orders?${q}`)
      .then((r) => setRows(r.data))
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, from, to]);

  const paid = rows.filter((r) => r.status === 'PAID');
  const total = paid.reduce((s, r) => s + Number(r.grand_total), 0);

  return (
    <>
      <TopBar title="บิลทั้งหมด" sub="ค้นหาและตรวจสอบบิลย้อนหลัง">
        <input className="input" style={{ width: 148 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="faint">ถึง</span>
        <input className="input" style={{ width: 148 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </TopBar>

      <div className="content stack">
        <div className="stats">
          <Stat label="บิลทั้งหมด" value={num(rows.length)} note="ในช่วงที่เลือก" />
          <Stat label="ชำระแล้ว" value={num(paid.length)} note="ปิดบิลเรียบร้อย" />
          <Stat label="ยอดขายรวม" value={`${baht(total)} ฿`} small note="เฉพาะบิลที่ชำระแล้ว" />
          <Stat label="ยังเปิดอยู่" value={num(rows.filter((r) => r.status === 'OPEN' || r.status === 'BILLING').length)} note="รอปิดบิล" />
        </div>

        <div className="cat-tabs">
          {[['ALL', 'ทั้งหมด'], ['OPEN', 'กำลังใช้งาน'], ['BILLING', 'รอชำระเงิน'], ['PAID', 'ชำระแล้ว'], ['VOID', 'ยกเลิก']].map(([k, l]) => (
            <button key={k} className={`cat-tab${status === k ? ' active' : ''}`} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>

        {loading ? <Spinner /> : !rows.length ? <Empty icon="🧾">ไม่พบบิลในช่วงเวลาที่เลือก</Empty> : (
          <div className="card">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เลขที่บิล</th><th>โต๊ะ</th><th>เปิดบิล</th><th>ปิดบิล</th>
                    <th className="num">ลูกค้า</th><th className="num">รายการ</th>
                    <th className="num">ยอดสุทธิ</th><th>ช่องทาง</th><th>สถานะ</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="bold">{r.order_no}</td>
                      <td>{r.table_no}</td>
                      <td className="small">{dateTime(r.opened_at)}</td>
                      <td className="small">{r.closed_at ? dateTime(r.closed_at) : <span className="faint">—</span>}</td>
                      <td className="num">{r.guest_count}</td>
                      <td className="num">{r.item_lines}</td>
                      <td className="num bold">{baht(r.grand_total)}</td>
                      <td className="small muted">{r.channel === 'CUSTOMER' ? 'ลูกค้าสั่งเอง' : r.opened_by_name ?? 'พนักงาน'}</td>
                      <td><span className={`pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                      <td>
                        <button className="btn btn-sm"
                          onClick={() => nav(r.status === 'PAID' ? `/receipt/${r.id}` : `/order/${r.id}`)}>
                          {r.status === 'PAID' ? 'ใบเสร็จ' : 'เปิดบิล'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, note, small }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${small ? ' sm' : ''}`}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
