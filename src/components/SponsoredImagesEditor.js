import React from 'react';
import ImageUpload from './ImageUpload';

export function normalizeSponsoredImageEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const url = entry.trim();
    return url ? { url, link: '' } : null;
  }
  const url = String(entry.url || '').trim();
  if (!url) return null;
  return {
    url,
    link: String(entry.link || '').trim(),
  };
}

export function normalizeSponsoredImages(images) {
  if (!Array.isArray(images)) return [];
  return images.map(normalizeSponsoredImageEntry).filter(Boolean);
}

const SponsoredImagesEditor = ({ images, onChange, folder = 'wergame/sponsored' }) => {
  const rows = normalizeSponsoredImages(images);

  const updateRow = (index, patch) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const removeRow = (index) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const addRow = (url) => {
    if (!url) return;
    onChange([...rows, { url, link: '' }]);
  };

  return (
    <div className="border p-4 rounded-lg dark:border-gray-700 space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Sponsored Images (optional)
      </label>
      {rows.map((row, idx) => (
        <div key={`${row.url}-${idx}`} className="flex flex-col sm:flex-row gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <img src={row.url} alt={`Sponsor ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <input
              type="url"
              placeholder="Click-through link (opens in new tab)"
              value={row.link}
              onChange={(e) => updateRow(idx, { link: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{row.url}</p>
          </div>
          <button
            type="button"
            onClick={() => removeRow(idx)}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm self-start"
          >
            Remove
          </button>
        </div>
      ))}
      <ImageUpload label="Add Sponsored Image" value="" onChange={addRow} folder={folder} />
    </div>
  );
};

export default SponsoredImagesEditor;
