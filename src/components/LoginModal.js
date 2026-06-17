import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import WalletConnectButton from './WalletConnectButton';
import GoogleSignInButton from './GoogleSignInButton';
import AuthTurnstileSection from './AuthTurnstileSection';
import { useTurnstile } from '../hooks/useTurnstile';
import { useNotification } from './Notification';
import Modal from './Modal';
import api from '../utils/api';

const LoginModal = ({ onClose, onSwitchToSignup }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { showNotification, dismissNotification } = useNotification();
  const turnstile = useTurnstile();

  const [view, setView] = useState('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetEmailMasked, setResetEmailMasked] = useState('');
  const [resetResendSeconds, setResetResendSeconds] = useState(0);
  const resetTimerRef = useRef(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      window.clearInterval(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const startResetCountdown = useCallback(
    (seconds = 60) => {
      clearResetTimer();
      setResetResendSeconds(seconds);
      resetTimerRef.current = window.setInterval(() => {
        setResetResendSeconds((s) => {
          if (s <= 1) {
            clearResetTimer();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    },
    [clearResetTimer]
  );

  useEffect(() => () => clearResetTimer(), [clearResetTimer]);

  const authBlocked = turnstile.enabled === true && !turnstile.verified;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!turnstile.assertVerified(showNotification)) return;
    setError('');
    setLoading(true);
    const loadingToastId = showNotification('Logging in...', 'loading', 0);

    try {
      await login(identifier, password, { turnstileToken: turnstile.token });
      dismissNotification(loadingToastId);
      showNotification('Login successful!', 'success');
      onClose();
    } catch (err) {
      const message = err.response?.data?.message || 'Login failed. Please try again.';
      setError(message);
      showNotification(message, 'error');
      turnstile.resetWidget();
    } finally {
      dismissNotification(loadingToastId);
      setLoading(false);
    }
  };

  const requestReset = async (e) => {
    e?.preventDefault?.();
    setError('');
    setResetMessage('');
    setLoading(true);
    try {
      const res = await api.post('/auth/password-reset/request', { email: resetEmail.trim() });
      setResetMessage(
        res.data?.message ||
          (res.data?.sent
            ? 'Password reset code sent. Check your inbox and spam folder.'
            : 'Unable to send password reset email.')
      );
      if (res.data?.sent) {
        if (res.data.emailMasked) setResetEmailMasked(res.data.emailMasked);
        setResetCode('');
        setView('reset_verify');
        startResetCountdown(60);
      }
    } catch (err) {
      const retry = err.response?.data?.retryAfterSeconds;
      if (retry) startResetCountdown(retry);
      setError(err.response?.data?.message || 'Unable to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyReset = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/password-reset/verify', {
        email: resetEmail.trim(),
        code: resetCode.replace(/\D/g, ''),
      });
      if (res.data?.verified) {
        if (res.data.emailMasked) setResetEmailMasked(res.data.emailMasked);
        setView('reset_confirm');
      } else {
        setError('Invalid or expired code');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  };

  const confirmReset = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/password-reset/confirm', {
        email: resetEmail.trim(),
        code: resetCode.replace(/\D/g, ''),
        newPassword,
      });
      setResetMessage('Password updated. You can now login.');
      setView('login');
      setIdentifier(resetEmail.trim());
      setPassword('');
      setNewPassword('');
      setResetCode('');
      setResetEmailMasked('');
      clearResetTimer();
      setResetResendSeconds(0);
      showNotification('Password updated successfully', 'success');
    } catch (err) {
      setError(err.response?.data?.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={view === 'login' ? 'Login' : 'Reset Password'} size="sm">
      <div className="relative">
        {loading && view === 'login' && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur-[1px]"
            aria-live="polite"
            aria-busy="true"
          >
            <svg className="w-10 h-10 text-blue-500 animate-spin mb-3" fill="none" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Logging in...</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded text-sm">
            {error}
          </div>
        )}

        {resetMessage && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 rounded text-sm">
            {resetMessage}
          </div>
        )}

        {view === 'login' ? (
          <>
            <AuthTurnstileSection
              enabled={turnstile.enabled}
              loading={turnstile.loading}
              siteKey={turnstile.siteKey}
              resetKey={turnstile.resetKey}
              onVerify={turnstile.setToken}
              onExpire={turnstile.clearToken}
            />

            <div className={authBlocked ? 'opacity-50 pointer-events-none select-none' : ''}>
              <GoogleSignInButton onSuccess={onClose} onError={setError} />
            </div>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">Or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email or Username
                </label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  placeholder="Enter your email or username"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setError('');
                  setResetMessage('');
                  setResetEmail('');
                  setResetCode('');
                  setNewPassword('');
                  setView('reset_request');
                }}
                className="text-sm text-blue-500 hover:text-blue-600 font-medium"
              >
                Forgot password?
              </button>

              <button
                type="submit"
                disabled={loading || authBlocked}
                className="w-full py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Logging in...
                  </>
                ) : authBlocked ? (
                  'Complete security check to login'
                ) : (
                  'Login'
                )}
              </button>
            </form>

            <div className="mt-4 relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">Or</span>
              </div>
            </div>

            <div className={`mt-4 ${authBlocked ? 'opacity-50 pointer-events-none select-none' : ''}`}>
              <WalletConnectButton
                onSuccess={onClose}
                onConnectClick={onClose}
                beforeConnect={() => turnstile.assertVerified(showNotification)}
              />
            </div>

            <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToSignup}
                className="text-blue-500 hover:text-blue-600 font-medium"
              >
                Sign up
              </button>
            </p>
          </>
        ) : view === 'reset_request' ? (
          <form onSubmit={requestReset} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter the email you used to sign up. We&apos;ll email you a 6-digit verification code.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
                placeholder="Enter your email"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('login')}
                className="w-1/2 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-1/2 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Sending...' : 'Send code'}
              </button>
            </div>
          </form>
        ) : view === 'reset_verify' ? (
          <form onSubmit={verifyReset} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter the 6-digit code sent to{' '}
              <span className="font-medium">{resetEmailMasked || resetEmail}</span>. Check your inbox and spam folder.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Verification code
              </label>
              <input
                type="text"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-center text-lg font-bold tracking-[0.3em]"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setView('reset_request')}
                className="text-gray-600 dark:text-gray-400 hover:text-blue-500 font-medium"
              >
                Change email
              </button>
              <button
                type="button"
                disabled={resetResendSeconds > 0 || loading}
                onClick={requestReset}
                className="font-semibold text-blue-500 disabled:text-gray-400 hover:underline"
              >
                {resetResendSeconds > 0 ? `Resend in ${resetResendSeconds}s` : 'Resend code'}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('login')}
                className="w-1/2 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || resetCode.replace(/\D/g, '').length !== 6}
                className="w-1/2 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={confirmReset} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Set a new password for <span className="font-medium">{resetEmail}</span>.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                New password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="At least 8 characters"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('reset_verify')}
                className="w-1/2 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-1/2 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};

export default LoginModal;
