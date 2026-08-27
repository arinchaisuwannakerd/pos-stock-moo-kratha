import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TopBar } from '../components/Layout';
import { useToast, Spinner, Empty, QrImage } from '../components/ui';
import { baht, qty as fmtQty, METHOD_LABEL } from '../lib/format';

const QUICK = [100, 200, 500, 1000];

export default function Payment() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState(null);
  const [method, setMethod] = useState('CASH');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/orders/${id}`);
        setOrder(r.data);
        // เรียกเช็คบิลอัตโนมัติ เพื่อให้โต๊ะแสดงสถานะ "รอชำระเงิน" บนผังร้าน
        // ถ้ามีเครื่องอื่นกดเช็คบิลไปแล้ว (409) ให้ถือว่าสำเร็จและอ่านสถานะล่าสุดแทน
        if (r.data.status === 'OPEN') {
          try {
            const b = await api.post(`/orders/${id}/bill`);
            setOrder(b.data);
          } catch (err) {
            if (err.status !== 409) throw err;
            setOrder((await api.get(`/orders/${id}`)).data);
          }
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ดึง QR พร้อมเพย์เมื่อเลือกวิธีชำระเป็น QR
  useEffect(() => {
    if (method !== 'QR' || !order || order.status === 'PAID') return;
    api.get(`/payments/qr/${id}`).then((r) => setQr(r.data)).catch((e) => toast(e.message, 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, order?.grand_total]);

  if (!order) return <><TopBar title="ชำระเงิน" /><Spinner /></>;
  if (order.status === 'PAID') {
    return (
      <>
        <TopBar title="ชำระเงิน" />
        <div className="content">
          <Empty icon="✅">
            บิล {order.order_no} ชำระเงินเรียบร้อยแล้ว
            <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => nav(`/receipt/${id}`)}>ดูใบเสร็จ</button>
              <button className="btn" onClick={() => nav('/')}>กลับผังร้าน</button>
            </div>
          </Empty>
        </div>
      </>
    );
  }

  const total = Number(order.outstanding || order.grand_total);
  const receivedNum = Number(received) || 0;
  const change = method === 'CASH' && receivedNum > 0 ? receivedNum - total : 0;
  const canPay = method !== 'CASH' || received === '' || receivedNum >= total;

  const press = (k) => {
    if (k === 'C') return setReceived('');
    if (k === '⌫') return setReceived((v) => v.slice(0, -1));
    if (k === '.' && received.includes('.')) return;
    setReceived((v) => (v + k).replace(/^0(?=\d)/, ''));
  };

  async function pay() {
    setBusy(true);
    try {
      const body = { order_id: Number(id), method };
      if (method === 'CASH' && receivedNum > 0) body.received = receivedNum;
      if (method !== 'CASH' && reference) body.reference_no = reference;

      const r = await api.post('/payments', body);
      toast(r.message, 'ok');
      nav(`/receipt/${id}`);
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  }

  const liveItems = order.items.filter((i) => i.status !== 'CANCELLED');

  return (
    <>
      <TopBar title={`ชำระเงิน · โต๊ะ ${order.table_no}`} sub={`${order.order_no} · ${order.guest_count} ท่าน`}>
        <button className="btn" onClick={() => nav(`/order/${id}`)}>กลับไปแก้ไขบิล</button>
      </TopBar>

      <div className="content">
        <div className="pay-grid">
          {/* ------------------------------------------------- สรุปรายการ */}
          <div className="card">
            <div className="card-head">
              <h2>สรุปรายการอาหาร</h2>
              <span className="sub">{liveItems.length} รายการ</span>
            </div>
            <div className="card-body flush">
              {liveItems.map((it) => (
                <div key={it.id} className="line">
                  <div className="line-main">
                    <div className="line-name">{it.name_th}</div>
                    <div className="line-meta">{baht(it.unit_price)} × {fmtQty(it.qty)}</div>
                  </div>
                  <div className="line-amt">{baht(it.line_total)}</div>
                </div>
              ))}
            </div>
            <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="sum-row"><span>ยอดรวม</span><span>{baht(order.subtotal)}</span></div>
              {Number(order.discount) > 0 && <div className="sum-row"><span>ส่วนลด</span><span>−{baht(order.discount)}</span></div>}
              {Number(order.service_charge) > 0 && <div className="sum-row"><span>ค่าบริการ</span><span>{baht(order.service_charge)}</span></div>}
              {Number(order.vat_amount) > 0 && <div className="sum-row"><span>ภาษีมูลค่าเพิ่ม</span><span>{baht(order.vat_amount)}</span></div>}
              <div className="sum-row total"><span>ยอดที่ต้องชำระ</span><span>{baht(total)} ฿</span></div>
            </div>
          </div>

          {/* ------------------------------------------------- ช่องทางชำระ */}
          <div className="stack">
            <div className="card">
              <div className="card-head"><h2>ช่องทางการชำระเงิน</h2></div>
              <div className="card-body stack">
                <div className="method-row">
                  {['CASH', 'TRANSFER', 'QR'].map((m) => (
                    <button key={m} className={`method${method === m ? ' active' : ''}`} onClick={() => setMethod(m)}>
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>

                {method === 'CASH' && (
                  <>
                    <div className="field">
                      <label>รับเงินมา (เว้นว่าง = รับพอดี)</label>
                      <div className="amount-display">{received || '0'}</div>
                    </div>

                    <div className="quick-cash">
                      {QUICK.map((v) => (
                        <button key={v} className="btn btn-sm" onClick={() => setReceived(String(v))}>{v}</button>
                      ))}
                    </div>

                    <div className="keypad">
                      {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => (
                        <button key={k} onClick={() => press(k)}>{k}</button>
                      ))}
                    </div>

                    <div className="row-between">
                      <button className="btn btn-sm" onClick={() => press('C')}>ล้าง</button>
                      <button className="btn btn-sm" onClick={() => setReceived(String(total))}>รับพอดี {baht(total)}</button>
                    </div>

                    {receivedNum > 0 && (
                      <div className={`alert ${change >= 0 ? 'alert-info' : 'alert-danger'}`}>
                        <span>{change >= 0 ? '💵' : '⚠'}</span>
                        <div>
                          {change >= 0
                            ? <>เงินทอน <strong>{baht(change)} บาท</strong></>
                            : <>เงินขาดอีก <strong>{baht(-change)} บาท</strong></>}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {method === 'TRANSFER' && (
                  <div className="field">
                    <label>เลขที่อ้างอิงการโอน</label>
                    <input className="input" placeholder="เช่น TXN-20260827-0001"
                      value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                )}

                {method === 'QR' && qr && (
                  <div className="qr-box">
                    <QrImage payload={qr.qr_payload} />
                    <div className="center">
                      <div className="bold" style={{ fontSize: 20 }}>{baht(qr.amount)} บาท</div>
                      <div className="small muted">{qr.shop_name}</div>
                      <div className="tiny faint">พร้อมเพย์ {qr.promptpay_id}</div>
                    </div>
                    <div className="field" style={{ width: '100%' }}>
                      <label>เลขที่อ้างอิง (ถ้ามี)</label>
                      <input className="input" placeholder="เลขอ้างอิงจากสลิป"
                        value={reference} onChange={(e) => setReference(e.target.value)} />
                    </div>
                  </div>
                )}

                <button className="btn btn-accent btn-block btn-lg" onClick={pay} disabled={busy || !canPay}>
                  {busy ? 'กำลังบันทึก…' : `รับชำระ ${baht(total)} บาท`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
