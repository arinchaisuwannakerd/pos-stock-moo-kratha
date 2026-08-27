import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TopBar } from '../components/Layout';
import { useToast, Spinner } from '../components/ui';
import { baht, qty as fmtQty, dateTime, METHOD_LABEL } from '../lib/format';

export default function Receipt() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [r, setR] = useState(null);

  useEffect(() => {
    api.get(`/payments/receipt/${id}`).then((res) => setR(res.data)).catch((e) => toast(e.message, 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!r) return <><TopBar title="ใบเสร็จรับเงิน" /><Spinner /></>;

  return (
    <>
      <TopBar title="ใบเสร็จรับเงิน" sub={`${r.order_no} · โต๊ะ ${r.table_no}`}>
        <button className="btn" onClick={() => nav('/')}>กลับผังร้าน</button>
        <button className="btn btn-primary" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button>
      </TopBar>

      <div className="content">
        <div className="receipt">
          <div className="receipt-center">
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.shop.name}</div>
            <div>{r.shop.branch}</div>
            <div className="tiny">{r.shop.address}</div>
            <div className="tiny">โทร. {r.shop.phone}</div>
            {r.shop.tax_id && <div className="tiny">เลขประจำตัวผู้เสียภาษี {r.shop.tax_id}</div>}
          </div>

          <hr />

          <div className="receipt-row"><span>เลขที่ใบเสร็จ</span><span className="bold">{r.receipt_no ?? '-'}</span></div>
          <div className="receipt-row"><span>เลขที่บิล</span><span>{r.order_no}</span></div>
          <div className="receipt-row"><span>โต๊ะ</span><span>{r.table_no} · {r.guest_count} ท่าน</span></div>
          <div className="receipt-row"><span>วันที่</span><span>{dateTime(r.closed_at ?? r.opened_at)}</span></div>
          {r.cashier && <div className="receipt-row"><span>พนักงาน</span><span>{r.cashier}</span></div>}

          <hr />

          {r.items.map((it, i) => (
            <div key={i} style={{ padding: '3px 0' }}>
              <div className="receipt-item">
                <span>{it.name_th}</span>
                <span className="num">{baht(it.line_total)}</span>
              </div>
              <div className="tiny faint">{fmtQty(it.qty)} × {baht(it.unit_price)}</div>
            </div>
          ))}

          <hr />

          <div className="receipt-row"><span>ยอดรวม</span><span className="num">{baht(r.subtotal)}</span></div>
          {Number(r.discount) > 0 && (
            <div className="receipt-row"><span>ส่วนลด</span><span className="num">−{baht(r.discount)}</span></div>
          )}
          {Number(r.service_charge) > 0 && (
            <div className="receipt-row"><span>ค่าบริการ</span><span className="num">{baht(r.service_charge)}</span></div>
          )}
          {Number(r.vat_amount) > 0 && (
            <div className="receipt-row">
              <span>ภาษีมูลค่าเพิ่ม {r.vat_rate}%{r.vat_included ? ' (รวมในราคา)' : ''}</span>
              <span className="num">{baht(r.vat_amount)}</span>
            </div>
          )}

          <hr />
          <div className="receipt-row big"><span>ยอดสุทธิ</span><span className="num">{baht(r.grand_total)}</span></div>
          <hr />

          {r.payments.map((p, i) => (
            <div key={i}>
              <div className="receipt-row"><span>ชำระโดย {METHOD_LABEL[p.method]}</span><span className="num">{baht(p.amount)}</span></div>
              {p.received != null && (
                <>
                  <div className="receipt-row"><span>รับเงิน</span><span className="num">{baht(p.received)}</span></div>
                  <div className="receipt-row"><span>เงินทอน</span><span className="num">{baht(p.change_amount)}</span></div>
                </>
              )}
              {p.reference_no && <div className="receipt-row tiny"><span>อ้างอิง</span><span>{p.reference_no}</span></div>}
            </div>
          ))}

          <hr />
          <div className="receipt-center tiny">
            <div>ขอบคุณที่ใช้บริการ</div>
            <div>แล้วพบกันใหม่นะครับ/ค่ะ</div>
          </div>
        </div>
      </div>
    </>
  );
}
