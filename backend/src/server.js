import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { pool, query } from './db.js';
import { wrap } from './utils.js';
import { notFound, errorHandler } from './middleware/error.js';
import { authRequired, requireRole } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import tableRoutes from './routes/tables.js';
import menuRoutes from './routes/menu.js';
import ingredientRoutes from './routes/ingredients.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import stockRoutes from './routes/stock.js';
import reportRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

/** GET /api/health — ใช้ทดสอบว่า API และฐานข้อมูลพร้อมใช้งาน */
app.get('/api/health', wrap(async (_req, res) => {
  const { rows } = await query('SELECT now() AS server_time, version() AS pg_version');
  res.json({
    ok: true,
    service: 'POS & Stock API — ร้านย่างให้หมูกระทะ บ้านน้องโฟค กาญจนบุรี',
    version: '1.0.0',
    database: { connected: true, server_time: rows[0].server_time, version: rows[0].pg_version.split(',')[0] },
  });
}));

/** GET /api/settings — ค่าตั้งค่าร้าน */
app.get('/api/settings', authRequired, wrap(async (_req, res) => {
  const { rows } = await query('SELECT key, value, description FROM settings ORDER BY key');
  res.json({ ok: true, data: Object.fromEntries(rows.map((r) => [r.key, r.value])), raw: rows });
}));

/** PATCH /api/settings — แก้ค่าตั้งค่าร้าน (เจ้าของร้านเท่านั้น) */
app.patch('/api/settings', authRequired, requireRole('OWNER'), wrap(async (req, res) => {
  const entries = Object.entries(req.body || {});
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]
    );
  }
  const { rows } = await query('SELECT key, value FROM settings ORDER BY key');
  res.json({ ok: true, updated: entries.length, data: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
}));

app.use('/api/auth',        authRoutes);
app.use('/api/tables',      tableRoutes);
app.use('/api/menu',        menuRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/orders',      orderRoutes);
app.use('/api/payments',    paymentRoutes);
app.use('/api/stock',       stockRoutes);
app.use('/api/reports',     reportRoutes);
app.use('/api/public',      publicRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`\n  POS & Stock API`);
  console.log(`  ร้านย่างให้หมูกระทะ บ้านน้องโฟค กาญจนบุรี`);
  console.log(`  http://localhost:${PORT}/api/health\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[${sig}] ปิดเซิร์ฟเวอร์...`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}

export default app;
