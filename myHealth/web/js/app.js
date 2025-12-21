import { apiFetch, safeParseJson } from "./api.js";
import { escapeHtml, dedupe } from "./utils.js";

const datasets = {
  diary: {
    file: "diary.json",
    logsTable: document.getElementById("diary-table"),
    statusLog: document.getElementById("diary-status-log"),
    statusImport: document.getElementById("diary-status-import"),
  },
  pain: {
    file: "pain.json",
    logsTable: document.getElementById("pain-table"),
    statusLog: document.getElementById("pain-status-log"),
    statusImport: document.getElementById("pain-status-import"),
  },
};
const dataStore = { diary: null, pain: null };
const logFilters = { diary: {}, pain: {} };
const authUI = {
  email: document.getElementById("auth-email"),
  pass: document.getElementById("auth-pass"),
  status: document.getElementById("auth-status"),
  debug: document.getElementById("auth-debug"),
  loginBtn: document.getElementById("auth-login"),
  logoutBtn: document.getElementById("auth-logout"),
  hubBtn: document.getElementById("go-hub"),
};
const backupUI = {
  importInput: document.getElementById("import-backup-input"),
  exportBtn: document.getElementById("export-backup-button"),
  purgeBtn: document.getElementById("full-purge-button"),
  importXlsx: document.getElementById("import-xlsx-input"),
  exportXlsx: document.getElementById("export-xlsx-button"),
  status: document.getElementById("backup-status"),
  errorBox: document.getElementById("backup-error"),
};
const mistralUI = {
  input: document.getElementById("mistral-api-key"),
  saveBtn: document.getElementById("save-mistral-key"),
  clearBtn: document.getElementById("clear-mistral-key"),
  status: document.getElementById("mistral-key-status"),
  helper: document.getElementById("mistral-key-helper"),
  modelSelect: document.getElementById("mistral-model"),
};
const chatbotUI = {
  prompt: document.getElementById("chatbot-prompt"),
  sendBtn: document.getElementById("chatbot-send-btn"),
  helper: document.getElementById("chatbot-helper"),
  log: document.getElementById("chatbot-log"),
  status: document.getElementById("chatbot-status"),
  loading: document.getElementById("chatbot-loading"),
  keyAlert: document.getElementById("chatbot-key-alert"),
  goSettingsLink: document.getElementById("chatbot-go-settings"),
};
const appMain = document.getElementById("app-main");
let isAuthed = false;
function setAuthStatus(message, ok = false) {
  if (!authUI.status) return;
  authUI.status.innerHTML = message
    ? `<span class="${ok ? "ok" : "err"}">${ok ? "OK" : "Error"}:</span> ${escapeHtml(message)}`
    : "";
}
function setAuthDebug(text) {
  if (!authUI.debug) return;
  authUI.debug.textContent = text || "";
  authUI.debug.classList.toggle("hidden", !text);
}
function setAuthVisibility(authed) {
  isAuthed = authed;
  // Always keep the app visible; auth card is hidden permanently now.
  const authCard = document.querySelector(".auth-card");
  authCard?.classList.add("hidden");
  authUI.hubBtn?.classList.remove("hidden");
}
function setAppVisible(isAuthed) {
  if (appMain) appMain.classList.remove("hidden");
}
function resetAppState() {
  dataStore.diary = null;
  dataStore.pain = null;
  ["diary", "pain"].forEach((kind) => {
    const table = datasets[kind]?.logsTable;
    if (table) table.innerHTML = "";
    setStatus(kind, "", true, "logs");
    setStatus(kind, "", true, "import");
  });
  const dashCards = document.getElementById("dash-cards");
  const dashGraphs = document.getElementById("dash-graphs");
  if (dashCards) dashCards.innerHTML = "";
  if (dashGraphs) dashGraphs.innerHTML = "";
}
const REQUIRED = {
  diary: ["date", "hour", "mood level", "depression", "anxiety", "description", "gratitude", "reflection"],
  pain: [
    "date",
    "hour",
    "pain level",
    "fatigue level",
    "symptoms",
    "area",
    "activities",
    "habits",
    "coffee",
    "other",
    "medicines",
    "note",
  ],
};
const ALIASES = {
  diary: {
    "date": ["date", "file name"],
    "hour": ["hour", "time"],
  },
  pain: {
    "date": ["date", "file name"],
    "hour": ["hour", "time"],
    "pain level": ["pain level", "pain"],
    "fatigue level": ["fatigue level", "fatigue"],
    "habits": ["habits", "good sleep", "healthy food", "sleep"],
    "other": ["other", ">6h day byte", ">1h masturbation", "<1h masturbation", "cum"],
    "coffee": ["coffee"],
    "medicines": ["medicines"],
  },
};
const LONG_TEXT_FIELDS = [
  "description",
  "gratitude",
  "reflection",
  "note",
  "medicines",
  "symptoms",
  "activities",
  "area",
  "habits",
  "other",
];
let entryTabSetter = null;
const optionFields = ["area", "symptoms", "activities", "medicines", "habits", "other"];
const optionsCache = {
  area: [],
  symptoms: [],
  activities: [],
  medicines: [],
  habits: [],
  other: [],
};
const removedOptions = {
  area: [],
  symptoms: [],
  activities: [],
  medicines: [],
  habits: [],
  other: [],
};
let mistralState = { hasKey: false, last4: "" };
const cardEmojiMap = {
  "Journal entries": "📒",
  "Pain entries": "📓",
  "Mood avg": "🙂",
  "Depression avg": "😔",
  "Anxiety avg": "😨",
  "Pain avg": "🤕",
  "Fatigue avg": "🥱",
};
const EMOJI_CHOICES = ["📒", "📓", "🙂", "😔", "😨", "🤕", "🥱", "😊", "💪", "🧠", "🩺", "🌿", "⭐", "🔥", "✨"];
let emojiPickerEl = null;
let emojiScriptLoading = null;

const PREFS_FILE = "prefs.json";
const GUEST_DATA_KEY = "myhealth:guest:data";
const GUEST_PREFS_KEY = "myhealth:guest:prefs";
const defaultPrefs = {
  model: "mistral-small-latest",
  chatRange: "all",
  graphSelection: {},
  lastRange: "all",
};
let prefs = { ...defaultPrefs };

const NUMERIC_FIELDS = {
  diary: [
    { key: "mood level", label: "Mood" },
    { key: "depression", label: "Depression" },
    { key: "anxiety", label: "Anxiety" },
  ],
  pain: [
    { key: "pain level", label: "Pain" },
    { key: "fatigue level", label: "Fatigue" },
  ],
};

function closeEmojiPicker() {
  if (emojiPickerEl) {
    emojiPickerEl.remove();
    emojiPickerEl = null;
  }
}

function ensureEmojiPickerLib() {
  if (window.EmojiMart && window.EmojiMart.Picker) {
    return Promise.resolve(window.EmojiMart.Picker);
  }
  if (emojiScriptLoading) return emojiScriptLoading;
  emojiScriptLoading = new Promise((resolve, reject) => {
    const cssId = "emoji-mart-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/emoji-mart@5.6.0/dist/browser.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/emoji-mart@5.6.0/dist/browser.js";
    script.async = true;
    script.onload = () => {
      if (window.EmojiMart && window.EmojiMart.Picker) {
        resolve(window.EmojiMart.Picker);
      } else {
        reject(new Error("Emoji picker library did not load"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load emoji picker library"));
    document.head.appendChild(script);
  });
  return emojiScriptLoading;
}

function openEmojiPicker(label, anchor) {
  const fallback = () => {
    closeEmojiPicker();
    const picker = document.createElement("div");
    picker.className = "emoji-picker";
    EMOJI_CHOICES.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-choice";
      btn.textContent = emoji;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        cardEmojiMap[label] = emoji;
        closeEmojiPicker();
        renderDashboard();
      });
      picker.appendChild(btn);
    });
    const custom = document.createElement("input");
    custom.className = "emoji-input";
    custom.placeholder = "Custom";
    custom.maxLength = 3;
    custom.addEventListener("change", (e) => {
      const val = (e.target.value || "").trim();
      if (val) {
        cardEmojiMap[label] = val;
        closeEmojiPicker();
        renderDashboard();
      }
    });
    picker.appendChild(custom);
    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    picker.style.left = `${rect.left + window.scrollX}px`;
    picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
    emojiPickerEl = picker;
    setTimeout(() => {
      const handler = (ev) => {
        if (!emojiPickerEl) return;
        if (emojiPickerEl.contains(ev.target)) return;
        closeEmojiPicker();
      };
      document.addEventListener("click", handler, { once: true });
    }, 0);
  };

  ensureEmojiPickerLib()
    .then((Picker) => {
      closeEmojiPicker();
      const pickerWrap = document.createElement("div");
      pickerWrap.style.position = "absolute";
      const rect = anchor.getBoundingClientRect();
      pickerWrap.style.left = `${rect.left + window.scrollX}px`;
      pickerWrap.style.top = `${rect.bottom + window.scrollY + 6}px`;
      const picker = new Picker({
        theme: "dark",
        skinTonePosition: "none",
        previewPosition: "none",
        onEmojiSelect: (emoji) => {
          cardEmojiMap[label] = emoji.native || emoji.name || "😊";
          closeEmojiPicker();
          renderDashboard();
        },
      });
      pickerWrap.appendChild(picker);
      document.body.appendChild(pickerWrap);
      emojiPickerEl = pickerWrap;
      setTimeout(() => {
        const handler = (ev) => {
          if (!emojiPickerEl) return;
          if (emojiPickerEl.contains(ev.target)) return;
          closeEmojiPicker();
        };
        document.addEventListener("click", handler, { once: true });
      }, 0);
    })
    .catch(() => fallback());
}

function loadSavedOptionCache() {
  if (dataStore.pain?.options && typeof dataStore.pain.options === "object") {
    return {
      options: dataStore.pain.options.options || {},
      removed: dataStore.pain.options.removed || {},
    };
  }
  if (dataStore.pain?.rows?.length) {
    const derived = {};
    optionFields.forEach((field) => {
      derived[field] = dedupe(collectOptions(field));
    });
    return { options: derived, removed: {} };
  }
  return { options: {}, removed: {} };
}

async function persistOptionCache() {
  if (!dataStore.pain) return;
  const optionsPayload = {
    options: optionFields.reduce((acc, field) => {
      acc[field] = Array.isArray(optionsCache[field]) ? [...optionsCache[field]] : [];
      return acc;
    }, {}),
    removed: optionFields.reduce((acc, field) => {
      acc[field] = Array.isArray(removedOptions[field]) ? [...removedOptions[field]] : [];
      return acc;
    }, {}),
  };
  dataStore.pain.options = optionsPayload;
  try {
    await persistNormalized("pain", dataStore.pain);
  } catch (err) {
    console.warn("Failed to persist pain options", err);
  }
}

function wireAuthForm() {
  if (authUI.loginBtn) {
    authUI.loginBtn.addEventListener("click", () => doLogin());
  }
  if (authUI.logoutBtn) {
    authUI.logoutBtn.addEventListener("click", () => doLogout());
  }
}

async function doLogin() {
  setAuthStatus("Please log in from the hub, then reopen myHealth.", false);
  setAuthDebug("Direct login here is disabled. Use the hub login.");
}

async function doLogout() {
  try {
    await apiFetch("/api/files/logout", { method: "POST" });
    setAuthStatus("Logged out. Data access requires hub login.", false);
  } catch (err) {
    setAuthStatus(err.message || "Logout failed", false);
  }
}

function buildOptionCacheFromStore() {
  const saved = loadSavedOptionCache();
  optionFields.forEach((field) => {
    const stored = Array.isArray(saved.options?.[field]) ? saved.options[field] : [];
    const removed = Array.isArray(saved.removed?.[field]) ? saved.removed[field] : [];
    optionsCache[field] = dedupe(stored);
    removedOptions[field] = dedupe(removed);
  });
  if (dataStore.pain) {
    dataStore.pain.options = {
      options: optionFields.reduce((acc, field) => {
        acc[field] = optionsCache[field];
        return acc;
      }, {}),
      removed: optionFields.reduce((acc, field) => {
        acc[field] = removedOptions[field];
        return acc;
      }, {}),
    };
  }
}

function wireJournalForm() {
  const form = document.getElementById("journal-form");
  const status = document.getElementById("journal-form-status");
  if (!form) return;
  const setStatusMsg = (msg, ok = false) => {
    if (!status) return;
    status.innerHTML = msg ? `<span class="${ok ? "ok" : "err"}">${ok ? "Saved" : "Error"}:</span> ${escapeHtml(msg)}` : "";
  };
  const setDefaultDate = () => {
    const input = form.querySelector('input[name="journal-date"]');
    if (input) {
      const now = new Date();
      const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      input.value = localIso;
    }
  };
  setDefaultDate();

  const cancelBtn = document.getElementById("journal-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      resetEditState();
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const toParts = (val) => {
      const fallback = new Date();
      const parsed = val ? new Date(val) : fallback;
      const good = parsed.toString() !== "Invalid Date" ? parsed : fallback;
      const iso = new Date(good.getTime() - good.getTimezoneOffset() * 60000).toISOString();
      return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
    };
    const parts = toParts(data.get("journal-date"));
    const row = {
      "date": parts.date,
      "hour": parts.time,
      "mood level": data.get("journal-mood") || "",
      "depression": data.get("journal-depression") || "",
      "anxiety": data.get("journal-anxiety") || "",
      "description": data.get("journal-description") || "",
      "gratitude": data.get("journal-gratitude") || "",
      "reflection": data.get("journal-reflection") || "",
    };
    const parsed = { headers: REQUIRED.diary, rows: [row] };
    try {
      if (editingEntry.kind === "diary" && editingEntry.idx !== null) {
        // Update existing
        const rows = [...dataStore.diary.rows];
        rows[editingEntry.idx] = row;
        await saveRows("diary", rows);
        setStatusMsg("Updated journal entry", true);
        resetEditState();
      } else {
        // Create new
        await persist("diary", parsed, "journal form");
        setStatusMsg("Saved journal entry", true);
        form.reset();
        setDefaultDate();
      }
    } catch (err) {
      setStatusMsg(err.message || "Failed to save journal entry", false);
    }
  });
}

async function fetchExisting(kind, opts = {}) {
  const { silentAuthFail = false } = opts;
  const cfg = datasets[kind];
  try {
    const res = await apiFetch(`/api/files/${cfg.file}`);
    if (!isAuthed) return false;
    if (res.status === 401) {
      if (!silentAuthFail) setAuthStatus("Please log in to load data");
      const body = await res.text();
      setBackupError(`401 unauthorized loading ${cfg.file}\n${body}`);
      return false;
    }
    if (!res.ok) {
      const body = await res.text();
      setBackupError(`Error ${res.status} loading ${cfg.file}\n${body}`);
      return false;
    }
    const data = await res.json();
    if (data && data.rows && data.headers) {
      const normalized = normalizeDataset(data, kind);
      const sortedRows = sortRowsByDateTime(normalized.data.rows, normalized.data.headers);
      const updated = { ...normalized.data, rows: sortedRows };
      dataStore[kind] = updated;
      if (kind === "pain") {
        buildOptionCacheFromStore();
      }
      renderLog(kind);
      setStatus(kind, `Loaded ${updated.rows.length} rows from ${cfg.file}`, true, "logs");
      if (normalized.changed) {
        await persistNormalized(kind, dataStore[kind]);
      }
      if (kind === "pain") {
        renderPainOptionButtons();
      }
      renderDashboard();
      return true;
    }
  } catch (err) {
    console.warn("Load error", err);
  }
  return false;
}

async function ensureLoaded(kind) {
  if (dataStore[kind] && dataStore[kind].headers && dataStore[kind].rows) {
    return true;
  }
  if (!isAuthed) {
    const guest = loadGuestData();
    if (guest[kind]?.headers && guest[kind].rows) {
      dataStore[kind] = guest[kind];
      renderLog(kind);
      if (kind === "pain") {
        buildOptionCacheFromStore();
        renderPainOptionButtons();
      }
      renderDashboard();
      return true;
    }
    return false;
  }
  return fetchExisting(kind);
}

function parseXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        resolve(workbook);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

function sheetToDataset(sheet) {
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet);
  if (!rows || !rows.length) return null;
  const headers = Object.keys(rows[0]);
  const normalizedRows = rows.map((row) => {
    const clean = {};
    headers.forEach((h) => { clean[h] = row[h] ?? ""; });
    return clean;
  });
  return { headers, rows: normalizedRows };
}

function datasetToSheet(dataset) {
  if (!dataset?.headers || !dataset.rows) return XLSX.utils.json_to_sheet([]);
  const objs = dataset.rows.map((row) => {
    const obj = {};
    dataset.headers.forEach((h) => { obj[h] = row[h] ?? ""; });
    return obj;
  });
  return XLSX.utils.json_to_sheet(objs);
}

function setStatus(kind, message, ok = false, target = "logs") {
  const el = target === "import" ? datasets[kind].statusImport : datasets[kind].statusLog;
  if (!el) return;
  el.innerHTML = message ? `<span class="${ok ? "ok" : "err"}">${ok ? "OK" : "Error"}:</span> ${message}` : "";
}

function setBackupStatus(message, ok = false) {
  if (!backupUI.status) return;
  backupUI.status.innerHTML = message
    ? `<span class="${ok ? "ok" : "err"}">${ok ? "OK" : "Error"}:</span> ${escapeHtml(message)}`
    : "";
  if (backupUI.errorBox && ok) {
    backupUI.errorBox.classList.add("hidden");
    backupUI.errorBox.textContent = "";
  }
}

function setBackupError(message) {
  if (!backupUI.errorBox) return;
  backupUI.errorBox.textContent = message || "";
  backupUI.errorBox.classList.toggle("hidden", !message);
}

function setMistralStatus(message, ok = false) {
  if (!mistralUI.status) return;
  mistralUI.status.innerHTML = message
    ? `<span class="${ok ? "ok" : "err"}">${ok ? "Saved" : "Error"}:</span> ${escapeHtml(message)}`
    : "";
}

function normalizePrefs(raw = {}) {
  const allowedModels = ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"];
  const next = { ...defaultPrefs, ...(typeof raw === "object" && raw ? raw : {}) };
  if (!allowedModels.includes(next.model)) next.model = defaultPrefs.model;
  const allowedRanges = ["30", "90", "365", "all"];
  if (!allowedRanges.includes(next.chatRange)) next.chatRange = defaultPrefs.chatRange;
  if (!allowedRanges.includes(next.lastRange)) next.lastRange = defaultPrefs.lastRange;
  if (!next.graphSelection || typeof next.graphSelection !== "object") {
    next.graphSelection = {};
  }
  return next;
}

async function savePrefs(update = {}, { applyRange = false } = {}) {
  prefs = normalizePrefs({ ...prefs, ...update });
  if (isAuthed) {
    try {
      await apiFetch(`/api/files/${PREFS_FILE}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
    } catch (err) {
      console.warn("Failed to save prefs", err);
    }
  }
  if (!isAuthed) {
    saveGuestPrefs(prefs);
  }
  applyPrefsToUi({ applyRange });
}

async function loadPrefsFromServer({ applyRange = false } = {}) {
  try {
    const res = await apiFetch(`/api/files/${PREFS_FILE}`);
    if (res.status === 401) {
      prefs = normalizePrefs(loadGuestPrefs());
      applyPrefsToUi({ applyRange });
      return false;
    }
    if (res.status === 404) {
      prefs = { ...defaultPrefs };
      applyPrefsToUi({ applyRange });
      if (isAuthed) {
        await savePrefs({}, { applyRange: false });
      }
      return true;
    }
    if (!res.ok) throw new Error(`Prefs load failed ${res.status}`);
    const data = await res.json();
    prefs = normalizePrefs(data);
    applyPrefsToUi({ applyRange });
    return true;
  } catch (err) {
    console.warn("Prefs load error", err);
    prefs = normalizePrefs(loadGuestPrefs());
    applyPrefsToUi({ applyRange });
    return false;
  }
}

function applyPrefsToUi({ applyRange = false } = {}) {
  // Sync graph selection state with prefs
  Object.keys(graphSelectionState).forEach((k) => delete graphSelectionState[k]);
  if (prefs.graphSelection && typeof prefs.graphSelection === "object") {
    Object.entries(prefs.graphSelection).forEach(([k, v]) => {
      if (v && typeof v === "object") {
        graphSelectionState[k] = { ...v };
      }
    });
  }
  if (!isAuthed) {
    saveGuestPrefs(prefs);
  }
  syncModelSelect();
  syncChatRangeButtons();
  if (applyRange) {
    applyQuickRange(prefs.lastRange || defaultPrefs.lastRange, true);
  }
}

function loadModelChoice() {
  return prefs.model || defaultPrefs.model;
}

function saveModelChoice(value) {
  savePrefs({ model: value });
}

function loadChatRange() {
  return prefs.chatRange || defaultPrefs.chatRange;
}

function saveChatRange(value) {
  savePrefs({ chatRange: value }, { applyRange: false });
}

function syncChatRangeButtons() {
  const current = loadChatRange();
  document.querySelectorAll(".chat-range-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === current);
  });
}

function syncModelSelect() {
  const val = loadModelChoice();
  if (mistralUI.modelSelect) {
    mistralUI.modelSelect.value = val;
  }
}

function updateMistralUi(state = { hasKey: false, last4: "" }) {
  const hasKey = !!state.hasKey && isAuthed;
  const last4 = state.last4 || "";
  if (mistralUI.helper) {
    mistralUI.helper.textContent = hasKey
      ? `Mistral API key stored on server${last4 ? ` (ending ${last4})` : ""}.`
      : "No Mistral key saved. Paste one below to enable the chatbot.";
  }
  // Hide helper text if alert is visible (avoid redundancy)
  if (chatbotUI.helper) {
    chatbotUI.helper.classList.toggle("hidden", !hasKey);
    chatbotUI.helper.textContent = hasKey ? "Ask anything about your diary and pain logs." : "";
  }
  // Show/hide the prominent key-missing alert
  if (chatbotUI.keyAlert) {
    chatbotUI.keyAlert.classList.toggle("hidden", hasKey);
  }
  if (chatbotUI.sendBtn) {
    chatbotUI.sendBtn.disabled = !hasKey;
    chatbotUI.sendBtn.title = hasKey ? "" : "Log in and save your Mistral key in Settings first";
  }
}

async function refreshMistralKeyState({ silent = false } = {}) {
  if (!isAuthed) {
    mistralState = { hasKey: false, last4: "" };
    updateMistralUi(mistralState);
    if (!silent) setMistralStatus("Log in to manage your Mistral key", false);
    return;
  }
  try {
    const res = await apiFetch("/api/files/ai-key");
    const data = await safeParseJson(res);
    if (!res.ok) {
      throw new Error((data && data.error) || "Failed to load Mistral key");
    }
    mistralState = {
      hasKey: !!data.has_key,
      last4: data.last4 || "",
    };
    updateMistralUi(mistralState);
    if (!silent) {
      setMistralStatus(mistralState.hasKey ? "Mistral key on file" : "No Mistral key saved yet", mistralState.hasKey);
    }
  } catch (err) {
    mistralState = { hasKey: false, last4: "" };
    updateMistralUi(mistralState);
    if (!silent) setMistralStatus(err.message || "Failed to load Mistral key", false);
  }
}

function wireMistralSettings() {
  // Wire chat range buttons first - they're in the chatbot section, not settings
  syncChatRangeButtons();
  document.querySelectorAll(".chat-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = btn.dataset.range || "all";
      saveChatRange(range);
      syncChatRangeButtons();
    });
  });

  if (!mistralUI.input) return;
  updateMistralUi(mistralState);
  syncModelSelect();
  if (mistralUI.modelSelect) {
    mistralUI.modelSelect.addEventListener("change", (e) => {
      saveModelChoice(e.target.value);
    });
  }
  mistralUI.saveBtn?.addEventListener("click", async () => {
    const key = mistralUI.input.value.trim();
    if (!key) {
      setMistralStatus("Paste a Mistral API key first", false);
      return;
    }
    try {
      const res = await apiFetch("/api/files/ai-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await safeParseJson(res);
      if (!res.ok) {
        throw new Error((data && data.error) || "Failed to save Mistral key");
      }
      mistralUI.input.value = "";
      setMistralStatus("Mistral API key saved server-side for your account", true);
      await refreshMistralKeyState({ silent: true });
    } catch (err) {
      setMistralStatus(err.message || "Failed to save Mistral key", false);
    }
  });
  mistralUI.clearBtn?.addEventListener("click", async () => {
    try {
      const res = await apiFetch("/api/files/ai-key", { method: "DELETE" });
      const data = await safeParseJson(res);
      if (!res.ok) {
        throw new Error((data && data.error) || "Failed to clear Mistral key");
      }
      setMistralStatus("Mistral API key cleared", true);
      await refreshMistralKeyState({ silent: true });
    } catch (err) {
      setMistralStatus(err.message || "Failed to clear Mistral key", false);
    }
  });
}

function wireLogFilters(kind) {
  const cfg = datasets[kind];
  if (!cfg?.logsTable) return;
  cfg.logsTable.querySelectorAll(".filter-input").forEach((input) => {
    const field = input.dataset.filterField;
    input.value = logFilters[kind]?.[field] || "";
    input.addEventListener("input", (e) => {
      logFilters[kind][field] = e.target.value || "";
      renderLog(kind);
    });
  });
}

function showPopup(message, ok = true) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.className = `toast ${ok ? "success" : "error"}`;
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => toast.classList.remove("show"), 2800);
}

function sortRowsByDateTime(rows, headers) {
  const dKey = findHeader(headers, "date") || "date";
  const tKey = findHeader(headers, "hour") || "hour";
  return [...rows].sort((a, b) => {
    const aDate = new Date(`${a?.[dKey] || ""}T${(a?.[tKey] || "00:00").slice(0, 5)}`);
    const bDate = new Date(`${b?.[dKey] || ""}T${(b?.[tKey] || "00:00").slice(0, 5)}`);
    const aTs = aDate.toString() === "Invalid Date" ? 0 : aDate.getTime();
    const bTs = bDate.toString() === "Invalid Date" ? 0 : bDate.getTime();
    return bTs - aTs;
  });
}

function sortRowsWithIndex(rows, headers) {
  const dKey = findHeader(headers, "date") || "date";
  const tKey = findHeader(headers, "hour") || "hour";
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const aDate = new Date(`${a.row?.[dKey] || ""}T${(a.row?.[tKey] || "00:00").slice(0, 5)}`);
      const bDate = new Date(`${b.row?.[dKey] || ""}T${(b.row?.[tKey] || "00:00").slice(0, 5)}`);
      const aTs = aDate.toString() === "Invalid Date" ? 0 : aDate.getTime();
      const bTs = bDate.toString() === "Invalid Date" ? 0 : bDate.getTime();
      return bTs - aTs;
    });
}

function collectNumericFields(kind, headers, row) {
  const defs = NUMERIC_FIELDS[kind] || [];
  const parts = [];
  defs.forEach((def) => {
    const key = findHeader(headers, def.key);
    if (!key) return;
    const raw = row?.[key];
    if (raw === null || raw === undefined || raw === "") return;
    const num = Number(raw);
    const value = Number.isFinite(num) ? num : raw;
    parts.push({ label: def.label, value });
  });
  return parts;
}

function renderTable(kind, headers, rows, withActions = false, limit = null) {
  const cfg = datasets[kind];
  const isLogView = withActions; // Usually true for the main log view

  if (!headers || !rows) {
    cfg.logsTable.innerHTML = "";
    return;
  }

  const sortedRows = sortRowsWithIndex(rows, headers);
  const globalFilter = (logFilters[kind]?.['global'] || "").toLowerCase();
  const filteredRows = sortedRows.filter(({ row }) => {
    if (!globalFilter) return true;
    return Object.values(row).some(v => String(v).toLowerCase().includes(globalFilter));
  });

  const displayRows = limit ? filteredRows.slice(0, limit) : filteredRows;

  // If it's the dashboard/preview, maybe keep it simple? But user asked for "logs of both apps". 
  // Assuming this replaces the main log tables.

  // Filter Inputs for main view
  let filterHtml = "";
  if (isLogView) {
    // Simplified filter: just one global search or maybe just date?
    // For now, let's keep the date range filter in dashboard, 
    // but here we might want a text filter provided by the existing filter inputs if we keep them.
    // But the card view makes per-column filtering hard.
    // Let's add a generic search input if needed, or rely on distinct filters.
    // The previous filter row had per-column inputs. 
    // Let's revert to a single "Search" input for simplicity in card view?
    // Or just skip filters for now as user didn't specify, but removing them might be bad.
    // I'll add a simple "Filter by content" input above the grid.

    filterHtml = `
         <div class="filter-bar">
             <input type="text" id="filter-${kind}" placeholder="Search logs..." style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text);">
         </div>`;
  }

  const gridHtml = `
        <div class="log-grid">
          ${displayRows.map(({ row, idx: originalIdx }) => {
    const dateKey = findHeader(headers, "date") || "date";
    const timeKey = findHeader(headers, "hour") || "hour";
    const dateStr = row[dateKey] || "No date";
    const timeStr = row[timeKey] || "";
    const numericFields = collectNumericFields(kind, headers, row);

    // Format nice date if possible
    let niceDate = dateStr;
    try {
      const d = new Date(dateStr);
      if (!isNaN(d)) niceDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) { }

    return `
              <div class="log-card">
                <div class="log-card-header">
                  <span>${escapeHtml(niceDate)}</span>
                  <span style="color:var(--accent);">${escapeHtml(timeStr)}</span>
                </div>
                ${numericFields.length ? `
                  <div class="log-card-meta">
                    ${numericFields.map(f => `
                      <div class="log-card-meta-row">
                        <span class="label">${escapeHtml(f.label)}:</span>
                        <strong>${escapeHtml(String(f.value))}</strong>
                      </div>
                    `).join("")}
                  </div>
                ` : ""}
                ${isLogView ? `
                <div class="log-card-actions">
                  <button class="mh-nav__btn small" data-edit-row="${originalIdx}" data-kind="${kind}" title="Edit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="mh-nav__btn danger small" data-delete-row="${originalIdx}" data-kind="${kind}" title="Delete">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
                ` : ''}
              </div>
            `;
  }).join("")}
        </div>
      `;

  cfg.logsTable.innerHTML = (isLogView ? filterHtml : "") + gridHtml;

  // Update count span in header
  const countSpanId = kind === 'pain' ? 'pain-count' : 'diary-count';
  const countSpan = document.getElementById(countSpanId);
  if (countSpan) {
    countSpan.textContent = `${displayRows.length} entries`;
  }

  if (isLogView) {
    // Wire search
    const searchInput = document.getElementById(`filter-${kind}`);
    if (searchInput) {
      // Restore filter value
      // We need a place to store this new single filter
      // Re-using logFilters[kind]['global'] for now?
      searchInput.value = logFilters[kind]?.['global'] || "";
      searchInput.addEventListener("input", (e) => {
        if (!logFilters[kind]) logFilters[kind] = {};
        logFilters[kind]['global'] = e.target.value;
        // We need to re-run renderTable, but renderTable uses logFilters to filter... 
        // I need to update the filter logic above to handle 'global'
        renderLog(kind);
      });
    }
    wireRowActions(kind);
  }
}

// Quick patch for global filter support in the filter block above
// I will replace the filter logic block in the next edit or include it here.
// Let's rewrite the filter block inside this function:
/*
  const globalFilter = (logFilters[kind]?.['global'] || "").toLowerCase();
  const filteredRows = sortedRows.filter(({ row }) => {
    if (!globalFilter) return true;
    // Search all values
    return Object.values(row).some(v => String(v).toLowerCase().includes(globalFilter));
  });
*/


function parseCSV(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        value += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        current.push(value);
        value = "";
      } else if (c === "\n") {
        current.push(value);
        rows.push(current);
        current = [];
        value = "";
      } else if (c === "\r") {
        continue;
      } else {
        value += c;
      }
    }
  }
  if (value !== "" || current.length) {
    current.push(value);
    rows.push(current);
  }
  const headers = rows.shift() || [];
  const objects = rows.filter(r => r.length && r.some(cell => cell.trim() !== "")).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h.trim()] = r[idx] ?? "");
    return obj;
  });
  return { headers, rows: objects };
}

async function handleFile(kind, file) {
  const cfg = datasets[kind];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.headers.length) throw new Error("No headers detected");
    const normalized = normalizeParsed(parsed, kind);
    const validateMsg = validateHeaders(kind, normalized.headers);
    if (validateMsg) throw new Error(validateMsg);
    const result = await persist(kind, normalized, file.name);
    setStatus(kind, `Imported ${result.added} new, ${result.skipped} existing (source: ${file.name})`, true, "import");
    showPopup(`Imported ${result.added} new, ${result.skipped} already present`, true);
  } catch (err) {
    setStatus(kind, err.message || "Failed to parse", false, "import");
    showPopup(err.message || "Import failed", false);
  }
}

function normalizeHeaderName(h) {
  return h
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/\u00a0/g, " ") // nbsp to space
    .replace(/[-_–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateHeaders(kind, headers) {
  const expected = REQUIRED[kind];
  if (!expected) return "";
  const normalized = headers.map(normalizeHeaderName);
  const set = new Set(normalized);
  const aliasMap = ALIASES[kind] || {};
  const missing = [];
  expected.forEach(req => {
    const aliases = aliasMap[req] || [req];
    const found = aliases.some(a => set.has(normalizeHeaderName(a)));
    if (!found) missing.push(req);
  });
  return missing.length ? `Missing columns for ${kind}: ${missing.join(", ")}` : "";
}

function findHeader(headers, target) {
  const wanted = normalizeHeaderName(target);
  for (const h of headers) {
    if (normalizeHeaderName(h) === wanted) return h;
  }
  return null;
}

function normalizeTimestamp(val) {
  const raw = String(val ?? "").trim();
  if (!raw) return "";
  const hasTime = raw.includes("T") || raw.includes(" ");
  if (hasTime) return raw.replace(" ", "T");
  return raw;
}

function normalizeRows(headers, rows, kind) {
  const createdKey = findHeader(headers, "created time");
  const fileKey = findHeader(headers, "file name");
  const dateKey = findHeader(headers, "date") || fileKey || createdKey || "date";
  const hourKey = findHeader(headers, "hour") || findHeader(headers, "time");
  const habitsKey = findHeader(headers, "habits");
  const goodKey = findHeader(headers, "good sleep");
  const healthyKey = findHeader(headers, "healthy food");
  const otherKey = findHeader(headers, "other");
  const flagDefs = [
    { key: findHeader(headers, ">6h day byte"), label: ">6h day byte" },
    { key: findHeader(headers, ">1h masturbation"), label: ">1h masturbation" },
    { key: findHeader(headers, "<1h masturbation"), label: "<1h masturbation" },
    { key: findHeader(headers, "cum"), label: "cum" },
  ];

  const allowed = kind && REQUIRED[kind] ? REQUIRED[kind] : null;
  const allowedNormalized = allowed ? allowed.map(normalizeHeaderName) : null;
  const cleanedHeaders = headers.filter((h) => {
    const norm = normalizeHeaderName(h);
    if (allowedNormalized) return allowedNormalized.includes(norm);
    return ![
      "created time",
      "file name",
      "date",
      "time",
      "hour",
      "habits",
      "good sleep",
      "healthy food",
      ">6h day byte",
      ">1h masturbation",
      "<1h masturbation",
      "cum",
    ].includes(norm);
  });
  const normalizedHeaders = [];
  const desiredOrder =
    allowed ||
    [
      "date",
      "hour",
      "pain level",
      "fatigue level",
      "symptoms",
      "area",
      "activities",
      "habits",
      "coffee",
      "other",
      "medicines",
      "note",
    ];
  [...desiredOrder, ...cleanedHeaders].forEach((h) => {
    const norm = normalizeHeaderName(h);
    if (!normalizedHeaders.some((x) => normalizeHeaderName(x) === norm)) {
      normalizedHeaders.push(h === "file name" ? "date" : h);
    }
  });

  let changed = normalizeHeaderName(createdKey || "") === "created time" || !!fileKey;
  const normalizedRows = (rows || []).map((row) => {
    const rawFile = fileKey ? row[fileKey] : "";
    const rawCreated = createdKey ? row[createdKey] : "";
    const rawDate = dateKey ? row[dateKey] : "";
    const rawHour = hourKey ? row[hourKey] : "";
    const rawHabits = habitsKey ? row[habitsKey] : "";
    const rawGood = goodKey ? row[goodKey] : "";
    const rawHealthy = healthyKey ? row[healthyKey] : "";

    const preferred = rawDate || rawFile || rawCreated || "";
    const normalizedValue = normalizeTimestamp(preferred);
    let datePart = normalizedValue;
    let hourPart = "";
    if (normalizedValue.includes("T")) {
      const [d, t] = normalizedValue.split("T");
      datePart = d;
      hourPart = (t || "").slice(0, 5);
    }
    if (!hourPart && rawHour) {
      hourPart = String(rawHour).slice(0, 5);
    }
    if (!hourPart) hourPart = "21:00";

    const next = { ...row, date: datePart, hour: hourPart };
    if (kind === "pain") {
      if (habitsKey) delete next[habitsKey];
      if (goodKey) delete next[goodKey];
      if (healthyKey) delete next[healthyKey];
      flagDefs.forEach((f) => {
        if (f.key && f.key in next) delete next[f.key];
      });
      if (otherKey && otherKey in next) delete next[otherKey];

      const habitTokens = new Set();
      const addTokens = (val) => {
        String(val || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s && !["false", "true", "yes", "1", "no", "0"].includes(s))
          .forEach((s) => habitTokens.add(s));
      };
      addTokens(rawHabits);
      addTokens(rawGood);
      addTokens(rawHealthy);
      const goodYes = habitTokens.has("good sleep") || /^yes|true|1$/i.test(String(rawGood || "").trim());
      const healthyYes =
        habitTokens.has("healthy food") || /^yes|true|1$/i.test(String(rawHealthy || "").trim());
      const habitList = [];
      if (goodYes) habitList.push("good sleep");
      if (healthyYes) habitList.push("healthy food");
      const extraHabits = Array.from(habitTokens).filter(
        (t) => t && t !== "good sleep" && t !== "healthy food"
      );
      if (extraHabits.length) habitList.push(...extraHabits);
      next["habits"] = habitList.join(", ");

      const otherTokens = new Set();
      const addOther = (label, val) => {
        const v = String(val || "").trim();
        if (!v) return;
        const lower = v.toLowerCase();
        if (["yes", "true", "1"].includes(lower)) {
          otherTokens.add(label);
        } else if (!["false", "no", "0"].includes(lower)) {
          otherTokens.add(v);
        }
      };
      flagDefs.forEach((f) => addOther(f.label, f.key ? row[f.key] : ""));
      if (otherKey) {
        String(row[otherKey] || "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && !["false", "true", "yes", "1", "no", "0"].includes(s.toLowerCase()))
          .forEach((s) => otherTokens.add(s));
      }
      next["other"] = Array.from(otherTokens).join(", ");
      if (allowedNormalized) {
        Object.keys(next).forEach((key) => {
          if (!allowedNormalized.includes(normalizeHeaderName(key))) {
            delete next[key];
          }
        });
      }
    } else if (allowedNormalized) {
      // strip any fields not in allowed when not pain
      Object.keys(next).forEach((key) => {
        if (!allowedNormalized.includes(normalizeHeaderName(key))) {
          delete next[key];
        }
      });
    }

    if (fileKey && fileKey in next) delete next[fileKey];
    if (createdKey && createdKey in next) delete next[createdKey];
    if (hourKey && hourKey !== "hour" && hourKey in next) delete next[hourKey];

    if (
      next.date !== rawDate ||
      (fileKey && rawFile && next.date !== rawFile) ||
      (createdKey && rawCreated && next.date !== rawCreated) ||
      next.hour !== rawHour ||
      (kind === "pain" && (next.habits !== rawHabits || next.other !== (otherKey ? row[otherKey] : "")))
    ) {
      changed = true;
    }
    return next;
  });
  return { headers: normalizedHeaders, rows: normalizedRows, changed };
}

function collectOptions(field) {
  const store = dataStore.pain;
  const options = new Set();
  if (store?.rows?.length) {
    const key = findHeader(store.headers, field) || field;
    store.rows.forEach((row) => {
      const val = row?.[key];
      if (!val) return;
      String(val)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !["true", "false", "yes", "no", "0", "1"].includes(s.toLowerCase()))
        .forEach((s) => options.add(s));
    });
  }
  return Array.from(options);
}

const logCollapsed = { diary: false, pain: false };
let editingState = { kind: null, idx: null, draft: null };

function renderLog(kind) {
  const data = dataStore[kind];
  if (!data?.headers || !data.rows) return;
  const wrap = datasets[kind]?.logsTable;
  renderTable(kind, data.headers, data.rows, true, null);
}

function renderOptionButtons(field, containerId, preselectAll = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const values = optionsCache[field] || [];
  if (!values.length) {
    el.innerHTML = `<span style="color:var(--muted); font-size:13px;">No ${field} options yet</span>`;
    return;
  }
  el.innerHTML = values
    .map(
      (v) =>
        `<button type="button" class="chip-btn${preselectAll ? " active" : ""}" data-value="${escapeHtml(
          v
        )}">${escapeHtml(v)}</button>`
    )
    .join("");
  el.querySelectorAll(".chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("active"));
  });
}

function wireRowActions(kind) {
  const cfg = datasets[kind];
  if (!cfg?.logsTable) return;
  cfg.logsTable.querySelectorAll("[data-edit-row]").forEach((btn) => {
    btn.onclick = () => editRow(kind, parseInt(btn.dataset.editRow, 10));
  });
  cfg.logsTable.querySelectorAll("[data-delete-row]").forEach((btn) => {
    btn.onclick = () => deleteRow(kind, parseInt(btn.dataset.deleteRow, 10));
  });
  cfg.logsTable.querySelectorAll("[data-save-row]").forEach((btn) => {
    // Obsolete
  });
  cfg.logsTable.querySelectorAll("[data-cancel-row]").forEach((btn) => {
    // Obsolete
  });

}

function sanitizeRowForHeaders(row, headers) {
  const clean = {};
  headers.forEach((h) => {
    clean[h] = row[h] ?? "";
  });
  return clean;
}

async function saveRows(kind, rows) {
  const headers = dataStore[kind]?.headers || REQUIRED[kind] || [];
  const normalized = normalizeRows(headers, rows, kind);
  const sortedRows = sortRowsByDateTime(normalized.rows, normalized.headers);
  const payload = {
    source: "manual edit",
    imported_at: new Date().toISOString(),
    headers: normalized.headers,
    rows: sortedRows,
  };
  dataStore[kind] = payload;
  if (kind === "pain") {
    buildOptionCacheFromStore();
  }
  if (!isAuthed) {
    saveGuestDataset(kind, dataStore[kind]);
    renderLog(kind);
    setStatus(kind, "Saved edits locally (not logged in)", true, "logs");
    renderDashboard();
    return;
  }
  const finalPayload = withPainOptions(kind, dataStore[kind]);
  try {
    const res = await apiFetch(`/api/files/${datasets[kind].file}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    });
    if (res.status === 401) throw new Error("Please log in to save");
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    dataStore[kind] = finalPayload;
    renderLog(kind);
    setStatus(kind, "Saved edits", true, "logs");
    if (kind === "pain") {
      buildOptionCacheFromStore();
      renderPainOptionButtons();
    }
    renderDashboard();
  } catch (err) {
    setStatus(kind, err.message || "Failed to save edits", false, "logs");
  }
}



// New editing state: tracks entry kind and index
let editingEntry = { kind: null, idx: null };

// Helper: Select options in a container by values string
function selectOptions(containerId, valuesString) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Deselect all first
  container.querySelectorAll(".chip-btn").forEach(btn => btn.classList.remove("active"));
  if (!valuesString) return;
  const values = String(valuesString).split(",").map(s => s.trim().toLowerCase());
  container.querySelectorAll(".chip-btn").forEach(btn => {
    if (values.includes(btn.dataset.value.toLowerCase())) {
      btn.classList.add("active");
    }
  });
}

function populatePainForm(row) {
  const form = document.getElementById("pain-form");
  if (!form) return;

  const dateKey = findHeader(Object.keys(row), "date") || "date";
  const timeKey = findHeader(Object.keys(row), "hour") || "hour";
  const dateVal = row[dateKey];
  const timeVal = row[timeKey];

  // Combine date + time for datetime-local input
  if (dateVal) {
    const time = timeVal || "21:00";
    const iso = `${dateVal}T${time.slice(0, 5)}`;
    const input = form.querySelector('input[name="pain-date"]');
    if (input) input.value = iso;
  }

  form.querySelector('input[name="pain-level"]').value = row["pain level"] || "";
  form.querySelector('input[name="fatigue-level"]').value = row["fatigue level"] || "";
  form.querySelector('textarea[name="pain-note"]').value = row["note"] || "";
  form.querySelector('input[name="coffee-count"]').value = row["coffee"] || "";

  selectOptions("area-options", row["area"]);
  selectOptions("symptoms-options", row["symptoms"]);
  selectOptions("activities-options", row["activities"]);
  selectOptions("medicines-options", row["medicines"]);
  selectOptions("habits-options", row["habits"]);
  selectOptions("other-options", row["other"]);
}

function populateJournalForm(row) {
  const form = document.getElementById("journal-form");
  if (!form) return;

  const dateKey = findHeader(Object.keys(row), "date") || "date";
  const timeKey = findHeader(Object.keys(row), "hour") || "hour";
  const dateVal = row[dateKey];
  const timeVal = row[timeKey];

  if (dateVal) {
    const time = timeVal || "21:00";
    const iso = `${dateVal}T${time.slice(0, 5)}`;
    const input = form.querySelector('input[name="journal-date"]');
    if (input) input.value = iso;
  }

  form.querySelector('input[name="journal-mood"]').value = row["mood level"] || "";
  form.querySelector('input[name="journal-depression"]').value = row["depression"] || "";
  form.querySelector('input[name="journal-anxiety"]').value = row["anxiety"] || "";
  form.querySelector('textarea[name="journal-description"]').value = row["description"] || "";
  form.querySelector('textarea[name="journal-gratitude"]').value = row["gratitude"] || "";
  form.querySelector('textarea[name="journal-reflection"]').value = row["reflection"] || "";
}

function editRow(kind, idx) {
  const rows = dataStore[kind]?.rows || [];
  const row = rows[idx];
  if (!row) return;

  editingEntry = { kind, idx };

  if (kind === "pain") {
    // Switch to Pain tab
    const btn = document.querySelector('button[data-entry="pain"]');
    if (btn) btn.click();
    populatePainForm(row);

    // UI updates
    const submitBtn = document.getElementById("pain-submit-btn");
    if (submitBtn) submitBtn.textContent = "Save Changes";
    const cancelBtn = document.getElementById("pain-cancel-btn");
    if (cancelBtn) cancelBtn.classList.remove("hidden");

    // Scroll to form
    const section = document.getElementById("newlog-section");
    if (section) section.classList.remove("hidden"); // ensure visible
    document.getElementById("pain-form").scrollIntoView({ behavior: "smooth", block: "center" });

  } else if (kind === "diary") {
    // Switch to Journal tab (via autotherapy)
    const autoBtn = document.getElementById("autotherapy-tab");
    if (autoBtn) autoBtn.click();
    const journalBtn = document.querySelector('button[data-autotherapy="journal"]');
    if (journalBtn) journalBtn.click();

    populateJournalForm(row);

    // UI updates
    const submitBtn = document.getElementById("journal-submit-btn");
    if (submitBtn) submitBtn.textContent = "Save Changes";
    const cancelBtn = document.getElementById("journal-cancel-btn");
    if (cancelBtn) cancelBtn.classList.remove("hidden");

    // Scroll to form
    const section = document.getElementById("newlog-section");
    if (section) section.classList.remove("hidden");
    document.getElementById("journal-form").scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function resetEditState() {
  editingEntry = { kind: null, idx: null };

  // Reset Pain UI
  const painSubmit = document.getElementById("pain-submit-btn");
  if (painSubmit) painSubmit.textContent = "Save new entry";
  const painCancel = document.getElementById("pain-cancel-btn");
  if (painCancel) painCancel.classList.add("hidden");
  document.getElementById("pain-form")?.reset();

  // Reset Journal UI
  const journalSubmit = document.getElementById("journal-submit-btn");
  if (journalSubmit) journalSubmit.textContent = "Save journal entry";
  const journalCancel = document.getElementById("journal-cancel-btn");
  if (journalCancel) journalCancel.classList.add("hidden");
  document.getElementById("journal-form")?.reset();

  // Reset chips
  document.querySelectorAll(".chip-btn.active").forEach(btn => btn.classList.remove("active"));
  // re-apply default if needed, or just clear

  // Trigger default date fill
  const painForm = document.getElementById("pain-form");
  if (painForm) {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const input = painForm.querySelector('input[name="pain-date"]');
    if (input) input.value = localIso;
  }
  const journalForm = document.getElementById("journal-form");
  if (journalForm) {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const input = journalForm.querySelector('input[name="journal-date"]');
    if (input) input.value = localIso;
  }
}

// Obsolete inline functions removed


function deleteRow(kind, idx) {
  const rows = dataStore[kind]?.rows || [];
  if (!rows[idx]) return;
  const ok = confirm(`Delete row #${idx + 1}?`);
  if (!ok) return;
  const newRows = rows.filter((_, i) => i !== idx);
  saveRows(kind, newRows);
}

function wireAutotherapyTabs() {
  const buttons = document.querySelectorAll("[data-autotherapy]");
  const panels = document.querySelectorAll("[data-autotherapy-panel]");
  const setActive = (key) => {
    buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.autotherapy === key));
    panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.autotherapyPanel !== key));
  };
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => setActive(btn.dataset.autotherapy));
  });
}

function renderPainOptionButtons() {
  renderOptionButtons("area", "area-options", false);
  renderOptionButtons("symptoms", "symptoms-options", false);
  renderOptionButtons("activities", "activities-options", false);
  renderOptionButtons("medicines", "medicines-options", true);
  renderOptionButtons("habits", "habits-options", false);
  renderOptionButtons("other", "other-options", false);
}

function renderOptionEditor(field) {
  const container = document.getElementById(`${field}-editor`);
  if (!container) return;
  const listContainer = document.getElementById(`${field}-options`);
  if (listContainer) listContainer.classList.add("hidden");
  const opts = optionsCache[field] || [];
  const listHtml = opts.length
    ? opts
      .map(
        (v) => `
            <div class="chip-editor-row">
              <span>${escapeHtml(v)}</span>
              <div class="chip-editor-actions">
                <button type="button" data-action="edit" data-value="${escapeHtml(v)}" data-field="${field}">Edit</button>
                <button type="button" data-action="delete" data-value="${escapeHtml(v)}" data-field="${field}">Delete</button>
              </div>
            </div>`
      )
      .join("")
    : `<div style="color:var(--muted); font-size:13px;">No ${escapeHtml(field)} options yet</div>`;
  container.innerHTML = `
        <div class="chip-editor-list">${listHtml}</div>
        <div class="chip-editor-add">
          <input type="text" placeholder="Add ${escapeHtml(field)}" data-new="${field}" />
          <button type="button" data-action="add" data-field="${field}">Add</button>
        </div>
      `;
  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleEditorAction(btn.dataset));
  });
}

function handleEditorAction(dataset) {
  const field = dataset.field;
  if (!field) return;
  const action = dataset.action;
  const current = optionsCache[field] || [];
  if (action === "add") {
    const input = document.querySelector(`input[data-new="${field}"]`);
    const val = input?.value?.trim();
    if (val) {
      optionsCache[field] = dedupe([...current, val]);
      removedOptions[field] = (removedOptions[field] || []).filter((v) => v !== val);
      input.value = "";
      renderOptionEditor(field);
      renderPainOptionButtons();
    }
  } else if (action === "delete") {
    const val = dataset.value;
    optionsCache[field] = current.filter((v) => v !== val);
    if (!removedOptions[field]) removedOptions[field] = [];
    if (!removedOptions[field].includes(val)) removedOptions[field].push(val);
    renderOptionEditor(field);
    renderPainOptionButtons();
  } else if (action === "edit") {
    const val = dataset.value;
    const next = prompt(`Rename ${field}`, val);
    if (next && next.trim()) {
      const trimmed = next.trim();
      optionsCache[field] = dedupe(current.map((v) => (v === val ? trimmed : v)));
      if (!removedOptions[field]) removedOptions[field] = [];
      if (!removedOptions[field].includes(val)) removedOptions[field].push(val);
      removedOptions[field] = removedOptions[field].filter((v) => v !== trimmed);
      renderOptionEditor(field);
      renderPainOptionButtons();
    }
  }
  persistOptionCache();
  const listContainer = document.getElementById(`${field}-options`);
  if (listContainer) listContainer.classList.add("hidden");
}

function wireOptionEditors() {
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.edit;
      if (!field) return;
      const editor = document.getElementById(`${field}-editor`);
      const listContainer = document.getElementById(`${field}-options`);
      if (!editor) return;
      const isHidden = editor.classList.contains("hidden");
      document.querySelectorAll(".chip-editor").forEach((ed) => ed.classList.add("hidden"));
      document.querySelectorAll(".chip-row").forEach((row) => row.classList.remove("hidden"));
      if (isHidden) {
        editor.classList.remove("hidden");
        if (listContainer) listContainer.classList.add("hidden");
        renderOptionEditor(field);
      }
    });
  });
}

function selectedOptions(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return [];
  return Array.from(el.querySelectorAll(".chip-btn.active")).map((btn) => btn.dataset.value || "");
}

function normalizeParsed(parsed, kind) {
  if (!parsed?.headers || !Array.isArray(parsed.rows)) return parsed;
  const result = normalizeRows(parsed.headers, parsed.rows, kind);
  return { headers: result.headers, rows: result.rows };
}

function normalizeDataset(data, kind) {
  if (!data?.headers || !Array.isArray(data.rows)) return { data, changed: false };
  const normalized = normalizeRows(data.headers, data.rows, kind);
  return {
    data: { ...data, headers: normalized.headers, rows: normalized.rows },
    changed: normalized.changed,
  };
}

function entryDateFromRow(row, headers) {
  const dateKey = findHeader(headers, "date") || "date";
  const timeKey = findHeader(headers, "hour") || "hour";
  const dateVal = (row?.[dateKey] || "").trim();
  const timeVal = (row?.[timeKey] || "").trim() || "21:00";
  if (!dateVal) return null;
  const d = new Date(`${dateVal}T${timeVal}`);
  return d.toString() === "Invalid Date" ? null : d;
}

function withPainOptions(kind, payload) {
  if (kind !== "pain") return payload;
  const optionsPayload = {
    options: optionFields.reduce((acc, field) => {
      acc[field] = Array.isArray(optionsCache[field]) ? [...optionsCache[field]] : [];
      return acc;
    }, {}),
    removed: optionFields.reduce((acc, field) => {
      acc[field] = Array.isArray(removedOptions[field]) ? [...removedOptions[field]] : [];
      return acc;
    }, {}),
  };
  return { ...payload, options: optionsPayload };
}

async function persistNormalized(kind, payload) {
  const cfg = datasets[kind];
  if (!cfg) return;
  if (!isAuthed) {
    if (kind === "pain") {
      dataStore.pain = payload;
    } else if (kind === "diary") {
      dataStore.diary = payload;
    }
    saveGuestDataset(kind, payload);
    return;
  }
  const finalPayload = withPainOptions(kind, payload);
  try {
    const res = await apiFetch(`/api/files/${cfg.file}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    });
    if (res.status === 401) throw new Error("Please log in to save");
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
  } catch (err) {
    console.warn("Failed to persist normalized data", err);
  }
}

async function saveDataset(kind, payload) {
  const normalized = normalizeRows(payload.headers || [], payload.rows || [], kind);
  const sorted = sortRowsByDateTime(normalized.rows, normalized.headers);
  const final = { headers: normalized.headers, rows: sorted, source: payload.source || "import", imported_at: new Date().toISOString() };
  dataStore[kind] = final;
  if (kind === "pain") {
    buildOptionCacheFromStore();
  }
  renderLog(kind);
  setStatus(kind, `Saved ${sorted.length} rows${isAuthed ? "" : " (local only, log in to sync)"}`, true, "logs");
  await persistNormalized(kind, dataStore[kind]);
  if (kind === "pain") {
    renderPainOptionButtons();
  }
  renderDashboard();
}

async function persist(kind, parsed, sourceName) {
  const cfg = datasets[kind];
  try {
    const normalizedIncoming = normalizeRows(parsed.headers, parsed.rows, kind);
    const existingNormalized = normalizeRows(
      dataStore[kind]?.headers || normalizedIncoming.headers,
      dataStore[kind]?.rows || [],
      kind
    );
    const mergedHeaders = Array.from(
      new Set([...(existingNormalized.headers || []), ...(normalizedIncoming.headers || [])])
    );
    const dateKey = findHeader(mergedHeaders, "date") || "date";
    const timeKey = findHeader(mergedHeaders, "hour") || "hour";
    const seen = new Set(
      existingNormalized.rows.map(r => `${r[dateKey] || ""}T${(r[timeKey] || "21:00").slice(0, 5)}`)
    );
    let added = 0;
    let skipped = 0;
    const mergedRows = [...existingNormalized.rows];

    normalizedIncoming.rows.forEach(r => {
      const stamp = `${(r[dateKey] || "").trim()}T${(r[timeKey] || "21:00").slice(0, 5)}`;
      if (!stamp.trim()) return;
      if (seen.has(stamp)) {
        skipped += 1;
      } else {
        seen.add(stamp);
        mergedRows.push(r);
        added += 1;
      }
    });

    const sortedRows = sortRowsByDateTime(mergedRows, mergedHeaders);
    const payload = {
      source: sourceName,
      imported_at: new Date().toISOString(),
      headers: mergedHeaders,
      rows: sortedRows,
    };
    dataStore[kind] = payload;
    if (kind === "pain") {
      buildOptionCacheFromStore();
    }
    if (!isAuthed) {
      saveGuestDataset(kind, dataStore[kind]);
      renderLog(kind);
      setStatus(kind, `Saved locally (${mergedRows.length} rows). Log in to sync.`, true, "import");
      setStatus(kind, `Updated ${mergedRows.length} rows from ${sourceName}`, true, "logs");
      renderDashboard();
      return { added, skipped };
    }
    const finalPayload = withPainOptions(kind, dataStore[kind]);
    const res = await apiFetch(`/api/files/${cfg.file}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    });
    if (res.status === 401) {
      throw new Error("Please log in to save");
    }
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    dataStore[kind] = finalPayload;
    renderLog(kind);
    setStatus(kind, `Saved to ${cfg.file} (${mergedRows.length} total rows)`, true, "import");
    setStatus(kind, `Updated ${mergedRows.length} rows from ${sourceName}`, true, "logs");
    renderDashboard();
    return { added, skipped };
  } catch (err) {
    console.error(err);
    setStatus(kind, err.message || "Failed to save", false, "import");
    throw err;
  }
}

function wireEntryTabs() {
  const buttons = document.querySelectorAll(".mh-entry-btn");
  const panels = document.querySelectorAll("[data-entry-panel]");
  const autotherapyTab = document.getElementById("autotherapy-tab");
  const setAutotherapyLabel = (key) => {
    if (!autotherapyTab) return;
    const arrow = key === "autotherapy" ? "▼" : "◀";
    autotherapyTab.textContent = `Autotherapy ${arrow}`;
  };
  const setActive = (key) => {
    if (!key) return;
    buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.entry === key));
    panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.entryPanel !== key));
    setAutotherapyLabel(key);
  };
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => setActive(btn.dataset.entry));
  });
  if (buttons.length) {
    const current =
      document.querySelector(".mh-entry-btn.active")?.dataset.entry
      || buttons[0].dataset.entry;
    setActive(current);
  }
  entryTabSetter = setActive;
}

function wirePainForm() {
  const form = document.getElementById("pain-form");
  const status = document.getElementById("pain-form-status");
  if (!form) return;

  const setStatus = (msg, ok = false) => {
    if (!status) return;
    status.innerHTML = msg ? `<span class="${ok ? "ok" : "err"}">${ok ? "Saved" : "Error"}:</span> ${escapeHtml(msg)}` : "";
  };

  const setDefaultDate = () => {
    const input = form.querySelector('input[name="pain-date"]');
    if (input && !input.value) {
      const now = new Date();
      const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      input.value = localIso;
    }
  };

  setDefaultDate();
  renderPainOptionButtons();

  const cancelBtn = document.getElementById("pain-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      resetEditState();
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const toParts = (val) => {
      const fallback = new Date();
      const parsed = val ? new Date(val) : fallback;
      const good = parsed.toString() !== "Invalid Date" ? parsed : fallback;
      const iso = new Date(good.getTime() - good.getTimezoneOffset() * 60000).toISOString();
      return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
    };
    const parts = toParts(data.get("pain-date"));
    const areas = selectedOptions("area-options").join(", ");
    const symptoms = selectedOptions("symptoms-options").join(", ");
    const activities = selectedOptions("activities-options").join(", ");
    const medicines = selectedOptions("medicines-options").join(", ");
    const other = selectedOptions("other-options").join(", ");
    const habits = selectedOptions("habits-options").join(", ");
    const row = {
      "date": parts.date,
      "hour": parts.time,
      "pain level": data.get("pain-level") || "",
      "fatigue level": data.get("fatigue-level") || "",
      "symptoms": symptoms,
      "area": areas,
      "activities": activities,
      "habits": habits,
      "coffee": data.get("coffee-count") || "",
      "other": other,
      "medicines": medicines,
      "note": data.get("pain-note") || "",
    };
    const parsed = { headers: REQUIRED.pain, rows: [row] };
    try {
      if (editingEntry.kind === "pain" && editingEntry.idx !== null) {
        // Update existing
        const rows = [...dataStore.pain.rows];
        rows[editingEntry.idx] = row;
        await saveRows("pain", rows);
        setStatus("Updated pain entry", true);
        resetEditState();
      } else {
        // Create new
        await persist("pain", parsed, "manual form");
        setStatus("Saved new pain entry", true);
        buildOptionCacheFromStore();
        renderPainOptionButtons();
        optionFields.forEach((field) => {
          const editor = document.getElementById(`${field}-editor`);
          if (editor && !editor.classList.contains("hidden")) renderOptionEditor(field);
        });
        form.reset();
        setDefaultDate();
      }
    } catch (err) {
      setStatus(err.message || "Failed to save pain entry", false);
    }
  });
}

function wireDropZones() {
  document.querySelectorAll('input[type="file"]').forEach(input => {
    input.addEventListener("change", (e) => {
      const kind = e.target.dataset.kind;
      const file = e.target.files?.[0];
      handleFile(kind, file);
    });


    const label = input.closest(".drop");
    label.addEventListener("dragover", (e) => { e.preventDefault(); label.classList.add("hover"); });
    label.addEventListener("dragleave", () => label.classList.remove("hover"));
    label.addEventListener("drop", (e) => {
      e.preventDefault();
      label.classList.remove("hover");
      const file = e.dataTransfer.files?.[0];
      handleFile(input.dataset.kind, file);
    });
  });
}

function wireBackup() {
  backupUI.importInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const toImport = ["diary", "pain"];
      for (const kind of toImport) {
        if (parsed[kind]?.headers && Array.isArray(parsed[kind].rows)) {
          await saveDataset(kind, parsed[kind]);
        }
      }
      setBackupStatus("Import completato", true);
    } catch (err) {
      setBackupStatus(err.message || "Import failed", false);
    } finally {
      e.target.value = "";
    }
  });

  backupUI.exportBtn?.addEventListener("click", async () => {
    try {
      await ensureLoaded("diary");
      await ensureLoaded("pain");
      const payload = {
        diary: dataStore.diary || { headers: REQUIRED.diary, rows: [] },
        pain: dataStore.pain || { headers: REQUIRED.pain, rows: [] },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "myhealth-backup.json";
      a.click();
      URL.revokeObjectURL(url);
      setBackupStatus("Backup esportato", true);
    } catch (err) {
      setBackupStatus(err.message || "Export failed", false);
    }
  });

  backupUI.purgeBtn?.addEventListener("click", async () => {
    const ok = confirm("Are you sure you want to delete all diary and pain data?");
    if (!ok) return;
    try {
      const emptyDiary = { headers: REQUIRED.diary, rows: [], source: "purge" };
      const emptyPain = { headers: REQUIRED.pain, rows: [], source: "purge" };
      await saveDataset("diary", emptyDiary);
      await saveDataset("pain", emptyPain);
      setBackupStatus("Dati azzerati", true);
    } catch (err) {
      setBackupStatus(err.message || "Purge failed", false);
    }
  });

  backupUI.importXlsx?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const wb = await parseXlsx(file);
      const diarySheet = sheetToDataset(wb.Sheets["diary"]);
      const painSheet = sheetToDataset(wb.Sheets["pain"]);
      if (diarySheet) await saveDataset("diary", diarySheet);
      if (painSheet) await saveDataset("pain", painSheet);
      setBackupStatus("Import XLSX completato", true);
    } catch (err) {
      setBackupStatus(err.message || "Import XLSX failed", false);
      setBackupError(err?.stack || err?.message || String(err));
    } finally {
      e.target.value = "";
    }
  });

  backupUI.exportXlsx?.addEventListener("click", async () => {
    try {
      await ensureLoaded("diary");
      await ensureLoaded("pain");
      const wb = XLSX.utils.book_new();
      const diarySheet = datasetToSheet(dataStore.diary || { headers: REQUIRED.diary, rows: [] });
      const painSheet = datasetToSheet(dataStore.pain || { headers: REQUIRED.pain, rows: [] });
      XLSX.utils.book_append_sheet(wb, diarySheet, "diary");
      XLSX.utils.book_append_sheet(wb, painSheet, "pain");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbout], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "myhealth-data.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      setBackupStatus("Export XLSX completato", true);
    } catch (err) {
      setBackupStatus(err.message || "Export XLSX failed", false);
      setBackupError(err?.stack || err?.message || String(err));
    }
  });
}

function appendChatMessage(role, text) {
  if (!chatbotUI.log) return;
  if (chatbotUI.log.firstElementChild?.classList.contains("mh-hint")) {
    chatbotUI.log.innerHTML = "";
  }
  const row = document.createElement("div");
  row.className = "chat-row";
  const roleEl = document.createElement("div");
  roleEl.className = "chat-role";
  roleEl.textContent = role;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  if (role === "Assistant") {
    bubble.innerHTML = formatAssistantMessage(text);
  } else {
    bubble.textContent = text;
  }
  row.appendChild(roleEl);
  row.appendChild(bubble);
  chatbotUI.log.appendChild(row);
  chatbotUI.log.scrollTop = chatbotUI.log.scrollHeight;
}

function formatAssistantMessage(text) {
  const escaped = escapeHtml(text || "");
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const paragraphs = withBold
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "<br>"))
    .map((p) => `<p>${p}</p>`)
    .join("");
  return paragraphs || "<p></p>";
}

function setChatLoading(isLoading) {
  if (!chatbotUI.loading) return;
  chatbotUI.loading.classList.toggle("hidden", !isLoading);
}

function wireChatbot() {
  if (!chatbotUI.sendBtn || !chatbotUI.prompt) return;
  updateMistralUi(mistralState);
  refreshMistralKeyState({ silent: true });
  let sending = false;
  let sendBtnBaseDisabled = chatbotUI.sendBtn.disabled;
  const setStatus = (msg) => {
    if (chatbotUI.status) chatbotUI.status.textContent = msg || "";
  };
  const toggleSending = (isSending) => {
    sending = isSending;
    if (isSending) {
      sendBtnBaseDisabled = chatbotUI.sendBtn.disabled;
      chatbotUI.sendBtn.disabled = true;
    } else {
      chatbotUI.sendBtn.disabled = sendBtnBaseDisabled;
    }
    chatbotUI.sendBtn.textContent = isSending ? "Sending..." : "Send";
    chatbotUI.prompt.disabled = isSending;
    setChatLoading(isSending);
  };
  const sendMessage = async () => {
    if (chatbotUI.sendBtn.disabled) {
      if (chatbotUI.status) chatbotUI.status.textContent = "Save your Mistral API key in Settings first.";
      return;
    }
    const prompt = chatbotUI.prompt.value.trim();
    if (!prompt) {
      setStatus("Enter a question first.");
      return;
    }
    if (sending) return;
    setStatus("");
    appendChatMessage("You", prompt);
    chatbotUI.prompt.value = "";
    try {
      toggleSending(true);
      const model = loadModelChoice();
      const range = loadChatRange();
      const res = await apiFetch("/api/files/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, model, range }),
      });
      const data = await safeParseJson(res);
      if (res.status === 401) {
        setStatus("Please log in to chat.");
        return;
      }
      if (res.status === 400 && data?.error === "no mistral key saved") {
        setStatus("Save your Mistral key in Settings first.");
        return;
      }
      if (!res.ok) {
        const detail = typeof data === "object" ? data?.detail || data?.error : "";
        throw new Error(detail || (data && data.error) || `Server error ${res.status}`);
      }
      const reply = data?.reply || "No answer.";
      if (data?.fallback) {
        setStatus(`Fallback response (LLM unavailable: ${data?.detail || "unknown error"})`);
      } else {
        setStatus("");
      }
      appendChatMessage("Assistant", reply);
    } catch (err) {
      appendChatMessage("Assistant", "Sorry, I could not complete that request.");
      setStatus(err.message || "Chat failed");
      return;
    }
    finally {
      toggleSending(false);
    }
  };
  chatbotUI.sendBtn.addEventListener("click", sendMessage);
  chatbotUI.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Ctrl/Cmd+Enter will insert a newline by default
  });
  // Wire up the "Settings" link in the key-missing alert
  if (chatbotUI.goSettingsLink) {
    chatbotUI.goSettingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      const settingsBtn = document.querySelector('.mh-nav__btn[data-target="settings"]');
      if (settingsBtn) settingsBtn.click();
    });
  }
}

function wireNav() {
  const buttons = document.querySelectorAll(".mh-nav__btn[data-target]");
  const sections = {
    dashboard: document.getElementById("dashboard-section"),
    newlog: document.getElementById("newlog-section"),
    chatbot: document.getElementById("chatbot-section"),
    settings: document.getElementById("settings-section"),
  };
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      buttons.forEach(b => b.classList.toggle("active", b === btn));
      Object.entries(sections).forEach(([key, el]) => {
        if (el) {
          el.classList.toggle("hidden", key !== target);
        }
      });
      if (target === "newlog" && entryTabSetter) {
        const current = document.querySelector(".mh-entry-btn.active")?.dataset.entry
          || document.querySelector(".mh-entry-btn")?.dataset.entry;
        entryTabSetter(current);
      }
    });
  });
}

function getDateRange() {
  const fromInput = document.getElementById("filter-from");
  const toInput = document.getElementById("filter-to");
  const fromVal = fromInput?.value ? new Date(fromInput.value) : null;
  const toVal = toInput?.value ? new Date(toInput.value) : null;
  return {
    from: fromVal && !isNaN(fromVal) ? fromVal : null,
    to: toVal && !isNaN(toVal) ? toVal : null,
  };
}

function previousRange(range) {
  if (!range?.from) return null;
  const to = range.to && !isNaN(range.to) ? range.to : new Date();
  const duration = to.getTime() - range.from.getTime();
  if (duration <= 0) return null;
  const prevTo = new Date(range.from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - duration);
  return { from: prevFrom, to: prevTo };
}

function renderDashboard() {
  closeEmojiPicker();
  const container = document.getElementById("dash-cards");
  const graphs = document.getElementById("dash-graphs");
  if (!container || !graphs) return;
  const range = getDateRange();
  const diary = applyDateFilter(dataStore.diary, range);
  const pain = applyDateFilter(dataStore.pain, range);
  const prevRange = previousRange(range);
  const diaryPrev = prevRange ? applyDateFilter(dataStore.diary, prevRange) : null;
  const painPrev = prevRange ? applyDateFilter(dataStore.pain, prevRange) : null;

  const diaryCount = diary?.rows?.length || 0;
  const painCount = pain?.rows?.length || 0;
  const diaryMoodAvg = avgField(diary, "mood level");
  const diaryDepAvg = avgField(diary, "depression");
  const diaryAnxAvg = avgField(diary, "anxiety");
  const painLevelAvg = avgField(pain, "pain level");
  const fatigueAvg = avgField(pain, "fatigue level");
  const diaryPrevCount = diaryPrev?.rows?.length ?? null;
  const painPrevCount = painPrev?.rows?.length ?? null;
  const diaryPrevMoodAvg = avgField(diaryPrev, "mood level");
  const diaryPrevDepAvg = avgField(diaryPrev, "depression");
  const diaryPrevAnxAvg = avgField(diaryPrev, "anxiety");
  const painPrevLevelAvg = avgField(painPrev, "pain level");
  const fatiguePrevAvg = avgField(painPrev, "fatigue level");

  const cards = [
    { label: "Journal entries", value: diaryCount, prev: diaryPrevCount },
    { label: "Pain entries", value: painCount, prev: painPrevCount },
    { label: "Mood avg", value: diaryMoodAvg ?? "–", prev: diaryPrevMoodAvg },
    { label: "Depression avg", value: diaryDepAvg ?? "–", prev: diaryPrevDepAvg },
    { label: "Anxiety avg", value: diaryAnxAvg ?? "–", prev: diaryPrevAnxAvg },
    { label: "Pain avg", value: painLevelAvg ?? "–", prev: painPrevLevelAvg },
    { label: "Fatigue avg", value: fatigueAvg ?? "–", prev: fatiguePrevAvg },
  ].map((c) => ({ ...c, emoji: cardEmojiMap[c.label] || "📊" }));

  container.innerHTML = cards
    .map((c) => {
      const delta = calcDelta(c.value, c.prev, c.label);
      const deltaHtml = delta ? `<span class="delta ${delta.cls}">${escapeHtml(delta.text)}</span>` : "";
      return `
            <div class="dash-card">
              <div class="dash-emoji" data-label="${escapeHtml(c.label)}">${escapeHtml(c.emoji)}</div>
              <div class="dash-divider"></div>
              <div class="dash-meta">
                <div class="dash-label">${escapeHtml(c.label)}</div>
                <div class="dash-value">${escapeHtml(c.value)}${deltaHtml}</div>
              </div>
            </div>
          `;
    })
    .join("");

  const graphDefs = [
    {
      id: "graph-wellbeing",
      title: "Metrics over time",
      yLabel: "Level",
      series: [
        { key: "pain", label: "Pain", color: "#ff6f91", data: timeSeries(pain, "pain level") },
        { key: "fatigue", label: "Fatigue", color: "#f6c344", data: timeSeries(pain, "fatigue level") },
        { key: "mood", label: "Mood", color: "#7bd3f1", data: timeSeries(diary, "mood level") },
        { key: "depression", label: "Depression", color: "#c6a1ff", data: timeSeries(diary, "depression") },
        { key: "anxiety", label: "Anxiety", color: "#6fe1b0", data: timeSeries(diary, "anxiety") },
      ],
    },
  ];

  graphs.innerHTML = graphDefs
    .map((g) => {
      const selection = graphSelectionState[g.id] || {};
      const togglesHtml = g.series
        .map((s) => {
          const hasData = Array.isArray(s.data) && s.data.length > 0;
          const preferred = selection[s.key];
          const isChecked = preferred === undefined ? true : !!preferred;
          const checkedAttr = hasData && isChecked ? "checked" : "";
          const disabledAttr = hasData ? "" : "disabled";
          const disabledClass = hasData ? "" : " is-disabled";
          const title = hasData ? "" : "No data for this metric";
          return `
                        <label class="series-toggle${disabledClass}" data-series="${s.key}" aria-disabled="${hasData ? "false" : "true"}" style="--toggle-color:${s.color || "#ff5e8a"}" title="${title}">
                          <input type="checkbox" data-series="${s.key}" ${checkedAttr} ${disabledAttr} />
                          <span class="series-slider"></span>
                          <span class="series-label">${escapeHtml(s.label)}</span>
                        </label>
                      `;
        })
        .join("");
      return `
            <div class="graph-card">
              <div class="graph-title">
                <span class="graph-heading">${escapeHtml(g.title)}</span>
                <div class="graph-toggles" data-toggle-for="${g.id}">
                  ${togglesHtml}
                </div>
              </div>
              <canvas id="${g.id}"></canvas>
            </div>
          `;
    })
    .join("");

  container.querySelectorAll(".dash-emoji").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const label = el.getAttribute("data-label");
      if (label) openEmojiPicker(label, el);
    });
  });

  graphDefs.forEach((g, idx) => {
    const canvas = document.getElementById(g.id);
    const toggles = Array.from(document.querySelectorAll(`.graph-toggles[data-toggle-for="${g.id}"] input[type="checkbox"]`));
    const ensureGraphSelection = () => {
      if (!graphSelectionState[g.id]) graphSelectionState[g.id] = {};
      return graphSelectionState[g.id];
    };
    const saveSelection = (seriesKey, value) => {
      const state = ensureGraphSelection();
      state[seriesKey] = value;
      persistGraphSelection();
    };
    const renderVisibleSeries = () => {
      const activeSeries = g.series.filter((s) => {
        const toggle = toggles.find((t) => t.dataset.series === s.key);
        return toggle ? toggle.checked : true;
      });
      drawLineChart(canvas, activeSeries, idx, { yLabel: g.yLabel, allSeries: g.series });
    };
    toggles.forEach((input) =>
      input.addEventListener("change", () => {
        saveSelection(input.dataset.series, input.checked);
        renderVisibleSeries();
      })
    );
    renderVisibleSeries();
  });
}

function avgField(store, field) {
  if (!store?.rows?.length) return null;
  const key = findHeader(store.headers, field) || field;
  let sum = 0;
  let count = 0;
  store.rows.forEach((row) => {
    const val = parseFloat(row[key]);
    if (!Number.isNaN(val)) {
      sum += val;
      count += 1;
    }
  });
  if (!count) return null;
  return parseFloat((sum / count).toFixed(2));
}

function calcDelta(current, previous, label = "") {
  const curNum = toNumber(current);
  const prevNum = toNumber(previous);
  if (curNum === null || prevNum === null || prevNum === 0) return null;
  const pct = ((curNum - prevNum) / prevNum) * 100;
  const lowerLabel = (label || "").toLowerCase();
  // Invert logic for negative things: Depression, Anxiety, Pain avg, Fatigue avg
  // Note: "Pain entries" is activity (good/neutral), so we specifically target "pain avg"
  const invert =
    lowerLabel.includes("depression") ||
    lowerLabel.includes("anxiety") ||
    lowerLabel.includes("pain avg") ||
    lowerLabel.includes("fatigue avg");

  const positive = invert ? pct < 0 : pct > 0;
  const negative = invert ? pct > 0 : pct < 0;
  return {
    text: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`,
    cls: positive ? "positive" : negative ? "negative" : "neutral",
  };
}

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function timeSeries(store, field) {
  if (!store?.rows?.length) return [];
  const key = findHeader(store.headers, field) || field;
  return store.rows
    .map((row) => {
      const d = entryDateFromRow(row, store.headers);
      const v = parseFloat(row[key]);
      return { t: d, v };
    })
    .filter((p) => p.t && p.t.toString() !== "Invalid Date" && !Number.isNaN(p.v))
    .sort((a, b) => a.t - b.t);
}

const graphMeta = {};
const graphSelectionState = {};

function loadGuestData() {
  try {
    const raw = localStorage.getItem(GUEST_DATA_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch (err) {
    return {};
  }
}

function saveGuestDataset(kind, payload) {
  try {
    const guest = loadGuestData();
    guest[kind] = payload;
    localStorage.setItem(GUEST_DATA_KEY, JSON.stringify(guest));
  } catch (err) {
    console.warn("Failed to save guest data", err);
  }
}

function loadGuestPrefs() {
  try {
    const raw = localStorage.getItem(GUEST_PREFS_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch (err) {
    return {};
  }
}

function saveGuestPrefs(data) {
  try {
    localStorage.setItem(GUEST_PREFS_KEY, JSON.stringify(data || {}));
  } catch (err) {
    // ignore
  }
}

function persistGraphSelection() {
  // Clone to avoid mutating prefs.graphSelection when we clear graphSelectionState during UI sync
  const snapshot = JSON.parse(JSON.stringify(graphSelectionState));
  savePrefs({ graphSelection: snapshot });
}

function drawLineChart(canvas, seriesList, idx, opts = {}) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const width = (canvas.width = canvas.offsetWidth || 320);
  const height = (canvas.height = canvas.offsetHeight || 180);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, width, height);

  const allSeries = Array.isArray(opts.allSeries) ? opts.allSeries : seriesList || [];
  const desiredPoints = Math.max(10, Math.min(20, Math.floor((width || 320) / 40)));
  const visibleSeries = (seriesList || [])
    .filter((s) => Array.isArray(s?.data) && s.data.length)
    .map((s) => ({ ...s, data: bucketSeries(s.data, desiredPoints) }))
    .filter((s) => s.data.length);
  const hasAnyData = (allSeries || []).some((s) => Array.isArray(s?.data) && s.data.length);

  if (!visibleSeries.length) {
    ctx.fillStyle = "rgba(226,232,240,0.7)";
    ctx.font = "12px Manrope, sans-serif";
    ctx.fillText(hasAnyData ? "Toggle on a metric to see it" : "No data yet", 12, 22);
    graphMeta[canvas.id] = { points: [], yLabel: opts.yLabel || "Value", startTime: 0 };
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    return;
  }

  const defaults = ["#ff5e8a", "#f6c344", "#7bd3f1", "#c6a1ff", "#6fe1b0", "#ff8fb1"];
  const valuePoints = visibleSeries.flatMap((s) => s.data);
  const yBounds = getYBounds(opts.yLabel, valuePoints);
  const minY = yBounds.min;
  const maxY = yBounds.max;
  const allTimes = visibleSeries.flatMap((s) => s.data.map((pt) => pt.t.getTime()));
  const minX = Math.min(...allTimes);
  const maxX = Math.max(...allTimes);
  const pad = 28;
  const points = [];

  visibleSeries.forEach((s, seriesIdx) => {
    const stroke = s.color || defaults[seriesIdx % defaults.length];
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    const coords = s.data.map((pt) => {
      const x = scale(pt.t.getTime(), minX, maxX || minX + 1, pad, width - pad);
      const y = scale(pt.v, maxY === minY ? minY - 1 : minY, maxY === minY ? minY + 1 : maxY, height - pad, pad);
      const enriched = { x, y, ...pt, seriesKey: s.key, seriesLabel: s.label, color: stroke };
      points.push(enriched);
      return enriched;
    });
    drawSmoothPath(ctx, coords);
    ctx.fillStyle = stroke;
    s.data.forEach((pt) => {
      const x = scale(pt.t.getTime(), minX, maxX || minX + 1, pad, width - pad);
      const y = scale(pt.v, maxY === minY ? minY - 1 : minY, maxY === minY ? minY + 1 : maxY, height - pad, pad);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // axis ticks
  drawAxes(ctx, width, height, pad, minX, maxX, minY, maxY, valuePoints, minX);

  graphMeta[canvas.id] = { points, yLabel: opts.yLabel || "Value", startTime: minX };
  canvas.onmousemove = (e) => handleHover(canvas, e);
  canvas.onmouseleave = () => hideTooltip();
}

// Draw a smoothed path that passes through each point using Catmull-Rom splines.
function drawSmoothPath(ctx, coords) {
  if (!coords.length) return;
  if (coords.length === 1) {
    ctx.beginPath();
    ctx.moveTo(coords[0].x, coords[0].y);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  if (coords.length === 2) {
    ctx.lineTo(coords[1].x, coords[1].y);
  } else {
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i - 1] || coords[0];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || coords[i + 1];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }
  ctx.stroke();
}

function bucketSeries(data, maxPoints) {
  if (!Array.isArray(data) || data.length <= maxPoints) return data || [];
  const sorted = [...data].sort((a, b) => a.t - b.t);
  const minTs = sorted[0].t.getTime();
  const maxTs = sorted[sorted.length - 1].t.getTime();
  const span = Math.max(1, maxTs - minTs);
  const bucketSize = span / maxPoints;
  const buckets = Array.from({ length: maxPoints }, () => ({ sum: 0, count: 0, tsSum: 0, minTs: null, maxTs: null }));
  sorted.forEach((pt) => {
    const ts = pt.t.getTime();
    const idx = Math.min(maxPoints - 1, Math.floor((ts - minTs) / bucketSize));
    const b = buckets[idx];
    b.sum += pt.v;
    b.tsSum += ts;
    b.count += 1;
    b.minTs = b.minTs === null ? ts : Math.min(b.minTs, ts);
    b.maxTs = b.maxTs === null ? ts : Math.max(b.maxTs, ts);
  });
  return buckets
    .filter((b) => b.count > 0)
    .map((b, i) => {
      const avgTs = b.tsSum / b.count;
      const midTs = minTs + bucketSize * i + bucketSize / 2;
      const start = b.minTs ?? (minTs + bucketSize * i);
      const end = b.maxTs ?? (minTs + bucketSize * (i + 1));
      return {
        t: new Date(isFinite(avgTs) ? avgTs : midTs),
        v: b.sum / b.count,
        aggregated: b.count > 1,
        count: b.count,
        bucketStart: new Date(start),
        bucketEnd: new Date(end),
      };
    });
}

function scale(val, min, max, outMin, outMax) {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((val - min) / (max - min)) * (outMax - outMin);
}

function getYBounds(label, data) {
  if (!Array.isArray(data) || !data.length) return { min: 0, max: 10 };
  const values = data.map(d => d.v).filter((v) => Number.isFinite(v));
  if (!values.length) return { min: 0, max: 10 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const normLabel = (label || "").toLowerCase();
  const bounded = rawMin >= 0 && rawMax <= 10;
  const preset = bounded || ["pain", "fatigue", "mood", "depression", "anxiety"].some(k => normLabel.includes(k));
  let min = preset ? 0 : rawMin;
  let max = preset ? 10 : rawMax;
  if (!preset) {
    const pad = Math.max(1, (rawMax - rawMin) * 0.1);
    min = rawMin - pad;
    max = rawMax + pad;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function drawAxes(ctx, width, height, pad, minX, maxX, minY, maxY, data, startTs) {
  ctx.strokeStyle = "rgba(226,232,240,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, height - pad);
  ctx.lineTo(width - pad, height - pad);
  ctx.stroke();

  ctx.fillStyle = "rgba(226,232,240,0.7)";
  ctx.font = "10px Manrope, sans-serif";
  ctx.textAlign = "right";
  const yTicks = Math.max(3, Math.min(6, Math.floor(height / 70)));
  for (let i = 0; i <= yTicks; i++) {
    const v = minY + ((maxY - minY) * i) / yTicks;
    const y = scale(v, minY, maxY, height - pad, pad);
    ctx.fillText(v.toFixed(0), pad - 6, y + 3);
    ctx.strokeStyle = "rgba(226,232,240,0.08)";
    ctx.beginPath();
    ctx.moveTo(pad + 2, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const xLabels = pickXLabels(data, startTs, maxX, width - pad * 2);
  ctx.textAlign = "center";
  xLabels.forEach((lbl) => {
    const x = scale(lbl.time, minX, maxX || minX + 1, pad, width - pad);
    ctx.fillText(lbl.text, x, height - pad + 12);
    ctx.strokeStyle = "rgba(226,232,240,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, height - pad);
    ctx.lineTo(x, pad);
    ctx.stroke();
  });
}

function pickXLabels(data, startTs, endTs, usableWidth) {
  const labels = [];
  if (!data.length) return labels;
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const maxSteps = Math.max(2, Math.min(6, Math.floor((usableWidth || 300) / 140)));
  const steps = Math.max(2, maxSteps);
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const time = startTs + (endTs - startTs) * frac;
    labels.push({ time, text: formatter.format(new Date(time)) });
  }
  return labels;
}

function handleHover(canvas, evt) {
  const meta = graphMeta[canvas.id];
  if (!meta || !meta.points?.length) return hideTooltip();
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;
  let closest = null;
  let minDist = Infinity;
  meta.points.forEach((p) => {
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist < minDist) {
      minDist = dist;
      closest = p;
    }
  });
  if (!closest || minDist > 12) return hideTooltip();
  const tooltip = getTooltip();
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const isAvg = !!closest.aggregated;
  const valText = Number.isFinite(closest.v) ? parseFloat(closest.v.toFixed(isAvg ? 2 : 2)).toString() : closest.v;
  const hasRange = isAvg && closest.bucketStart instanceof Date && closest.bucketEnd instanceof Date;
  const startText = hasRange ? fmt.format(closest.bucketStart) : "";
  const endText = hasRange ? fmt.format(closest.bucketEnd) : "";
  const rangeText = hasRange ? (startText === endText ? startText : `${startText} – ${endText}`) : "";
  const aggLine = isAvg
    ? `<div style="color:${"var(--muted)"}; margin-top:2px;">Avg of ${closest.count || "multiple"} entries${rangeText ? ` (${escapeHtml(rangeText)})` : ""}</div>`
    : "";
  const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${closest.color || "var(--accent)"};"></span>`;
  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      ${dot}
      <strong style="color:${closest.color || "var(--text)"}">${escapeHtml(closest.seriesLabel || meta.yLabel)}</strong>
    </div>
    <div>${escapeHtml(meta.yLabel)}: ${escapeHtml(String(valText))}</div>
    ${aggLine}
  `;
  tooltip.style.left = `${evt.clientX + 12}px`;
  tooltip.style.top = `${evt.clientY + 12}px`;
  tooltip.style.opacity = "1";
}

function hideTooltip() {
  const t = document.getElementById("tooltip");
  if (t) t.style.opacity = "0";
}

function getTooltip() {
  let t = document.getElementById("tooltip");
  if (!t) {
    t = document.createElement("div");
    t.id = "tooltip";
    t.className = "tooltip";
    document.body.appendChild(t);
  }
  return t;
}

function setQuickActive(btn) {
  // Only affect dashboard quick buttons, not chatbot range buttons
  document.querySelectorAll(".mh-quick-btn:not(.chat-range-btn)").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
}

function clearQuickActive() {
  // Only affect dashboard quick buttons, not chatbot range buttons
  document.querySelectorAll(".mh-quick-btn:not(.chat-range-btn)").forEach(b => b.classList.remove("active"));
  savePrefs({ lastRange: defaultPrefs.lastRange }, { applyRange: false });
}

function toCSV(headers, rows) {
  const esc = (val) => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const head = headers.map(esc).join(",");
  const body = rows.map(r => headers.map(h => esc(r[h])).join(",")).join("\n");
  return `${head}\n${body}`;
}

function wireExport() {
  document.querySelectorAll("[data-export]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.export;
      const data = dataStore[kind];
      try {
        if (!data || !data.headers || !data.rows) {
          throw new Error("No data loaded yet. Import first.");
        }
        const blob = new Blob([toCSV(data.headers, data.rows)], { type: "text/csv;charset=utf-8" });
        const filename = `${kind}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showPopup(`Exported ${kind} as ${filename}`, true);
      } catch (err) {
        showPopup(err.message || "Export failed", false);
      }
    });
  });
}

function wirePurge() {
  document.querySelectorAll("[data-purge]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.purge;
      try {
        const confirmFirst = confirm(`Are you sure you want to purge all ${kind} data?`);
        if (!confirmFirst) return;
        const confirmSecond = confirm("This will remove all rows. Confirm purge?");
        if (!confirmSecond) return;
        const payload = {
          source: "purge",
          imported_at: new Date().toISOString(),
          headers: dataStore[kind]?.headers || REQUIRED[kind] || [],
          rows: [],
        };
        const res = await apiFetch(`/api/files/${datasets[kind].file}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) throw new Error("Please log in to purge");
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        dataStore[kind] = payload;
        renderTable(kind, payload.headers, payload.rows);
        setStatus(kind, "Purged all rows", true, "import");
        setStatus(kind, "Purged all rows", true, "logs");
        showPopup(`Purged ${kind} data`, true);
        renderDashboard();
      } catch (err) {
        showPopup(err.message || "Purge failed", false);
        setStatus(kind, err.message || "Purge failed", false, "import");
      }
    });
  });
}

async function restoreSessionIfPossible() {
  try {
    const res = await apiFetch("/api/files/session");
    const data = await safeParseJson(res);
    const authed = res.ok && data?.authed;
    setAuthVisibility(authed);
    setAppVisible(true);
    const loadedDiary = await fetchExisting("diary", { silentAuthFail: true });
    const loadedPain = await fetchExisting("pain", { silentAuthFail: true });
    if (loadedDiary || loadedPain) {
      await loadPrefsFromServer({ applyRange: true });
      await refreshMistralKeyState({ silent: true });
      renderDashboard();
    }
    if (!authed) {
      setAuthStatus("Browsing without login. Log in via the hub to load/save data.");
    }
    return authed;
  } catch (err) {
    setAppVisible(true);
    setAuthVisibility(false);
    setAuthStatus("Browsing without login. Log in via the hub to sync.");
    return false;
  }
}

function applyDateFilter(store, range = getDateRange()) {
  if (!store?.rows?.length) return store;
  const fromVal = range?.from instanceof Date ? range.from : null;
  const toVal = range?.to instanceof Date ? range.to : null;
  if (!fromVal && !toVal) return store;
  const filteredRows = store.rows.filter((row) => {
    const d = entryDateFromRow(row, store.headers);
    if (!d) return false;
    if (fromVal && d < fromVal) return false;
    if (toVal && d > toVal) return false;
    return true;
  });
  return { ...store, rows: filteredRows };
}

buildOptionCacheFromStore();
renderPainOptionButtons();
wireAuthForm();
wireEntryTabs();
wireAutotherapyTabs();
wirePainForm();
wireJournalForm();
wireOptionEditors();
wireNav();
wireMistralSettings();
wireChatbot();
wireBackup();
["filter-from", "filter-to"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", () => {
      clearQuickActive();
      renderDashboard();
    });
  }
});
function applyQuickRange(range, skipPersist = false) {
  const fromInput = document.getElementById("filter-from");
  const toInput = document.getElementById("filter-to");
  const today = new Date();
  const toStr = today.toISOString().slice(0, 10);
  if (range === "all") {
    if (fromInput) fromInput.value = "";
    if (toInput) toInput.value = "";
  } else {
    const days = parseInt(range, 10);
    const from = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
    const fromStr = from.toISOString().slice(0, 10);
    if (fromInput) fromInput.value = fromStr;
    if (toInput) toInput.value = toStr;
  }
  // Only select dashboard quick buttons, not chatbot range buttons
  const btn = document.querySelector(`.mh-quick-btn:not(.chat-range-btn)[data-range="${range}"]`);
  if (btn) setQuickActive(btn);
  if (!skipPersist) {
    savePrefs({ lastRange: range }, { applyRange: false });
  }
  renderDashboard();
}

// Only add dashboard event listeners to non-chatbot quick buttons
document.querySelectorAll(".mh-quick-btn:not(.chat-range-btn)").forEach((btn) => {
  btn.addEventListener("click", () => {
    const range = btn.dataset.range;
    applyQuickRange(range);
  });
});
setAuthVisibility(false);
setAppVisible(true);
resetAppState();
restoreSessionIfPossible();
applyQuickRange(defaultPrefs.lastRange, true);
