import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './lib/api';
import { ToastProvider } from './components/ui';
import Layout from './components/Layout';

import Login from './pages/Login';
import FloorPlan from './pages/FloorPlan';
import OrderScreen from './pages/OrderScreen';
import OrderList from './pages/OrderList';
import Payment from './pages/Payment';
import Receipt from './pages/Receipt';
import MenuManage from './pages/MenuManage';
import StockPage from './pages/StockPage';
import Reports from './pages/Reports';
import CustomerMenu from './pages/customer/CustomerMenu';
import CustomerBill from './pages/customer/CustomerBill';

/** กันไม่ให้เข้าหน้าฝั่งร้านค้าถ้ายังไม่ได้ล็อกอิน */
function Protected({ children }) {
  return auth.token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* ---------------------------------------- ฝั่งลูกค้า (ไม่ต้องล็อกอิน) */}
          <Route path="/customer/:tableNo" element={<CustomerMenu />} />
          <Route path="/customer/:tableNo/bill" element={<CustomerBill />} />

          {/* ------------------------------------------------------ ฝั่งร้านค้า */}
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<FloorPlan />} />
            <Route path="/orders" element={<OrderList />} />
            <Route path="/order/:id" element={<OrderScreen />} />
            <Route path="/payment/:id" element={<Payment />} />
            <Route path="/receipt/:id" element={<Receipt />} />
            <Route path="/menu" element={<MenuManage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/reports" element={<Reports />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
