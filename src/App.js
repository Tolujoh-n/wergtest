import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './components/Notification';
import Navbar from './components/Navbar';
import CupPage from './pages/CupPage';
import MatchDetail from './pages/MatchDetail';
import Admin from './pages/Admin';
import SuperAdmin from './pages/SuperAdmin';
import Leaderboard from './pages/Leaderboard';
import Streaks from './pages/Streaks';
import Jackpot from './pages/Jackpot';
import Profile from './pages/Profile';
import Blogs from './pages/Blogs';
import BlogDetail from './pages/BlogDetail';
import Footer from './components/Footer';
import './App.css';

// Component to handle scroll to top on route change
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <Router>
          <ScrollToTop />
          <div className="App min-h-screen bg-gray-50 dark:bg-gray-900">
            <Navbar />
            <Routes>
              {/* <Route path="/" element={<Home />} /> */}
              <Route path="/" element={<Navigate to="/cup/worldcup" replace />} />
              <Route path="/cup/:cupSlug" element={<CupPage />} />
              <Route path="/match/:matchId/:type" element={<MatchDetail />} />
              <Route path="/poll/:pollId/:type" element={<MatchDetail />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/superadmin" element={<SuperAdmin />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/streaks" element={<Streaks />} />
              <Route path="/jackpot" element={<Jackpot />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/blogs" element={<Blogs />} />
              <Route path="/blog/:slug" element={<BlogDetail />} />
            </Routes>
            <Footer />
          </div>
        </Router>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
