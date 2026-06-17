import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from './Modal';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from './Notification';

const RESEND_SECONDS = 60;
const CODE_LEN = 6;

/**
 * Verify email via OTP before free predictions.
 * Uses registration email, or lets wallet-only users add an email first.
 */
export default function EmailVerificationModal({
  open,
  onClose,
  onVerified,
  outcomePreview = null,
}) {
  const { user, refreshUser } = useAuth();
  const { showNotification } = useNotification();

  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [sentToMasked, setSentToMasked] = useState('');
  const timerRef = useRef(null);

  const hasAccountEmail = !!user?.email;
  const needsEmail = !hasAccountEmail;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(
    (seconds = RESEND_SECONDS) => {
      clearTimer();
      setCountdown(seconds);
      timerRef.current = window.setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearTimer();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    },
    [clearTimer]
  );

  useEffect(() => {
    if (!open) {
      clearTimer();
      return undefined;
    }
    setCode('');
    setCodeSent(false);
    setCountdown(0);
    setSentToMasked('');
    setEmailInput(user?.email || '');
    setStep(needsEmail ? 'email' : 'confirm');
    return () => clearTimer();
  }, [open, clearTimer, user?.email, needsEmail]);

  const handleSendCode = async () => {
    const payload = needsEmail || step === 'email' ? { email: emailInput.trim() } : {};
    if ((needsEmail || step === 'email') && !emailInput.trim()) {
      showNotification('Enter your email address', 'warning');
      return;
    }

    setSending(true);
    try {
      const { data } = await api.post('/auth/email/send-code', payload);
      if (!data?.sent) {
        showNotification(data?.message || 'Could not send verification code', 'error');
        return;
      }
      setCodeSent(true);
      setSentToMasked(data.emailMasked || emailInput);
      setStep('code');
      startCountdown(data.resendAfterSeconds || RESEND_SECONDS);
      showNotification(data.message || 'Verification code sent', data.dev ? 'info' : 'success');
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Could not send code';
      const retry = e.response?.data?.retryAfterSeconds;
      if (retry) startCountdown(retry);
      showNotification(msg, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== CODE_LEN) {
      showNotification(`Enter the ${CODE_LEN}-digit code`, 'warning');
      return;
    }
    setVerifying(true);
    try {
      const { data } = await api.post('/auth/email/verify', { code: digits });
      if (data.user) {
        await refreshUser?.(data.user);
      } else {
        await refreshUser?.();
      }
      showNotification('Email verified — you can play free predictions', 'success');
      onVerified?.();
      onClose?.();
    } catch (e) {
      showNotification(e.response?.data?.message || e.message || 'Verification failed', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    if (countdown > 0) return;
    handleSendCode();
  };

  if (!open) return null;

  const maskedAccountEmail = user?.emailMasked || (user?.email ? maskSimple(user.email) : null);

  return (
    <Modal isOpen={open} onClose={onClose} title="Verify your email" size="md">
      <div className="space-y-5 text-sm">
        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
          {user?.needsReverification ? (
            <>
              Your free-play email verification has expired. Re-verify to continue placing{' '}
              <strong>free predictions</strong> (required every{' '}
              {user.emailVerificationValidDays || 30} days).
            </>
          ) : (
            <>
              To prevent spam, we verify your email before you can place{' '}
              <strong>free predictions</strong>. Verification stays valid for{' '}
              {user?.emailVerificationValidDays || 30} days, then you&apos;ll re-verify with a new
              code.
            </>
          )}
        </p>

        {outcomePreview ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
            After verification you&apos;ll continue with:{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{outcomePreview}</span>
          </div>
        ) : null}

        {step === 'confirm' ? (
          <>
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-1">
                Your account email
              </p>
              <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                {maskedAccountEmail || user?.email}
              </p>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                We&apos;ll send a one-time code to this address.
              </p>
            </div>
            <button
              type="button"
              disabled={sending}
              onClick={handleSendCode}
              className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending code…' : 'Send verification code'}
            </button>
          </>
        ) : null}

        {step === 'email' ? (
          <>
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              Add the email you want to use on {process.env.REACT_APP_APP_NAME || 'WeRgame'}. Disposable or
              temporary addresses are not allowed.
            </div>
            <div>
              <label
                htmlFor="email-verify-input"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2"
              >
                Email address
              </label>
              <input
                id="email-verify-input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={sending}
                className="w-full h-11 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            <button
              type="button"
              disabled={sending}
              onClick={handleSendCode}
              className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending code…' : 'Send verification code'}
            </button>
          </>
        ) : null}

        {step === 'code' ? (
          <>
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
              <span className="font-medium">Code sent to</span>
              <div className="font-mono font-semibold text-sm mt-0.5 text-emerald-900 dark:text-emerald-100">
                {sentToMasked || maskedAccountEmail || emailInput}
              </div>
              <p className="mt-1 text-emerald-700/90 dark:text-emerald-300/90">
                Check your inbox and spam folder. The code expires in 10 minutes.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Verification code
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LEN}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LEN))}
                className="w-full h-12 px-4 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-center text-xl font-bold tracking-[0.35em] text-slate-900 dark:text-white"
              />
              <p className="mt-1.5 text-xs text-slate-500">Enter the 6-digit code from your email.</p>
            </div>

            <button
              type="button"
              disabled={verifying || code.replace(/\D/g, '').length !== CODE_LEN}
              onClick={handleVerify}
              className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 transition-colors"
            >
              {verifying ? 'Verifying…' : 'Verify & continue'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setStep(needsEmail ? 'email' : 'confirm')}
                className="text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
              >
                {needsEmail ? 'Change email' : 'Back'}
              </button>
              <button
                type="button"
                disabled={countdown > 0 || sending}
                onClick={handleResend}
                className="font-semibold text-blue-600 dark:text-blue-400 disabled:text-slate-400 disabled:no-underline hover:underline"
              >
                {countdown > 0 ? `Resend in ${countdown}s` : codeSent ? 'Resend code' : 'Send again'}
              </button>
            </div>
          </>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function maskSimple(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at);
  if (local.length <= 2) return `${local[0] || ''}•${domain}`;
  return `${local[0]}•••${local.slice(-1)}${domain}`;
}
