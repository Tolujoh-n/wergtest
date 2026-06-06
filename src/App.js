import React, { useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './components/Notification';
import { WalletProvider } from './context/WalletContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import CupPage from './pages/CupPage';
import MatchDetail from './pages/MatchDetail';
import Admin from './pages/Admin';
import AdminMarketControl from './pages/AdminMarketControl';
import SuperAdmin from './pages/SuperAdmin';
import Unauthorized from './pages/Unauthorized';
import Leaderboard from './pages/Leaderboard';
import Streaks from './pages/Streaks';
import Jackpot from './pages/Jackpot';
import Profile from './pages/Profile';
import WalletPage from './pages/Wallet';
import Blogs from './pages/Blogs';
import BlogDetail from './pages/BlogDetail';
import Footer from './components/Footer';
import WalletAccountSync from './components/WalletAccountSync';
import './App.css';
import { syncChainConfigFromServer } from './utils/syncChainConfig';

// Component to handle scroll to top on route change
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

function App() {
  useEffect(() => {
    syncChainConfigFromServer().catch((e) => {
      console.warn('[WeRgame] Could not sync chain config from API:', e?.message || e);
    });
  }, []);

  const appTree = (
    <AuthProvider>
      <WalletProvider>
        <NotificationProvider>
          <Router>
          <ScrollToTop />
          <WalletAccountSync />
          <div className="App min-h-screen bg-gray-50 dark:bg-gray-900">
            <Navbar />
            <Routes>
              {/* Public */}
              <Route path="/" element={<Navigate to="/cup/worldcup" replace />} />
              <Route path="/cup/:cupSlug" element={<CupPage />} />
              <Route path="/match/:matchId/:type" element={<MatchDetail />} />
              <Route path="/poll/:pollId/:type" element={<MatchDetail />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/streaks" element={<Streaks />} />
              <Route path="/jackpot" element={<Jackpot />} />
              <Route path="/blogs" element={<Blogs />} />
              <Route path="/blog/:slug" element={<BlogDetail />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* Authenticated users */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/wallet"
                element={
                  <ProtectedRoute>
                    <WalletPage />
                  </ProtectedRoute>
                }
              />

              {/* Admin + SuperAdmin (matches backend isAdmin) */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'superAdmin']}>
                    <Admin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/market/:kind/:id"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'superAdmin']}>
                    <AdminMarketControl />
                  </ProtectedRoute>
                }
              />

              {/* SuperAdmin only (matches backend isSuperAdmin) */}
              <Route
                path="/superadmin"
                element={
                  <ProtectedRoute allowedRoles={['superAdmin']}>
                    <SuperAdmin />
                  </ProtectedRoute>
                }
              />
            </Routes>
            <Footer />
          </div>
        </Router>
        </NotificationProvider>
      </WalletProvider>
    </AuthProvider>
  );

  if (googleClientId) {
    return <GoogleOAuthProvider clientId={googleClientId}>{appTree}</GoogleOAuthProvider>;
  }
  return appTree;
}

export default App;
