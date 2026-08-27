import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TopBar } from '../components/Layout';
import { Modal, useToast, Spinner } from '../components/ui';
import { baht, num, since, TABLE_STATUS } from '../lib/format';

export default function FloorPlan() {
  const nav = useNavigate();
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);   // โต๊ะที่กำลังจะเปิดบิล
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api.get('/tables');
      setTables(r.data);
      setSummary(r.summary);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }

  // รีเฟรชผังอัตโนมัติทุก 15 วินาที ให้เห็นสถานะโต๊ะแบบใกล้เคียง real-time
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clickTable(t) {
    if (t.order_id) nav(`/order/${t.order_id}`);
    else { setOpening(t); setGuests(t.seats); }
  }

  async function openBill() {
    setBusy(true);
    try {
      const r = await api.post('/orders', { table_id: opening.id, guest_count: guests });
      toast(`เปิดบิล ${r.order.order_no} โต๊ะ ${opening.table_no}`, 'ok');
      nav(`/order/${r.order.id}`);
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  }

  const shown = filter === 'ALL' ? tables : tables.filter((t) => t.status === filter);

  return (
    <>
      <TopBar title="ผังร้านค้า" sub="สถานะโต๊ะทั้ง 20 โต๊ะ · อัปเดตอัตโนมัติทุก 15 วินาที">
        <button className="btn" onClick={load}>รีเฟรช</button>
      </TopBar>

      <div className="content stack">
        {summary && (
          <div className="stats">
            <Stat label="โต๊ะว่าง" value={summary.FREE} note={`จากทั้งหมด ${summary.total} โต๊ะ`} />
            <Stat label="กำลังใช้งาน" value={summary.OCCUPIED} note="กำลังรับประทาน" />
            <Stat label="รอชำระเงิน" value={summary.BILLING} note="เรียกเช็คบิลแล้ว" />
            <Stat label="ยอดค้างชำระ" value={`${baht(summary.open_amount)} ฿`} small note="รวมทุกโต๊ะที่เปิดอยู่" />
          </div>
        )}

        <div className="row wrap">
          {[
            ['ALL', `ทั้งหมด (${tables.length})`],
            ['FREE', `ว่าง (${summary?.FREE ?? 0})`],
            ['OCCUPIED', `กำลังใช้งาน (${summary?.OCCUPIED ?? 0})`],
            ['BILLING', `รอชำระเงิน (${summary?.BILLING ?? 0})`],
          ].map(([k, label]) => (
            <button key={k} className={`cat-tab${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <Spinner label="กำลังโหลดผังโต๊ะ…" />
        ) : (
          <div className="floor-grid">
            {shown.map((t) => {
              const st = TABLE_STATUS[t.status];
              return (
                <button key={t.id} className={`table-card ${st.card}`} onClick={() => clickTable(t)}>
                  <div className="table-head">
                    <div>
                      <div className="table-no">{t.table_no}</div>
                      <div className="table-zone">{t.zone} · {t.seats} ที่นั่ง</div>
                    </div>
                    <span className={`pill ${st.cls}`}><i className="dot" />{st.label}</span>
                  </div>

                  <div className="table-foot">
                    {t.order_id ? (
                      <>
                        <div>
                          <div className="table-total">{baht(t.current_total)} ฿</div>
                          <div className="table-meta">{num(t.item_count)} รายการ · {t.guest_count} ท่าน</div>
                        </div>
                        <div className="table-meta">{since(t.opened_at)}</div>
                      </>
                    ) : (
                      <div className="table-meta">แตะเพื่อเปิดบิลใหม่</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {opening && (
        <Modal
          title={`เปิดบิลโต๊ะ ${opening.table_no}`}
          onClose={() => !busy && setOpening(null)}
          footer={
            <>
              <button className="btn" onClick={() => setOpening(null)} disabled={busy}>ยกเลิก</button>
              <button className="btn btn-accent" onClick={openBill} disabled={busy}>
                {busy ? 'กำลังเปิดบิล…' : 'เปิดบิลและสั่งอาหาร'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="muted small">{opening.zone} · รองรับ {opening.seats} ที่นั่ง</div>
            <div className="field">
              <label>จำนวนลูกค้า</label>
              <div className="row">
                <button className="qty-btn" onClick={() => setGuests((g) => Math.max(1, g - 1))}>−</button>
                <span className="qty-num" style={{ fontSize: 19, minWidth: 44 }}>{guests}</span>
                <button className="qty-btn" onClick={() => setGuests((g) => g + 1)}>+</button>
                <span className="muted small">ท่าน</span>
              </div>
            </div>
          </div>
        </Modal>
      )}
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
