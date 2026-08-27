import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast, Spinner, Empty } from '../../components/ui';
import { baht } from '../../lib/format';

export default function CustomerMenu() {
  const { tableNo } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [table, setTable] = useState(null);
  const [cat, setCat] = useState('ALL');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [m, t] = await Promise.all([
        api.get('/public/menu', { noAuth: true }),
        api.get(`/public/tables/${tableNo}`, { noAuth: true }),
      ]);
      setMenu(m.data);
      setCategories(m.categories);
      setTable(t.data);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tableNo]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter((m) => (cat === 'ALL' || m.category_code === cat) && (!q || m.name_th.toLowerCase().includes(q)));
  }, [menu, cat, search]);

  const lines = Object.entries(cart)
    .map(([id, q]) => ({ item: menu.find((m) => m.id === Number(id)), qty: q }))
    .filter((l) => l.item);
  const total = lines.reduce((s, l) => s + Number(l.item.price) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  const add = (m) => setCart((c) => ({ ...c, [m.id]: (c[m.id] || 0) + 1 }));
  const setQty = (id, q) =>
    setCart((c) => {
      const n = { ...c };
      if (q <= 0) delete n[id]; else n[id] = q;
      return n;
    });

  async function submit() {
    if (!lines.length) return;
    setBusy(true);
    try {
      const r = await api.post(`/public/tables/${tableNo}/order`,
        { items: lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })) },
        { noAuth: true });
      toast(r.message, 'ok');
      setCart({});
      nav(`/customer/${tableNo}/bill`);
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="กำลังโหลดเมนู…" />;

  return (
    <>
      <div className="cust-top">
        <div className="cust-top-inner">
          <div className="brand-dot">ย</div>
          <div className="grow">
            <div className="bold">ร้านย่างให้หมูกระทะ บ้านน้องโฟค</div>
            <div className="tiny faint">
              โต๊ะ {tableNo}
              {table?.order_no && ` · บิล ${table.order_no}`}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => nav(`/customer/${tableNo}/bill`)}>ดูบิล</button>
        </div>
      </div>

      <div className="cust-shell">
        <div className="content stack">
          <input className="input" placeholder="ค้นหาเมนู…" value={search} onChange={(e) => setSearch(e.target.value)} />

          <div className="cat-tabs">
            <button className={`cat-tab${cat === 'ALL' ? ' active' : ''}`} onClick={() => setCat('ALL')}>ทั้งหมด</button>
            {categories.map((c) => (
              <button key={c.id} className={`cat-tab${cat === c.code ? ' active' : ''}`} onClick={() => setCat(c.code)}>
                {c.name_th}
              </button>
            ))}
          </div>

          {!shown.length ? <Empty icon="🔍">ไม่พบเมนูที่ค้นหา</Empty> : (
            <div className="menu-grid">
              {shown.map((m) => {
                const inCart = cart[m.id] || 0;
                return (
                  <div key={m.id} className="menu-card" style={m.sold_out ? { opacity: .5 } : undefined}>
                    <div className="menu-name">{m.name_th}</div>
                    {m.description && <div className="menu-desc">{m.description}</div>}
                    <div className="menu-foot">
                      <span className="menu-price">{baht(m.price)}</span>
                      {m.sold_out ? (
                        <span className="pill pill-danger">หมด</span>
                      ) : inCart > 0 ? (
                        <div className="qty-box">
                          <button className="qty-btn" onClick={() => setQty(m.id, inCart - 1)}>−</button>
                          <span className="qty-num">{inCart}</span>
                          <button className="qty-btn" onClick={() => setQty(m.id, inCart + 1)}>+</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-accent" onClick={() => add(m)}>เพิ่ม</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {count > 0 && (
        <div className="cust-cart">
          <div className="cust-cart-inner">
            <div className="grow">
              <div className="bold">{count} รายการ</div>
              <div className="tiny faint">แตะเพื่อส่งออเดอร์ไปที่ครัว</div>
            </div>
            <div className="bold" style={{ fontSize: 19 }}>{baht(total)} ฿</div>
            <button className="btn btn-accent btn-lg" onClick={submit} disabled={busy}>
              {busy ? 'กำลังส่ง…' : 'สั่งอาหาร'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
