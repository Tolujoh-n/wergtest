import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';

const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

export default function GoogleSignInButton({ onSuccess, onError }) {
  const { googleLogin } = useAuth();

  if (!clientId) return null;

  return (
    <div className="mb-4">
      <GoogleLogin
        onSuccess={async (res) => {
          try {
            await googleLogin(res.credential);
            onSuccess?.();
          } catch (err) {
            onError?.(err.response?.data?.message || 'Google login failed');
          }
        }}
        onError={() => onError?.('Google login failed')}
        useOneTap={false}
        theme="outline"
        size="large"
        width="100%"
        text="continue_with"
      />
    </div>
  );
}
