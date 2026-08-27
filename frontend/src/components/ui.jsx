import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import QR from 'qrcode';

/* ------------------------------------------------------------------ toast */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, message, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'err' ? 5200 : 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ modal */
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x-btn" onClick={onClose} aria-label="ปิด">&times;</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- QR image */
export function QrImage({ payload, size = 240 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!payload) return;
    QR.toDataURL(payload, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [payload, size]);

  if (!src) return <div className="empty" style={{ width: size, height: size }}>กำลังสร้าง QR…</div>;
  return <img src={src} alt="QR พร้อมเพย์" style={{ width: size, height: size }} />;
}

/* ---------------------------------------------------------------- helpers */
export function Empty({ icon = '🍽️', children }) {
  return (
    <div className="empty">
      <div className="empty-big">{icon}</div>
      {children}
    </div>
  );
}

export function Spinner({ label = 'กำลังโหลด…' }) {
  return <div className="empty">{label}</div>;
}

/** เรียก API แล้วคืน { data, loading, error, reload } */
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((d) => alive.current && setState({ data: d, loading: false, error: null }))
      .catch((e) => alive.current && setState({ data: null, loading: false, error: e }));
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
