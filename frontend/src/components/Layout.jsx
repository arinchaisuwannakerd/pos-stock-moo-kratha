import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, auth } from '../lib/api';

const NAV = [
  { section: 'ขายหน้าร้าน' },
  { to: '/', end: true, ico: '▦', label: 'ผังร้านค้า' },
  { to: '/orders', ico: '☰', label: 'บิลทั้งหมด' },
  { section: 'คลังและเมนู' },
  { to: '/stock', ico: '⬔', label: 'คลังวัตถุดิบ', badge: 'low' },
  { to: '/menu', ico: '⊞', label: 'จัดการเมนู' },
  { section: 'รายงาน' },
  { to: '/reports', ico: '◔', label: 'รายงาน' },
];

export default function Layout() {
  const nav = useNavigate();
  const user = auth.user;
  const [lowCount, setLowCount] = useState(0);

  // ดึงจำนวนวัตถุดิบใกล้หมดมาแสดงเป็น badge และรีเฟรชทุก 60 วินาที
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get('/stock/low')
        .then((r) => alive && setLowCount(r.count))
        .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const logout = () => { auth.clear(); nav('/login'); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-dot">ย</span>
            <span>บ้านน้องโฟค</span>
          </div>
          <div className="brand-sub">POS &amp; Stock · กาญจนบุรี</div>
        </div>

        <nav className="nav">
          {NAV.map((item, i) =>
            item.section ? (
              <div key={i} className="nav-label">{item.section}</div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="ico">{item.ico}</span>
                <span>{item.label}</span>
                {item.badge === 'low' && lowCount > 0 && <span className="nav-badge">{lowCount}</span>}
              </NavLink>
            )
          )}
          <div className="nav-label">ฝั่งลูกค้า</div>
          <a href="/customer/T01" target="_blank" rel="noreferrer">
            <span className="ico">▧</span>
            <span>หน้าลูกค้า (ตัวอย่าง)</span>
          </a>
        </nav>

        <div className="sidebar-foot">
          <div className="row-between">
            <div style={{ minWidth: 0 }}>
              <div className="who" title={user?.full_name}>{user?.full_name ?? '-'}</div>
              <div className="who-role">{user?.role === 'OWNER' ? 'เจ้าของร้าน' : 'พนักงาน'}</div>
            </div>
            <button className="btn btn-sm" onClick={logout}>ออก</button>
          </div>
        </div>
      </aside>

      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}

/** แถบหัวเรื่องของแต่ละหน้า */
export function TopBar({ title, sub, children }) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="topbar-actions">{children}</div>}
    </header>
  );
}
