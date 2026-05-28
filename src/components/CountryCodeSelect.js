import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  DEFAULT_COUNTRY_ISO,
  filterCountries,
  findCountryByIso,
  isoToFlag,
} from '../utils/countryDialCodes';

/**
 * Searchable country / dial-code picker (left segment of phone input).
 */
export default function CountryCodeSelect({ value, onChange, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selected = findCountryByIso(value) || findCountryByIso(DEFAULT_COUNTRY_ISO);

  const filtered = useMemo(() => {
    const list = filterCountries(search);
    if (!String(search).trim()) return list;
    return list.slice(0, 80);
  }, [search]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const pick = (iso) => {
    onChange?.(iso);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-11 pl-2.5 pr-2 min-w-[5.5rem] max-w-[9.5rem] sm:max-w-[10.5rem] bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Country code"
      >
        <span className="text-base leading-none shrink-0" aria-hidden>
          {isoToFlag(selected?.iso)}
        </span>
        <span className="font-semibold text-slate-900 dark:text-white tabular-nums text-sm shrink-0">
          +{selected?.dial || '—'}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
          role="listbox"
        >
          <div className="p-2 border-b border-slate-100 dark:border-slate-700">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country or code…"
              className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-sm text-slate-500 text-center">No countries found</li>
            ) : (
              filtered.map((c) => {
                const active = c.iso === selected?.iso;
                return (
                  <li key={`${c.iso}-${c.dial}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pick(c.iso)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                        active
                          ? 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      <span className="text-lg leading-none w-6 text-center shrink-0" aria-hidden>
                        {isoToFlag(c.iso)}
                      </span>
                      <span className="flex-1 min-w-0 font-medium truncate">{c.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400 font-semibold">
                        +{c.dial}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {search && filtered.length === 80 ? (
            <p className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-700">
              Showing first 80 matches — refine your search
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
