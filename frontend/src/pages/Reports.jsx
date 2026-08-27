import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { TopBar } from '../components/Layout';
import { useToast, Spinner, Empty } from '../components/ui';
import { baht, num, todayISO, dateTime, METHOD_LABEL, STOCK_STATUS, qty as fmtQty } from '../lib/format';

const TABS = [
  { key: 'sales', label: 'ยอดขาย' },
  { key: 'menu', label: 'เมนูขายดี' },
  { key: 'stock', label: 'วัตถุดิบคงเหลือ' },
  { key: 'moves', label: 'รับเข้า / เบิกใช้' },
  { key: 'bills', label: 'บิลขาย' },
];

export default function Reports() {
  const toast = useToast();
  const today = todayISO();

  const [tab, setTab] = useState('sales');
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState('day');
  const [dash, setDash] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/dashboard').then((r) => setDash(r.data)).catch((e) => toast(e.message, 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ผูก payload ไว้กับแท็บที่ขอมันเสมอ ป้องกันการ render ตารางของแท็บใหม่
  // ด้วยข้อมูลของแท็บเก่าในจังหวะที่ผลลัพธ์ยังมาไม่ถึง
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPayload(null);
    reportPath(tab, { from, to, group })
      .then((p) => api.get(p))
      .then((res) => alive && setPayload({ tab, res }))
      .catch((e) => alive && toast(e.message, 'err'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, group]);

  async function exportCsv() {
    const p = await reportPath(tab, { from, to, group });
    const names = { sales: 'รายงานยอดขาย', menu: 'เมนูขายดี', stock: 'วัตถุดิบคงเหลือ', moves: 'รับเข้าเบิกใช้', bills: 'บิลขาย' };
    try {
      await api.downloadCsv(p, `${names[tab]}-${from}-ถึง-${to}`);
      toast('ดาวน์โหลดไฟล์ CSV แล้ว เปิดใน MS-Excel ได้เลย', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  return (
    <>
      <TopBar title="รายงาน" sub="ยอดขาย เมนูขายดี วัตถุดิบคงเหลือ และการเคลื่อนไหวสต็อก">
        <button className="btn" onClick={exportCsv}>ส่งออก Excel (CSV)</button>
        <button className="btn btn-primary" onClick={() => window.print()}>พิมพ์ / PDF</button>
      </TopBar>

      <div className="content stack">
        {dash && (
          <div className="stats">
            <Stat label="ยอดขายวันนี้" value={`${baht(dash.today.sales)} ฿`} small
              note={`${num(dash.today.bills)} บิล · ${num(dash.today.guests)} ท่าน`} />
            <Stat label="ยอดขายเดือนนี้" value={`${baht(dash.month.sales)} ฿`} small
              note={`${num(dash.month.bills)} บิล`} />
            <Stat label="เฉลี่ยต่อบิลวันนี้" value={`${baht(dash.today.avg_bill)} ฿`} small
              note="ยอดสุทธิเฉลี่ย" />
            <Stat label="วัตถุดิบใกล้หมด" value={dash.low_stock_count} danger={dash.low_stock_count > 0}
              note={`โต๊ะว่าง ${dash.tables.free}/${dash.tables.total}`} />
          </div>
        )}

        <div className="card no-print">
          <div className="card-body row wrap">
            <div className="cat-tabs" style={{ margin: 0 }}>
              {TABS.map((t) => (
                <button key={t.key} className={`cat-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="row" style={{ marginLeft: 'auto' }}>
              {tab === 'sales' && (
                <select className="select" style={{ width: 128 }} value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="day">รายวัน</option>
                  <option value="week">รายสัปดาห์</option>
                  <option value="month">รายเดือน</option>
                </select>
              )}
              {tab !== 'stock' && (
                <>
                  <input className="input" style={{ width: 148 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <span className="faint">ถึง</span>
                  <input className="input" style={{ width: 148 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </>
              )}
            </div>
          </div>
        </div>

        {loading || payload?.tab !== tab
          ? <Spinner />
          : <ReportBody tab={tab} payload={payload.res} />}
      </div>
    </>
  );
}

function ReportBody({ tab, payload }) {
  if (!payload) return <Empty icon="📊">ไม่มีข้อมูล</Empty>;
  const rows = payload.data ?? [];
  if (!rows.length) return <Empty icon="📊">ไม่พบข้อมูลในช่วงเวลาที่เลือก</Empty>;

  if (tab === 'sales') {
    const max = Math.max(...rows.map((r) => Number(r.grand_total)));
    return (
      <div className="card">
        <div className="card-head">
          <h2>รายงานยอดขาย</h2>
          <span className="sub">
            รวม {num(payload.totals.bill_count)} บิล · {num(payload.totals.guest_count)} ท่าน · {baht(payload.totals.grand_total)} บาท
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>ช่วงเวลา</th><th style={{ width: 180 }}>สัดส่วน</th>
                <th className="num">บิล</th><th className="num">ลูกค้า</th>
                <th className="num">ยอดรวม</th><th className="num">ส่วนลด</th>
                <th className="num">ยอดสุทธิ</th><th className="num">เฉลี่ย/บิล</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period_start}>
                  <td className="bold">{r.period_label}</td>
                  <td>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(r.grand_total / max) * 100}%`, background: 'var(--accent)' }} />
                    </div>
                  </td>
                  <td className="num">{num(r.bill_count)}</td>
                  <td className="num">{num(r.guest_count)}</td>
                  <td className="num">{baht(r.subtotal)}</td>
                  <td className="num">{baht(r.discount)}</td>
                  <td className="num bold">{baht(r.grand_total)}</td>
                  <td className="num small muted">{baht(r.avg_bill)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (tab === 'menu') {
    const max = Math.max(...rows.map((r) => Number(r.total_qty)));
    return (
      <div className="card">
        <div className="card-head"><h2>อันดับเมนูขายดี</h2><span className="sub">{rows.length} รายการ</span></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 56 }}>อันดับ</th><th>เมนู</th><th>หมวดหมู่</th>
                <th style={{ width: 170 }}>สัดส่วน</th>
                <th className="num">ขายได้</th><th className="num">จำนวนบิล</th><th className="num">ยอดขาย</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td>
                    <span className={`pill ${r.rank <= 3 ? 'pill-billing' : 'pill-muted'}`} style={{ minWidth: 26, justifyContent: 'center' }}>
                      {r.rank}
                    </span>
                  </td>
                  <td className="bold">{r.name_th}</td>
                  <td className="small muted">{r.category_name}</td>
                  <td>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(r.total_qty / max) * 100}%`, background: 'var(--accent)' }} />
                    </div>
                  </td>
                  <td className="num bold">{num(r.total_qty)}</td>
                  <td className="num small">{num(r.bill_count)}</td>
                  <td className="num">{baht(r.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (tab === 'stock') {
    return (
      <div className="card">
        <div className="card-head">
          <h2>รายงานวัตถุดิบคงเหลือ</h2>
          <span className="sub">
            มูลค่ารวม {baht(payload.total_value)} บาท · ใกล้หมด {payload.low_count} · หมด {payload.out_count}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อวัตถุดิบ</th><th>ประเภท</th>
                <th className="num">คงเหลือ</th><th className="num">ขั้นต่ำ</th>
                <th className="num">ต้นทุน/หน่วย</th><th className="num">มูลค่า</th><th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className="tiny faint">{r.sku}</td>
                  <td className="bold">{r.name_th}</td>
                  <td className="small muted">{r.group_name}</td>
                  <td className="num bold">{fmtQty(r.qty_on_hand)} <span className="tiny faint">{r.unit}</span></td>
                  <td className="num small muted">{fmtQty(r.min_qty)}</td>
                  <td className="num small">{baht(r.cost_per_unit)}</td>
                  <td className="num">{baht(r.stock_value)}</td>
                  <td><span className={`pill ${STOCK_STATUS[r.stock_status].cls}`}>{r.status_label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (tab === 'moves') {
    return (
      <div className="card">
        <div className="card-head">
          <h2>รายงานการรับเข้าและเบิกใช้วัตถุดิบ</h2>
          <span className="sub">{rows.length} รายการ · มูลค่ารับเข้า {baht(payload.summary?.in_value ?? 0)} บาท</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>วันที่-เวลา</th><th>วัตถุดิบ</th><th>ประเภท</th>
                <th className="num">จำนวน</th><th className="num">คงเหลือ</th>
                <th className="num">มูลค่า</th><th>เอกสาร</th><th>ผู้ทำรายการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="small">{r.moved_at}</td>
                  <td className="bold">{r.name_th}</td>
                  <td><span className={`pill ${r.qty_change > 0 ? 'pill-free' : 'pill-muted'}`}>{r.type_label}</span></td>
                  <td className="num bold" style={{ color: r.qty_change > 0 ? 'var(--free)' : 'var(--danger)' }}>
                    {r.qty_change > 0 ? '+' : ''}{fmtQty(r.qty_change)} <span className="tiny faint">{r.unit}</span>
                  </td>
                  <td className="num">{fmtQty(r.balance_after)}</td>
                  <td className="num small">{baht(r.value)}</td>
                  <td className="tiny faint">{r.ref_no ?? '-'}</td>
                  <td className="small">{r.created_by_name ?? <span className="faint">ลูกค้าสั่งเอง</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // bills
  return (
    <div className="card">
      <div className="card-head"><h2>รายงานบิลขาย</h2><span className="sub">{rows.length} บิล</span></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>เลขที่บิล</th><th>โต๊ะ</th><th>เปิดบิล</th><th>ปิดบิล</th>
              <th className="num">ลูกค้า</th><th className="num">ยอดรวม</th><th className="num">ส่วนลด</th>
              <th className="num">ยอดสุทธิ</th><th>ช่องทาง</th><th>พนักงาน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order_no}>
                <td className="bold">{r.order_no}</td>
                <td>{r.table_no}</td>
                <td className="small">{r.opened}</td>
                <td className="small">{r.closed}</td>
                <td className="num">{r.guest_count}</td>
                <td className="num">{baht(r.subtotal)}</td>
                <td className="num">{baht(r.discount)}</td>
                <td className="num bold">{baht(r.grand_total)}</td>
                <td className="small">{(r.methods || '').split(', ').map((m) => METHOD_LABEL[m] ?? m).join(', ')}</td>
                <td className="small muted">{r.cashier_name ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function reportPath(tab, { from, to, group }) {
  const range = `from=${from}&to=${to}`;
  switch (tab) {
    case 'sales': return `/reports/sales?group=${group}&${range}`;
    case 'menu':  return `/reports/top-menu?${range}&limit=25`;
    case 'stock': return '/reports/stock';
    case 'moves': return `/reports/stock-movements?${range}`;
    default:      return `/reports/bills?${range}`;
  }
}

function firstOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function Stat({ label, value, note, small, danger }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${small ? ' sm' : ''}`} style={danger ? { color: 'var(--danger)' } : undefined}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
