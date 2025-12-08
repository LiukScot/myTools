// API helpers for myHealth

export function apiFetch(url, options = {}) {
  const opts = { credentials: "include", ...(options || {}) };
  opts.headers = { ...(options?.headers || {}) };
  let finalUrl = url;
  if (url.startsWith("/")) {
    // Keep requests scoped to the app root (works even when loaded at /myhealth without a trailing slash)
    const path = window.location.pathname || "";
    const match = path.match(/^\/[^/]+/);
    const scopedBase = match ? match[0] : "";
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
