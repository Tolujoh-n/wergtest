const fs = require('fs');
const path = require('path');

const src =
  'C:/Users/HELLO/.cursor/projects/c-Users-HELLO-Desktop-startups-wergame-platform/agent-tools/eca87f8e-cd77-4c3e-8488-59f11340e919.txt';
const dest = path.join(__dirname, '../src/utils/countryDialCodes.js');

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = [];
const seen = new Set();

for (const c of raw) {
  const dial = String(c.phonecode || '').replace(/\D/g, '');
  if (!dial) continue;
  const iso = c.iso2;
  if (!iso) continue;
  const key = `${iso}|${dial}`;
  if (seen.has(key)) continue;
  seen.add(key);
  out.push({ iso, name: c.name, dial });
}

out.sort((a, b) => a.name.localeCompare(b.name));

const lines = out.map(
  (c) => `  { iso: '${c.iso}', name: ${JSON.stringify(c.name)}, dial: '${c.dial}' },`
);

const file = `/** ITU calling codes for E.164 / Twilio SMS (one row per country). */
export const DEFAULT_COUNTRY_DIAL = '234';

export const COUNTRY_DIAL_CODES = [
${lines.join('\n')}
];

export function findCountryByIso(iso) {
  return COUNTRY_DIAL_CODES.find((c) => c.iso === iso);
}

export function findCountryByDial(dial) {
  return COUNTRY_DIAL_CODES.find((c) => c.dial === String(dial));
}

export function filterCountries(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return COUNTRY_DIAL_CODES;
  const digits = q.replace(/\\D/g, '');
  return COUNTRY_DIAL_CODES.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.iso.toLowerCase().includes(q)) return true;
    if (digits && c.dial.startsWith(digits)) return true;
    if (q.startsWith('+') && c.dial.startsWith(q.slice(1))) return true;
    return false;
  });
}
`;

fs.writeFileSync(dest, file);
console.log('wrote', out.length, 'countries to', dest);
