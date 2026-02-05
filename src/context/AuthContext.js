import React, { createContext, useState, useContext, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext();

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

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const response = await api.get('/auth/me');
        setUser(response.data.user);
      }
    } catch (error) {
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', response.data.token);
    setUser(response.data.user);
    return response.data;
  };

  const signup = async (email, password, username) => {
    const response = await api.post('/auth/signup', { email, password, username });
    localStorage.setItem('token', response.data.token);
    setUser(response.data.user);
    return response.data;
  };

  const loginWithWallet = async (address) => {
    try {
      const response = await api.post('/auth/wallet-login', { address });
      if (response.data.token) {
        localStorage.setItem('token', response.data.token);
        setUser(response.data.user);
      }
      setWalletAddress(address);
      return response.data;
    } catch (error) {
      // If user doesn't exist, create account
      const signupResponse = await api.post('/auth/wallet-signup', { address });
      localStorage.setItem('token', signupResponse.data.token);
      setUser(signupResponse.data.user);
      setWalletAddress(address);
      return signupResponse.data;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setWalletAddress(null);
  };

  const value = {
    user,
    loading,
    walletAddress,
    login,
    signup,
    loginWithWallet,
    logout,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
