import { useState, useEffect } from 'react';
import { api, auth } from '../lib/api';
import { TopBar } from '../components/Layout';
import { Modal, useToast, Spinner, Empty } from '../components/ui';
import { baht, qty as fmtQty, dateTime, STOCK_STATUS, GROUP_LABEL } from '../lib/format';

const MOVE_LABEL = { IN: 'รับเข้า', ISSUE: 'เบิกใช้', SALE: 'ตัดจากการขาย', RETURN: 'คืนสต็อก', ADJUST: 'ปรับยอด' };

export default function StockPage() {
  const toast = useToast();
  const isOwner = auth.user?.role === 'OWNER';

  const [tab, setTab] = useState('stock');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [moves, setMoves] = useState([]);
  const [grp, setGrp] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [docOpen, setDocOpen] = useState(null);      // 'IN' | 'ISSUE'
  const [adjust, setAdjust] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([api.get('/ingredients'), api.get('/stock/movements?limit=120')]);
      setRows(s.data);
      setSummary(s.summary);
      setMoves(m.data);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const shown = grp === 'ALL' ? rows : rows.filter((r) => r.grp === grp);
  const lowRows = rows.filter((r) => r.stock_status === 'LOW' || r.stock_status === 'OUT_OF_STOCK');

  return (
    <>
      <TopBar title="คลังวัตถุดิบ" sub="ปริมาณคงเหลือจริงแบบ Real-time · ตัดสต็อกอัตโนมัติเมื่อบันทึกการขาย">
        <button className="btn" onClick={() => api.downloadCsv('/reports/stock', 'วัตถุดิบคงเหลือ')}>ส่งออก Excel</button>
        <button className="btn" onClick={() => setDocOpen('ISSUE')}>เบิกใช้</button>
        <button className="btn btn-accent" onClick={() => setDocOpen('IN')}>รับเข้าวัตถุดิบ</button>
      </TopBar>

      <div className="content stack">
        {summary && (
          <div className="stats">
            <Stat label="รายการวัตถุดิบ" value={summary.total_items} note="ที่เปิดใช้งานอยู่" />
            <Stat label="ใกล้หมด" value={summary.low} note="ถึงจุดสั่งซื้อขั้นต่ำ" danger={summary.low > 0} />
            <Stat label="หมดสต็อก" value={summary.out_of_stock} note="ต้องรีบสั่งเพิ่ม" danger={summary.out_of_stock > 0} />
            <Stat label="มูลค่าคงคลัง" value={`${baht(summary.stock_value)} ฿`} small note="ตามต้นทุนล่าสุด" />
          </div>
        )}

        {lowRows.length > 0 && (
          <div className="alert alert-warn">
            <span>⚠</span>
            <div>
              <strong>แจ้งเตือนวัตถุดิบใกล้หมด ({lowRows.length} รายการ)</strong>
              <div className="small" style={{ marginTop: 3 }}>
                {lowRows.map((r) => `${r.name_th} เหลือ ${fmtQty(r.qty_on_hand)} ${r.unit}`).join(' · ')}
              </div>
            </div>
          </div>
        )}

        <div className="row wrap">
          <button className={`cat-tab${tab === 'stock' ? ' active' : ''}`} onClick={() => setTab('stock')}>วัตถุดิบคงเหลือ</button>
          <button className={`cat-tab${tab === 'moves' ? ' active' : ''}`} onClick={() => setTab('moves')}>ประวัติการเคลื่อนไหว</button>
        </div>

        {loading ? <Spinner /> : tab === 'stock' ? (
          <div className="card">
            <div className="card-head">
              <h2>วัตถุดิบคงเหลือ</h2>
              <select className="select" style={{ width: 160, marginLeft: 'auto' }} value={grp} onChange={(e) => setGrp(e.target.value)}>
                <option value="ALL">ทุกประเภท</option>
                {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>รหัส</th><th>ชื่อวัตถุดิบ</th><th>ประเภท</th>
                    <th className="num">คงเหลือ</th><th className="num">ขั้นต่ำ</th>
                    <th style={{ width: 120 }}>ระดับสต็อก</th>
                    <th className="num">ต้นทุน/หน่วย</th><th className="num">มูลค่า</th>
                    <th>สถานะ</th>{isOwner && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const st = STOCK_STATUS[r.stock_status];
                    const pct = r.min_qty > 0 ? Math.min((r.qty_on_hand / (r.min_qty * 2)) * 100, 100) : 100;
                    const color = r.stock_status === 'OK' ? 'var(--free)' : r.stock_status === 'WARNING' ? 'var(--billing)' : 'var(--danger)';
                    return (
                      <tr key={r.id}>
                        <td className="tiny faint">{r.sku}</td>
                        <td className="bold">{r.name_th}</td>
                        <td className="small muted">{GROUP_LABEL[r.grp]}</td>
                        <td className="num bold">{fmtQty(r.qty_on_hand)} <span className="tiny faint">{r.unit}</span></td>
                        <td className="num small muted">{fmtQty(r.min_qty)}</td>
                        <td>
                          <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                        </td>
                        <td className="num small">{baht(r.cost_per_unit)}</td>
                        <td className="num">{baht(r.stock_value)}</td>
                        <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                        {isOwner && (
                          <td><button className="btn btn-sm" onClick={() => setAdjust(r)}>ปรับยอด</button></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-head">
              <h2>ประวัติการเคลื่อนไหววัตถุดิบ</h2>
              <span className="sub">{moves.length} รายการล่าสุด</span>
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }}
                onClick={() => api.downloadCsv('/reports/stock-movements?from=2026-01-01&to=2026-12-31', 'การเคลื่อนไหววัตถุดิบ')}>
                ส่งออก Excel
              </button>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>วันที่-เวลา</th><th>วัตถุดิบ</th><th>ประเภทรายการ</th>
                    <th className="num">จำนวน</th><th className="num">คงเหลือหลังทำรายการ</th>
                    <th>เอกสารอ้างอิง</th><th>ผู้ทำรายการ</th><th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.id}>
                      <td className="small">{dateTime(m.created_at)}</td>
                      <td className="bold">{m.name_th}</td>
                      <td>
                        <span className={`pill ${m.qty_change > 0 ? 'pill-free' : 'pill-muted'}`}>
                          {MOVE_LABEL[m.movement_type]}
                        </span>
                      </td>
                      <td className="num bold" style={{ color: m.qty_change > 0 ? 'var(--free)' : 'var(--danger)' }}>
                        {m.qty_change > 0 ? '+' : ''}{fmtQty(m.qty_change)} <span className="tiny faint">{m.unit}</span>
                      </td>
                      <td className="num">{fmtQty(m.balance_after)}</td>
                      <td className="tiny faint">{m.ref_no ?? '-'}</td>
                      <td className="small">{m.created_by_name ?? <span className="faint">ลูกค้าสั่งเอง</span>}</td>
                      <td className="tiny faint">{m.note ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!moves.length && <Empty icon="📦">ยังไม่มีการเคลื่อนไหว</Empty>}
            </div>
          </div>
        )}
      </div>

      {docOpen && <StockDocModal type={docOpen} rows={rows} onClose={() => setDocOpen(null)} onDone={() => { setDocOpen(null); load(); }} />}
      {adjust && <AdjustModal row={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); load(); }} />}
    </>
  );
}

/* ------------------------------- รับเข้า / เบิกใช้วัตถุดิบ (หลายรายการ) */
function StockDocModal({ type, rows, onClose, onDone }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ ingredient_id: '', qty: '', unit_cost: '' }]);
  const [busy, setBusy] = useState(false);

  const isIn = type === 'IN';
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const total = lines.reduce((s, l) => {
    const ing = rows.find((r) => r.id === Number(l.ingredient_id));
    const cost = l.unit_cost !== '' ? Number(l.unit_cost) : Number(ing?.cost_per_unit || 0);
    return s + (Number(l.qty) || 0) * cost;
  }, 0);

  async function save() {
    const payload = lines
      .filter((l) => l.ingredient_id && Number(l.qty) > 0)
      .map((l) => ({
        ingredient_id: Number(l.ingredient_id),
        qty: Number(l.qty),
        ...(l.unit_cost !== '' ? { unit_cost: Number(l.unit_cost) } : {}),
      }));
    if (!payload.length) return toast('กรุณาเลือกวัตถุดิบและระบุจำนวน', 'err');

    setBusy(true);
    try {
      const r = await api.post(isIn ? '/stock/in' : '/stock/issue', {
        ...(isIn ? { supplier } : {}), note, lines: payload,
      });
      toast(r.message, 'ok');
      if (r.data.stock_alerts?.length) {
        toast(`วัตถุดิบใกล้หมด: ${r.data.stock_alerts.map((a) => a.name_th).join(', ')}`, 'err');
      }
      onDone();
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={isIn ? 'บันทึกการรับเข้าวัตถุดิบ (Stock In)' : 'บันทึกการเบิกใช้วัตถุดิบ'}
      onClose={onClose}
      footer={
        <>
          <span className="grow bold">{isIn && `มูลค่ารวม ${baht(total)} บาท`}</span>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-accent" onClick={save} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </>
      }
    >
      <div className="stack">
        {isIn && (
          <div className="field">
            <label>ผู้จำหน่าย / แหล่งที่มา</label>
            <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}
              placeholder="เช่น ตลาดสดเทศบาลกาญจนบุรี" />
          </div>
        )}

        <div className="stack-sm">
          <label className="bold small">รายการวัตถุดิบ</label>
          {lines.map((l, i) => {
            const ing = rows.find((r) => r.id === Number(l.ingredient_id));
            return (
              <div key={i} className="row">
                <select className="select grow" value={l.ingredient_id} onChange={(e) => setLine(i, { ingredient_id: e.target.value })}>
                  <option value="">— เลือกวัตถุดิบ —</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>{r.name_th} (เหลือ {fmtQty(r.qty_on_hand)} {r.unit})</option>
                  ))}
                </select>
                <input className="input" style={{ width: 92 }} type="number" min="0" step="0.001" placeholder="จำนวน"
                  value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <span className="tiny faint" style={{ width: 42 }}>{ing?.unit ?? ''}</span>
                {isIn && (
                  <input className="input" style={{ width: 108 }} type="number" min="0" step="0.01"
                    placeholder={ing ? `ทุน ${ing.cost_per_unit}` : 'ต้นทุน/หน่วย'}
                    value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
                )}
                <button className="btn btn-sm btn-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  disabled={lines.length === 1}>×</button>
              </div>
            );
          })}
          <button className="btn btn-sm" onClick={() => setLines((ls) => [...ls, { ingredient_id: '', qty: '', unit_cost: '' }])}>
            + เพิ่มรายการ
          </button>
        </div>

        <div className="field">
          <label>หมายเหตุ</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------- ปรับยอดตามที่นับได้จริง */
function AdjustModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [counted, setCounted] = useState(String(row.qty_on_hand));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = (Number(counted) || 0) - Number(row.qty_on_hand);

  async function save() {
    setBusy(true);
    try {
      const r = await api.post('/stock/adjust', { ingredient_id: row.id, counted_qty: Number(counted), note });
      toast(r.message, 'ok');
      onDone();
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`ปรับยอด — ${row.name_th}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>บันทึกการปรับยอด</button>
        </>
      }
    >
      <div className="stack">
        <div className="row-between small">
          <span className="muted">ยอดในระบบ</span>
          <span className="bold">{fmtQty(row.qty_on_hand)} {row.unit}</span>
        </div>
        <div className="field">
          <label>ยอดที่นับได้จริง ({row.unit})</label>
          <input className="input" type="number" min="0" step="0.001" value={counted}
            onChange={(e) => setCounted(e.target.value)} autoFocus />
        </div>
        {diff !== 0 && (
          <div className={`alert ${diff > 0 ? 'alert-info' : 'alert-warn'}`}>
            <span>{diff > 0 ? '↑' : '↓'}</span>
            <div>ส่วนต่าง <strong>{diff > 0 ? '+' : ''}{fmtQty(diff)} {row.unit}</strong> จะถูกบันทึกเป็นรายการปรับยอดในบัญชีเดินสะพัด</div>
          </div>
        )}
        <div className="field">
          <label>หมายเหตุ</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น นับสต็อกสิ้นวัน" />
        </div>
      </div>
    </Modal>
  );
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
