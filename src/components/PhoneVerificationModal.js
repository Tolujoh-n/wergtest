import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from './Modal';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from './Notification';
import CountryCodeSelect from './CountryCodeSelect';
import { DEFAULT_COUNTRY_ISO, findCountryByIso } from '../utils/countryDialCodes';

const RESEND_SECONDS = 60;
const CODE_LEN = 6;

/**
 * Verify mobile number via SMS before free predictions.
 */
export default function PhoneVerificationModal({
  open,
  onClose,
  onVerified,
  outcomePreview = null,
}) {
  const { refreshUser } = useAuth();
  const { showNotification } = useNotification();

  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY_ISO);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const timerRef = useRef(null);

  const selectedCountry = findCountryByIso(countryIso);
  const countryDial = selectedCountry?.dial || '';

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
    setStep('phone');
    setCode('');
    setCodeSent(false);
    setCountdown(0);
    setCountryIso(DEFAULT_COUNTRY_ISO);
    return () => clearTimer();
  }, [open, clearTimer]);

  const handleSendCode = async () => {
    const national = phoneNumber.replace(/\D/g, '');
    if (!countryDial) {
      showNotification('Select a country code', 'warning');
      return;
    }
    if (national.length < 4) {
      showNotification('Enter a valid mobile number', 'warning');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post('/auth/phone/send-code', {
        countryDialCode: countryDial,
        phoneNumber: national,
      });
      setCodeSent(true);
      setStep('code');
      startCountdown(data.resendAfterSeconds || RESEND_SECONDS);
      showNotification('Verification code sent', 'success');
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
      const { data } = await api.post('/auth/phone/verify', { code: digits });
      if (data.user) {
        await refreshUser?.(data.user);
      } else {
        await refreshUser?.();
      }
      showNotification('Phone verified', 'success');
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

  const fullNumberPreview = countryDial
    ? `+${countryDial} ${phoneNumber.replace(/\D/g, '')}`
    : phoneNumber;

  return (
    <Modal isOpen={open} onClose={onClose} title="Verify your phone" size="md">
      <div className="space-y-5 text-sm">
        

        {outcomePreview ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
            After verification you&apos;ll continue with:{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{outcomePreview}</span>
          </div>
        ) : null}

        {step === 'phone' ? (
          <>
            <div>
              <label
                htmlFor="phone-verify-national"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2"
              >
                Mobile number
              </label>
              <div className="flex rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-sm overflow-visible focus-within:ring-2 focus-within:ring-red-500/30 focus-within:border-red-500 dark:focus-within:border-red-500">
                <CountryCodeSelect
                  value={countryIso}
                  onChange={setCountryIso}
                  disabled={sending}
                />
                <div className="w-px self-stretch bg-slate-200 dark:bg-slate-600 shrink-0" aria-hidden />
                <input
                  id="phone-verify-national"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="Mobile number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d\s-]/g, ''))}
                  disabled={sending}
                  className="flex-1 min-w-0 h-11 px-3 border-0 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-0 text-base"
                />
              </div>
              {selectedCountry ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{selectedCountry.name}</span>
                  {' · '}
                  <span className="font-mono">+{selectedCountry.dial}</span>
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={sending}
              onClick={handleSendCode}
              className="w-full h-11 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending code…' : 'Get verification code'}
            </button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
              <span className="font-medium">Code sent to</span>
              <div className="font-mono font-semibold text-sm mt-0.5 text-emerald-900 dark:text-emerald-100">
                {fullNumberPreview}
              </div>
              {selectedCountry ? (
                <div className="text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">{selectedCountry.name}</div>
              ) : null}
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
              <p className="mt-1.5 text-xs text-slate-500">Enter the 6-digit code from your SMS.</p>
            </div>

            <button
              type="button"
              disabled={verifying || code.replace(/\D/g, '').length !== CODE_LEN}
              onClick={handleVerify}
              className="w-full h-11 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 transition-colors"
            >
              {verifying ? 'Verifying…' : 'Verify & continue'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setStep('phone')}
                className="text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 font-medium"
              >
                Change number
              </button>
              <button
                type="button"
                disabled={countdown > 0 || sending}
                onClick={handleResend}
                className="font-semibold text-red-600 dark:text-red-400 disabled:text-slate-400 disabled:no-underline hover:underline"
              >
                {countdown > 0 ? `Resend in ${countdown}s` : codeSent ? 'Resend code' : 'Send again'}
              </button>
            </div>
          </>
        )}

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
