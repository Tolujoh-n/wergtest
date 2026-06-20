import React from 'react';
import { ELLIPSIS } from '../utils/textGlyphs';

const base = 'shrink-0';

export function Spinner({ className = 'h-4 w-4', ...props }) {
  return (
    <svg
      className={`animate-spin ${base} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
      {...props}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function LoadingLabel({ text = 'Processing', className = '' }) {
  return (
    <span className={`inline-flex items-center justify-center gap-2 ${className}`}>
      <Spinner className="h-4 w-4" />
      <span>
        {text}
        {ELLIPSIS}
      </span>
    </span>
  );
}

export function TicketIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 10v2M9 5v2m0 10v2M7 7h10a2 2 0 012 2v1H5V9a2 2 0 012-2zm-2 4h14v4H5v-4z" />
    </svg>
  );
}

export function StarIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5l2.55 5.17 5.7.83-4.12 4.02.97 5.67L12 15.9l-5.1 2.68.97-5.67-4.12-4.02 5.7-.83L12 2.5z" />
    </svg>
  );
}

export function FireIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 23c3.9 0 7-3.1 7-7 0-2.6-1.4-4.9-3.5-6.2.4 1.8.1 3.8-1.1 5.3-1.8 2.2-5 2.5-7.2.7C5.8 14.4 5 12.3 5.4 10.2 3.5 11.5 2 13.8 2 16.5 2 19.9 4.1 22.5 7 23c1.6.3 3.3.1 5-1z" />
    </svg>
  );
}

export function BoltIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

export function ChartIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5" />
    </svg>
  );
}

export function TargetIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckCircleIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
