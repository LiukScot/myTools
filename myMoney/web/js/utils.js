// Formatting and general helpers for myMoney

export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(value || 0);
}

export function formatCurrencyWithColor(value) {
  const num = Number(value) || 0;
  const formatted = formatCurrency(num);
  let cls = 'value-zero';
  if (num > 0) cls = 'value-positive';
  else if (num < 0) cls = 'value-negative';
  return `<span class="${cls}">${formatted}</span>`;
}

export function formatPercentWithColor(value, digits = 1) {
  const num = Number(value) || 0;
  let cls = 'value-zero';
  if (num > 0) cls = 'value-positive';
  else if (num < 0) cls = 'value-negative';
  return `<span class="${cls}">${num.toFixed(digits)}%</span>`;
}

export function randomColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const r = (hash >> 16) & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = hash & 0xff;
  return `rgb(${(r + 128) % 255}, ${(g + 128) % 255}, ${(b + 128) % 255})`;
}

export function normalizeColor(color) {
  if (!color) return '#7be6a6';
  if (color.startsWith('#')) return color;
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
  if (m) {
    const toHex = v => Number(v).toString(16).padStart(2, '0');
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
  }
  return '#7be6a6';
}
