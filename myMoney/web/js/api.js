// API helpers for myMoney

export function apiFetch(url, options = {}) {
  const opts = { credentials: 'include', ...options };
  let finalUrl = url;
  if (url.startsWith('/')) {
    // Scope requests to the app root (works even when loaded from /mymoney without trailing slash)
    const path = window.location.pathname || '';
    const match = path.match(/^\/[^/]+/);
    const scopedBase = match ? match[0] : '';
    finalUrl = `${scopedBase}${url}`;
  }
  return fetch(finalUrl, opts);
}

export async function safeParseJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
}
