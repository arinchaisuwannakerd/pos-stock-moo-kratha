import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast, Spinner, Empty, QrImage } from '../../components/ui';
import { baht, qty as fmtQty, timeOnly } from '../../lib/format';

export default function CustomerBill() {
  const { tableNo } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [bill, setBill] = useState(null);
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api.get(`/public/tables/${tableNo}/bill`, { noAuth: true });
      setBill(r.data);
      if (r.data) {
        const q = await api.get(`/public/tables/${tableNo}/qr`, { noAuth: true });
        setQr(q.data);
      }
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);   // อัปเดตยอดเมื่อพนักงานเพิ่มรายการให้
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableNo]);

  async function callBill() {
    setBusy(true);
    try {
      const r = await api.post(`/public/tables/${tableNo}/bill`, null, { noAuth: true });
      toast(r.message, 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="กำลังโหลดบิล…" />;

  return (
    <>
      <div className="cust-top">
        <div className="cust-top-inner">
          <button className="btn btn-sm" onClick={() => nav(`/customer/${tableNo}`)}>‹ เมนู</button>
          <div className="grow center">
            <div className="bold">สรุปรายการและชำระเงิน</div>
            <div className="tiny faint">โต๊ะ {tableNo}</div>
          </div>
          <span style={{ width: 58 }} />
        </div>
      </div>

      <div className="cust-shell">
        <div className="content">
          {!bill ? (
            <Empty icon="🥢">
              ยังไม่มีรายการสั่งอาหาร
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-accent" onClick={() => nav(`/customer/${tableNo}`)}>เลือกเมนู</button>
              </div>
            </Empty>
          ) : (
            <div className="pay-grid">
              <div className="card">
                <div className="card-head">
                  <h2>รายการอาหารของคุณ</h2>
                  <span className="sub">{bill.order_no} · {bill.guest_count} ท่าน</span>
                </div>

                <div className="card-body flush">
                  {groupByRound(bill.items).map(([round, items]) => (
                    <div key={round}>
                      <div className="nav-label" style={{ padding: '10px 16px 4px' }}>
                        {round === 1 ? 'รอบแรก' : `สั่งเพิ่มรอบที่ ${round}`}
                      </div>
                      {items.map((it) => (
                        <div key={it.id} className="line">
                          <div className="line-main">
                            <div className="line-name">{it.name_th}</div>
                            <div className="line-meta">
                              {baht(it.unit_price)} × {fmtQty(it.qty)}
                              {it.note && ` · ${it.note}`}
                            </div>
                          </div>
                          <div className="line-amt">{baht(it.line_total)}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="sum-row"><span>ยอดรวม</span><span>{baht(bill.subtotal)}</span></div>
                  {Number(bill.discount) > 0 && <div className="sum-row"><span>ส่วนลด</span><span>−{baht(bill.discount)}</span></div>}
                  {Number(bill.service_charge) > 0 && <div className="sum-row"><span>ค่าบริการ</span><span>{baht(bill.service_charge)}</span></div>}
                  {Number(bill.vat_amount) > 0 && <div className="sum-row"><span>ภาษีมูลค่าเพิ่ม</span><span>{baht(bill.vat_amount)}</span></div>}
                  <div className="sum-row total"><span>ยอดสุทธิ</span><span>{baht(bill.grand_total)} ฿</span></div>
                  <div className="tiny faint mt">เปิดบิลเมื่อ {timeOnly(bill.opened_at)} น.</div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h2>ชำระเงินด้วย QR Code</h2></div>
                <div className="card-body stack">
                  {qr && (
                    <div className="qr-box">
                      <QrImage payload={qr.qr_payload} />
                      <div className="center">
                        <div className="bold" style={{ fontSize: 22 }}>{baht(qr.amount)} บาท</div>
                        <div className="small muted">{qr.shop_name}</div>
                        <div className="tiny faint">สแกนด้วยแอปธนาคารเพื่อชำระผ่านพร้อมเพย์</div>
                      </div>
                    </div>
                  )}

                  <div className="alert alert-info">
                    <span>ℹ</span>
                    <div>ชำระด้วยเงินสดหรือโอนเงินก็ได้ กรุณาแจ้งพนักงานที่เคาน์เตอร์</div>
                  </div>

                  {bill.status === 'BILLING' ? (
                    <div className="alert alert-warn">
                      <span>✓</span>
                      <div>เรียกพนักงานเช็คบิลแล้ว กรุณารอสักครู่</div>
                    </div>
                  ) : (
                    <button className="btn btn-accent btn-block btn-lg" onClick={callBill} disabled={busy}>
                      {busy ? 'กำลังเรียก…' : 'เรียกพนักงานเช็คบิล'}
                    </button>
                  )}

                  <button className="btn btn-block" onClick={() => nav(`/customer/${tableNo}`)}>
                    สั่งอาหารเพิ่ม
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function groupByRound(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.round_no)) map.set(it.round_no, []);
    map.get(it.round_no).push(it);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}
