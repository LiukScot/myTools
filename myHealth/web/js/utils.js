// Shared helpers for myHealth

export function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function dedupe(list) {
  return Array.from(new Set((list || []).filter(Boolean).map((v) => v.trim())));
}
