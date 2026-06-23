import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';

const AuthContext = createContext();

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const LAST_ACTIVITY_KEY = 'lastActivityAt';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState(null);
  const authCheckStartedRef = useRef(false);
  const refreshInFlightRef = useRef(null);

  const touchActivity = useCallback(() => {
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }, []);

  // Logout after inactivity (front-end enforced; token is still valid server-side)
  useEffect(() => {
    if (!user) return;

    touchActivity();

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => touchActivity();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));

    const interval = window.setInterval(() => {
      const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
      const last = raw ? parseInt(raw, 10) : Date.now();
      if (!Number.isNaN(last) && Date.now() - last > INACTIVITY_LIMIT_MS) {
        logout();
      }
    }, 15_000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      window.clearInterval(interval);
    };
  }, [user, touchActivity]);

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const response = await api.get('/auth/me');
        setUser(response.data.user);
        touchActivity();
      }
    } catch (error) {
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  }, [touchActivity]);

  const refreshUser = useCallback(async (userPayload) => {
    if (userPayload) {
      setUser(userPayload);
      return userPayload;
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const promise = (async () => {
      try {
        const response = await api.get('/auth/me');
        setUser(response.data.user);
        return response.data.user;
      } catch {
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    if (authCheckStartedRef.current) return;
    authCheckStartedRef.current = true;
    checkAuth();
  }, [checkAuth]);

  const login = async (identifier, password, options = {}) => {
    const response = await api.post('/auth/login', {
      identifier,
      password,
      turnstileToken: options.turnstileToken,
    });
    localStorage.setItem('token', response.data.token);
    touchActivity();
    setUser(response.data.user);
    return response.data;
  };

  const signup = async (email, password, username, options = {}) => {
    const response = await api.post('/auth/signup', {
      email,
      password,
      username,
      turnstileToken: options.turnstileToken,
    });
    localStorage.setItem('token', response.data.token);
    touchActivity();
    setUser(response.data.user);
    return response.data;
  };

  const googleLogin = async (credential) => {
    const response = await api.post('/auth/google', { credential });
    localStorage.setItem('token', response.data.token);
    touchActivity();
    setUser(response.data.user);
    return response.data;
  };

  const loginWithWallet = async (address) => {
    try {
      const response = await api.post('/auth/wallet-login', { address });
      if (response.data.token) {
        localStorage.setItem('token', response.data.token);
        touchActivity();
        setUser(response.data.user);
      }
      setWalletAddress(address);
      return response.data;
    } catch (error) {
      const signupResponse = await api.post('/auth/wallet-signup', { address });
      localStorage.setItem('token', signupResponse.data.token);
      touchActivity();
      setUser(signupResponse.data.user);
      setWalletAddress(address);
      return signupResponse.data;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    try {
      // Ensure wallet is disconnected on logout (WalletProvider listens to this)
      window.dispatchEvent(new Event('app:logout'));
      // Also prevent auto-reconnect next load
      localStorage.removeItem('onboard.selectedWallet');
    } catch {
      // ignore
    }
    setUser(null);
    setWalletAddress(null);
    window.location.href = '/';
  };

  const value = {
    user,
    loading,
    walletAddress,
    login,
    signup,
    googleLogin,
    loginWithWallet,
    logout,
    checkAuth,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
