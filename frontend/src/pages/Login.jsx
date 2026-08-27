import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, auth } from '../lib/api';

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('owner123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/login', { username, password }, { noAuth: true });
      auth.save(r.token, r.user);
      nav('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <div className="login-logo">ย</div>
          <h1>ร้านย่างให้หมูกระทะ บ้านน้องโฟค</h1>
          <p>ระบบขายหน้าร้านและจัดการสต็อก · กาญจนบุรี</p>
        </div>

        <form className="card" onSubmit={submit}>
          <div className="card-body stack">
            {error && <div className="alert alert-danger"><span>⚠</span><span>{error}</span></div>}

            <div className="field">
              <label htmlFor="u">ชื่อผู้ใช้</label>
              <input id="u" className="input" value={username} autoFocus
                onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>

            <div className="field">
              <label htmlFor="p">รหัสผ่าน</label>
              <input id="p" className="input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>

            <button className="btn btn-accent btn-block btn-lg" disabled={busy || !username || !password}>
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>

            <div className="hint-box">
              บัญชีทดสอบ — เจ้าของร้าน <code>owner</code> / <code>owner123</code>
              <br />พนักงาน <code>staff1</code> / <code>staff123</code>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
