import { apiFetch, safeParseJson } from './api.js';
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyWithColor,
  formatPercentWithColor,
  randomColor,
  normalizeColor
} from './utils.js';

const primaryStorageKey = 'investments_state_v2';
    const legacyStorageKey = 'investments_transactions_v1';
    const STATE_FILE = 'money.json';

    let transactions = [];
    let monthlyMovements = [];
    let monthlySnapshots = [];

    const transactionSortState = { column: 'date', direction: 'desc' };

    const mmSortState = { column: 'amount', direction: 'desc' };

    let editingTransactionId = null;
    let editingMonthlyId = null;
    let assetChart = null;
    let assetPnlChart = null;
    let monthlyRiskChart = null;
    let assetColorMap = {};
    let assetRiskMap = {};
    // Hide zero-value assets by default; toggle via switch.
    let showZeroAssets = false;
    const defaultPreferences = { showZeroAssets: false };

    const authUI = {
      email: document.getElementById('auth-email'),
      pass: document.getElementById('auth-pass'),
      loginBtn: document.getElementById('auth-login'),
      logoutBtn: document.getElementById('auth-logout'),
      hubBtn: document.getElementById('go-hub'),
      status: document.getElementById('auth-status'),
    };
    const appMain = document.getElementById('app-main');
    let isAuthed = false;
    let serverSaveTimer = null;
    let lastQueuedState = null;

    function setAuthStatus(message, ok = false) {
      if (!authUI.status) return;
      authUI.status.innerHTML = message
        ? `<span class="${ok ? 'ok' : 'err'}">${ok ? 'OK' : 'Error'}:</span> ${message}`
        : '';
    }

    function setAuthVisibility(authed) {
      isAuthed = authed;
      const toHide = [authUI.email, authUI.pass, authUI.loginBtn, authUI.status];
      toHide.forEach(el => el?.classList.toggle('hidden', authed));
      authUI.logoutBtn?.classList.toggle('hidden', !authed);
      authUI.hubBtn?.classList.toggle('hidden', !authed);
      const card = document.querySelector('.auth-card');
      card?.classList.toggle('hidden', authed);
      if (!authed) setAuthStatus('');
    }

    function setAppVisible(authed) {
      if (appMain) appMain.classList.toggle('hidden', !authed);
    }

    function resetAppState() {
      transactions = [];
      monthlyMovements = [];
      monthlySnapshots = [];
      renderEverything();
    }

    async function doLogin() {
      const email = authUI.email?.value?.trim();
      const password = authUI.pass?.value || '';
      if (!email || !password) {
        setAuthStatus('Email and password required');
        return;
      }
      try {
        const res = await apiFetch('/api/files/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await safeParseJson(res);
        if (!res.ok) throw new Error((data && data.error) || (typeof data === 'string' ? data : '') || 'Login failed');
        setAuthVisibility(true);
        setAppVisible(true);
        setAuthStatus(`Logged in as ${data.email || email}`, true);
        if (authUI.pass) authUI.pass.value = '';
        await initApp();
      } catch (err) {
        setAuthStatus(err.message || 'Login failed');
      }
    }

    async function doLogout() {
      try {
        await apiFetch('/api/files/logout', { method: 'POST' });
      } catch (err) {
        // ignore
      }
      setAuthStatus('Logged out', true);
      resetAppState();
      setAppVisible(false);
      setAuthVisibility(false);
    }

function wireAuthForm() {
  authUI.loginBtn?.addEventListener('click', () => doLogin());
  authUI.logoutBtn?.addEventListener('click', () => doLogout());
  authUI.hubBtn?.addEventListener('click', () => {
    window.location.href = '/';
  });
}

    function defaultState() {
      return {
        transactions: [],
        monthlyMovements: [],
        monthlySnapshots: [],
        assetColors: {},
        assetRisks: {},
        preferences: { ...defaultPreferences },
      };
    }

    function normalizeState(raw) {
      const base = defaultState();
      if (Array.isArray(raw)) {
        base.transactions = raw;
        return base;
      }
      if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.transactions)) base.transactions = raw.transactions;
        if (Array.isArray(raw.monthlyMovements)) base.monthlyMovements = raw.monthlyMovements;
        if (Array.isArray(raw.monthlySnapshots)) base.monthlySnapshots = raw.monthlySnapshots;
        if (raw.assetColors && typeof raw.assetColors === 'object') base.assetColors = { ...raw.assetColors };
        if (raw.assetRisks && typeof raw.assetRisks === 'object') base.assetRisks = { ...raw.assetRisks };
        if (raw.preferences && typeof raw.preferences === 'object') {
          base.preferences = { ...base.preferences, ...raw.preferences };
          base.preferences.showZeroAssets = Boolean(base.preferences.showZeroAssets);
        }
      }
      return base;
    }

    function loadFromLocalStorage() {
      const fallback = normalizeState(null);

      const rawPrimary = localStorage.getItem(primaryStorageKey);
      if (rawPrimary) {
        try {
          return normalizeState(JSON.parse(rawPrimary));
        } catch (e) {
          console.error('invalid json in primary storage', e);
        }
      }

      const rawLegacy = localStorage.getItem(legacyStorageKey);
      if (rawLegacy) {
        try {
          const parsedLegacy = JSON.parse(rawLegacy);
          if (Array.isArray(parsedLegacy)) {
            return normalizeState(parsedLegacy);
          }
        } catch (e) {
          console.error('invalid json in legacy storage', e);
        }
      }

      return fallback;
    }

    function saveToLocalStorage(state) {
      localStorage.setItem(primaryStorageKey, JSON.stringify(state));
    }

    function getCurrentState() {
      return {
        transactions,
        monthlyMovements,
        monthlySnapshots,
        assetColors: assetColorMap,
        assetRisks: assetRiskMap,
        preferences: { showZeroAssets }
      };
    }

    async function loadStateFromServer() {
      const res = await apiFetch(`/api/files/${STATE_FILE}`, { cache: 'no-store' });
      if (res.status === 401) throw new Error('unauthorized');
      if (res.status === 404) return defaultState();
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      return normalizeState(data);
    }

    async function saveStateToServer(state) {
      try {
        const res = await apiFetch(`/api/files/${STATE_FILE}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        });
        if (res.status === 401) {
          setAuthStatus('Session expired. Please log in again.');
          setAuthVisibility(false);
          setAppVisible(false);
          resetAppState();
          return;
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
      } catch (err) {
        console.warn('Failed to save to server', err);
      }
    }

    async function loadState() {
      const localState = loadFromLocalStorage();
      try {
        const remote = await loadStateFromServer();
        saveToLocalStorage(remote);
        return remote;
      } catch (err) {
        if ((err.message || '').includes('unauthorized')) {
          throw err;
        }
        console.warn('API not reachable, using localStorage', err);
        return localState;
      }
    }

    function queueServerSave(state) {
      lastQueuedState = state;
      if (serverSaveTimer) clearTimeout(serverSaveTimer);
      serverSaveTimer = setTimeout(() => {
        serverSaveTimer = null;
        saveStateToServer(lastQueuedState);
      }, 200);
    }

    function saveState() {
      const state = getCurrentState();
      saveToLocalStorage(state);
      queueServerSave(state);
    }

    // ---------- DASHBOARD ----------
    function renderDashboard() {
      const totalInvested = transactions.reduce((sum, t) => sum + (t.currentValue || 0), 0);
      const totalPnl = transactions.reduce((sum, t) => sum + (t.pnl || 0), 0);
      document.getElementById('totalInvested').textContent = formatCurrency(totalInvested);
      document.getElementById('totalPnl').innerHTML = formatCurrencyWithColor(totalPnl);

      const assetSet = new Set();
      transactions.forEach(t => { if (t.asset) assetSet.add(t.asset); });
      document.getElementById('assetCount').textContent = String(assetSet.size);
      document.getElementById('txCount').textContent = String(transactions.length);

      const dates = transactions.map(t => t.date).filter(Boolean).sort();
      document.getElementById('lastTxDate').textContent = dates.length ? dates[dates.length - 1] : '-';
    }

    // ---------- TRANSAZIONI: SORT + FILTER ----------
    function getFilteredSortedTransactions() {
      const filtered = [...transactions];

      const { column, direction } = transactionSortState;
      filtered.sort((a, b) => {
        let va = a[column];
        let vb = b[column];

        if (column === 'buyValue' || column === 'currentValue' || column === 'pnl') {
          va = Number(va) || 0;
          vb = Number(vb) || 0;
        } else if (column === 'date') {
          va = a.date || '';
          vb = b.date || '';
        } else {
          va = (va || '').toString().toLowerCase();
          vb = (vb || '').toString().toLowerCase();
        }
        if (va < vb) return direction === 'asc' ? -1 : 1;
        if (va > vb) return direction === 'asc' ? 1 : -1;
        return 0;
      });

      return filtered;
    }

    function updateTransactionSortIndicators() {
      const ths = document.querySelectorAll('#page-transactions th[data-column]');
      ths.forEach(th => {
        const col = th.dataset.column;
        const span = th.querySelector('.sort-indicator');
        if (!span) return;
        if (col === transactionSortState.column) {
          span.textContent = transactionSortState.direction === 'asc' ? '▲' : '▼';
        } else {
          span.textContent = '';
        }
      });
    }

    function editTransaction(id) {
      const tx = transactions.find(t => t.id === id);
      if (!tx) return;
      const addForm = document.getElementById('addForm');
      if (!addForm) return;
      addForm.date.value = tx.date || '';
      addForm.asset.value = tx.asset || '';
      addForm.tipo.value = tx.tipo || 'nuovo vincolo';
      addForm.tipo.dispatchEvent(new Event('change'));
      addForm.buyValue.value = tx.buyValue ?? '';
      addForm.pnl.value = tx.pnl ?? '';
      addForm.note.value = tx.note || '';
      editingTransactionId = id;
      const submitBtn = document.getElementById('txSubmitButton');
      if (submitBtn) submitBtn.textContent = '✅ save changes';
      const cancelBtn = document.getElementById('txCancelEditButton');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      addForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function deleteTransaction(id) {
      if (!confirm('Delete this transaction?')) return;
      if (!confirm('Are you really sure? This cannot be undone.')) return;
      transactions = transactions.filter(x => x.id !== id);
      saveState();
      renderEverything();
      resetTransactionForm();
    }

    function editMonthlyMovement(id) {
      const m = monthlyMovements.find(x => x.id === id);
      if (!m) return;
      const form = document.getElementById('monthlyForm');
      if (!form) return;
      form.name.value = m.name || '';
      form.direction.value = m.direction || 'income';
      form.amount.value = m.amount || '';
      form.note.value = m.note || '';
      editingMonthlyId = id;
      const submitBtn = document.getElementById('monthlySubmitButton');
      if (submitBtn) submitBtn.textContent = '✅ save changes';
      const cancelBtn = document.getElementById('monthlyCancelEditButton');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function deleteMonthlyMovement(id) {
      if (!confirm('Delete this monthly movement?')) return;
      if (!confirm('Are you really sure? This cannot be undone.')) return;
      monthlyMovements = monthlyMovements.filter(x => x.id !== id);
      saveState();
      renderEverything();
      resetMonthlyForm();
    }


    function renderTable() {
      // Robust selector: target the wrapper directly
      const wrapper = document.querySelector('#page-transactions .list-wrap');
      if (!wrapper) return;

      const rows = getFilteredSortedTransactions();

      const gridHtml = `
        <div class="log-grid">
          ${rows.map(t => {
        const dateStr = t.date || '';
        let niceDate = dateStr;
        try {
          const d = new Date(dateStr);
          if (!isNaN(d)) niceDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        } catch (e) { }

        return `
              <div class="log-card">
                <div class="log-card-header">
                  <span>${escapeHtml(niceDate)}</span>
                  <span>${formatCurrencyWithColor(t.buyValue)}</span>
                </div>
                <div class="log-card-body">
                   <div>${escapeHtml(t.asset || 'No asset')}</div>
                   <div class="log-card-meta">${escapeHtml(t.tipo || '')}</div>
                </div>
                <div class="log-card-actions">
                  <button class="nav-button small edit-tx" data-id="${t.id}" title="Edit" style="padding:4px 8px;">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="nav-button danger small delete-tx" data-id="${t.id}" title="Delete" style="padding:4px 8px;">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            `;
      }).join('')}
        </div>
      `;

      if (wrapper) {
        wrapper.innerHTML = gridHtml;
        const countSpan = document.getElementById("txCountHeader");
        if (countSpan) countSpan.textContent = `${rows.length} transactions`;
        // Re-attach events (delegation or direct?)
        // The actions are wired via delegation or similar? 
        // Previous implementation: just innerHTML. 
        // Wait, 'edit-tx' and 'delete-tx' need listeners.
        // Where are listeners attached? 
        // I see 'wireRowActions' style logic? No, let's check code.
      }

      // I need to wire events for the new buttons
      const newContainer = wrapper || document.body; // Fallback
      newContainer.querySelectorAll('.edit-tx').forEach(btn =>
        btn.addEventListener('click', () => editTransaction(btn.dataset.id)));
      newContainer.querySelectorAll('.delete-tx').forEach(btn =>
        btn.addEventListener('click', () => deleteTransaction(btn.dataset.id)));
    }

    function resetTransactionForm() {
      const addForm = document.getElementById('addForm');
      if (!addForm) return;
      addForm.reset();
      addForm.tipo.value = 'nuovo vincolo';
      addForm.tipo.dispatchEvent(new Event('change'));
      const today = new Date().toISOString().slice(0, 10);
      if (addForm.date) addForm.date.value = today;
      editingTransactionId = null;
      const submitBtn = document.getElementById('txSubmitButton');
      if (submitBtn) submitBtn.textContent = '💾 save';
      const cancelBtn = document.getElementById('txCancelEditButton');
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    // ---------- MONTHLY MOVEMENTS: SORT + FILTER ----------
    function getFilteredSortedMonthlyMovements() {
      const filtered = [...monthlyMovements];

      const { column, direction } = mmSortState;
      filtered.sort((a, b) => {
        let va, vb;
        if (column === 'amount') {
          const sa = a.direction === 'expense' ? -(a.amount || 0) : (a.amount || 0);
          const sb = b.direction === 'expense' ? -(b.amount || 0) : (b.amount || 0);
          va = sa;
          vb = sb;
        } else {
          va = (a[column] || '').toString().toLowerCase();
          vb = (b[column] || '').toString().toLowerCase();
        }
        if (va < vb) return direction === 'asc' ? -1 : 1;
        if (va > vb) return direction === 'asc' ? 1 : -1;
        return 0;
      });

      return filtered;
    }

    function updateMmSortIndicators() {
      const ths = document.querySelectorAll('#page-monthly-movements th[data-mm-column]');
      ths.forEach(th => {
        const col = th.dataset.mmColumn;
        const span = th.querySelector('.sort-indicator');
        if (!span) return;
        if (col === mmSortState.column) {
          span.textContent = mmSortState.direction === 'asc' ? '▲' : '▼';
        } else {
          span.textContent = '';
        }
      });
    }

    function renderMonthlyMovements() {
      // Robust selector: target the wrapper directly
      const wrapper = document.querySelector('#page-monthly-movements .list-wrap');
      if (!wrapper) return;

      const income = monthlyMovements.reduce((sum, m) =>
        m.direction === 'income' ? sum + (m.amount || 0) : sum, 0);
      const expense = monthlyMovements.reduce((sum, m) =>
        m.direction === 'expense' ? sum + (m.amount || 0) : sum, 0);
      const net = income - expense;

      document.getElementById('mmIncome').innerHTML = formatCurrencyWithColor(income);
      document.getElementById('mmExpense').innerHTML = formatCurrencyWithColor(-expense);
      document.getElementById('mmNet').textContent = formatCurrency(net);

      const list = getFilteredSortedMonthlyMovements();

      const gridHtml = `
        <div class="log-grid">
          ${list.map(m => {
        const signedAmount = m.direction === 'expense' ? -m.amount : m.amount;
        return `
              <div class="log-card">
                <div class="log-card-header">
                  <span>${escapeHtml(m.name || 'Untitled')}</span>
                  <span>${formatCurrencyWithColor(signedAmount)}</span>
                </div>
                <div class="log-card-body">
                   <div class="log-card-meta">${escapeHtml(m.note || '')}</div>
                   <div class="log-card-meta">${m.direction === 'income' ? 'Entrata' : 'Uscita'}</div>
                </div>
                <div class="log-card-actions">
                  <button class="nav-button small edit-monthly" data-id="${m.id}" title="Edit" style="padding:4px 8px;">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="nav-button danger small delete-monthly" data-id="${m.id}" title="Delete" style="padding:4px 8px;">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            `;
      }).join('')}
        </div>
      `;

      if (wrapper) {
        wrapper.innerHTML = gridHtml;
        const countSpan = document.getElementById("mmCount");
        if (countSpan) countSpan.textContent = `${list.length} movements`;
      }

      const newContainer = wrapper || document.body;
      newContainer.querySelectorAll('.edit-monthly').forEach(btn =>
        btn.addEventListener('click', () => editMonthlyMovement(btn.dataset.id)));
      newContainer.querySelectorAll('.delete-monthly').forEach(btn =>
        btn.addEventListener('click', () => deleteMonthlyMovement(btn.dataset.id)));
    }

    // ---------- AGGREGAZIONE ASSET ----------
    function getAssetAggregation() {
      const byAsset = {};
      let totalCurrent = 0;

      transactions.forEach(t => {
        if (!t.asset) return;
        if (!byAsset[t.asset]) {
          byAsset[t.asset] = { buy: 0, current: 0, pnl: 0 };
        }
        byAsset[t.asset].buy += t.buyValue || 0;
        byAsset[t.asset].current += t.currentValue || 0;
        byAsset[t.asset].pnl += t.pnl || 0;
        totalCurrent += t.currentValue || 0;
      });

      const labels = Object.keys(byAsset);
      const data = labels.map(l => byAsset[l].current);
      return { byAsset, labels, data, totalCurrent };
    }

    // ---------- BLOCCHETTI + GRAFICI ----------
    function cycleAssetRisk(asset) {
      const current = assetRiskMap[asset] || 'low'; // Default to 'low' if not set
      const cycle = ['low', 'medium', 'high'];
      let nextRisk = 'low';
      if (cycle.includes(current)) {
        const i = cycle.indexOf(current);
        nextRisk = cycle[(i + 1) % cycle.length];
      }

      assetRiskMap[asset] = nextRisk;
      saveState(); // Assuming saveState() exists and saves assetRiskMap
      renderEverything(); // Assuming renderEverything() exists and re-renders all components
    }

    function renderAssetBlocks() {
      const container = document.getElementById('assetBlocks');
      if (!container) return;
      container.innerHTML = '';

      const { byAsset, labels, totalCurrent } = getAssetAggregation();
      if (!labels.length || totalCurrent === 0) return;

      const filteredLabels = showZeroAssets
        ? labels
        : labels.filter(asset => (byAsset[asset].current || 0) !== 0);

      const html = filteredLabels.map(asset => {
        const stats = byAsset[asset];
        const pct = (stats.current / totalCurrent) * 100;
        const profitPct = stats.buy > 0
          ? (stats.pnl / stats.buy) * 100
          : 0;

        // Color picker logic (existing)
        const color = assetColorMap[asset] || 'var(--accent)';
        const pickerId = `c-${asset.replace(/\s+/g, '-')}`;

        // Risk logic
        const risk = assetRiskMap[asset] || 'low'; // default to low as entry point
        const riskClass = risk;

        return `
          <div class="card asset-card" style="border-left: 4px solid ${color}; position: relative;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
               <h3 style="margin:0; color:${color}">${escapeHtml(asset)}</h3>
            </div>
            
            <div style="display:flex; align-items:center; gap: 8px; margin-top:4px;">
               <div class="risk-pill ${riskClass}" title="Click to toggle risk" data-risk-asset="${escapeHtml(asset)}">
                 risk: ${risk}
               </div>

               <input type="color" id="${pickerId}" value="${color}" 
                 class="color-picker-input"
                 title="Change color" />
            </div>

            <div style="margin-top:8px; font-size:13px; line-height:1.4;">
              <div style="color:var(--muted)">current value: <span style="color:var(--text); font-weight:bold;">${formatCurrency(stats.current)}</span></div>
              <div style="color:var(--muted)">invested: ${formatCurrency(stats.buy)}</div>
              <div style="color:var(--muted)">pnl: ${formatCurrencyWithColor(stats.pnl)}</div>
              <div style="color:var(--muted)">weight: ${pct.toFixed(1)}%</div>
              <div style="color:var(--muted)">profit %: ${formatPercentWithColor(profitPct)}</div>
            </div>
          </div>
        `;
      }).join('');

      container.innerHTML = html;

      // Re-attach color listeners and risk listeners
      filteredLabels.forEach(asset => {
        const pickerId = `c-${asset.replace(/\s+/g, '-')}`;
        const picker = document.getElementById(pickerId);
        if (picker) {
          picker.addEventListener('change', (e) => {
            assetColorMap[asset] = e.target.value;
            saveState();
            renderEverything();
          });
        }
      });

      container.querySelectorAll('.risk-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          const asset = pill.dataset.riskAsset;
          if (asset) cycleAssetRisk(asset);
        });
      });
    }

    function renderAssetChart() {
      const ctx = document.getElementById('assetAllocationChart');
      if (!ctx) return;
      const { labels, data, totalCurrent } = getAssetAggregation();
      if (assetChart) assetChart.destroy();

      const filteredLabels = showZeroAssets
        ? labels
        : labels.filter(label => (data[labels.indexOf(label)] || 0) !== 0);
      const filteredData = filteredLabels.map(label => data[labels.indexOf(label)] || 0);
      const filteredTotal = filteredData.reduce((sum, val) => sum + (val || 0), 0);

      if (!filteredLabels.length || filteredTotal === 0) {
        ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
        return;
      }

      const colors = filteredLabels.map(label => assetColorMap[label] || normalizeColor(randomColor(label)));
      filteredLabels.forEach((label, idx) => { assetColorMap[label] = colors[idx]; });

      assetChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: filteredLabels,
          datasets: [{ data: filteredData, backgroundColor: colors }]
        },
        options: {
          plugins: { legend: { display: false } }
        }
      });
    }

    function renderAssetPnlChart() {
      const ctx = document.getElementById('assetPnlChart');
      if (!ctx) return;
      const { byAsset, labels } = getAssetAggregation();
      if (assetPnlChart) assetPnlChart.destroy();

      const filteredLabels = showZeroAssets
        ? labels
        : labels.filter(label => (byAsset[label].current || 0) !== 0);

      if (!filteredLabels.length) {
        ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
        return;
      }

      filteredLabels.sort((a, b) => {
        const diff = (byAsset[b].pnl || 0) - (byAsset[a].pnl || 0);
        if (diff !== 0) return diff;
        return a.localeCompare(b);
      });

      const data = filteredLabels.map(l => byAsset[l].pnl || 0);
      const colors = filteredLabels.map(label => assetColorMap[label] || normalizeColor(randomColor(label)));
      filteredLabels.forEach((label, idx) => { assetColorMap[label] = colors[idx]; });

      assetPnlChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: filteredLabels,
          datasets: [{ data, backgroundColor: colors }]
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { display: false },
              grid: { display: false }
            },
            y: {
              ticks: {
                callback: value => formatCurrency(value)
              }
            }
          }
        }
      });
    }

    function updateZeroAssetsToggleLabel() {
      const btn = document.getElementById('toggleZeroAssetsButton');
      if (!btn) return;
      const label = btn.querySelector('.label');
      if (label) {
        label.textContent = showZeroAssets
          ? 'closed investments · visible'
          : 'closed investments · hidden';
      }
      btn.classList.toggle('active', showZeroAssets);
      btn.setAttribute('aria-pressed', showZeroAssets ? 'true' : 'false');
    }

    // ---------- MONTHLY REVIEW ----------
    function renderMonthlyReview(range = 'all') {

      let filtered = [...monthlySnapshots];
      if (range !== 'all') {
        const now = new Date();
        let cutoff;
        if (range === '3m') cutoff = new Date(now.setMonth(now.getMonth() - 3));
        else if (range === '6m') cutoff = new Date(now.setMonth(now.getMonth() - 6));
        else if (range === '1y') cutoff = new Date(now.setFullYear(now.getFullYear() - 1));
        else if (range === '3y') cutoff = new Date(now.setFullYear(now.getFullYear() - 3));
        else if (range === '10y') cutoff = new Date(now.setFullYear(now.getFullYear() - 10));
        if (cutoff) {
          filtered = filtered.filter(s => new Date(s.date) >= cutoff);
        }
      }

      filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const summary = document.getElementById('monthlySummary');
      if (summary) {
        const count = filtered.length;
        const last = count ? filtered[filtered.length - 1] : null;
        summary.innerHTML = count
          ? `Total snapshots: <strong>${count}</strong> • last: <strong>${last?.date || ''}</strong>`
          : 'loaded from <code>monthlySnapshots</code> (xlsx) – no data yet.';
      }

      const ctx = document.getElementById('monthlyRiskChart');
      if (!ctx) return;
      if (monthlyRiskChart) monthlyRiskChart.destroy();

      const labels = filtered.map(s => s.date || '');
      const lowData = filtered.map(s => s.low || 0);
      const mediumData = filtered.map(s => s.medium || 0);
      const highData = filtered.map(s => s.high || 0);
      const liquidData = filtered.map(s => s.liquid || 0);

      monthlyRiskChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'low', data: lowData, backgroundColor: '#74c0fc' },
            { label: 'medium', data: mediumData, backgroundColor: '#faa2c1' },
            { label: 'high', data: highData, backgroundColor: '#e599f7' },
            { label: 'liquid', data: liquidData, backgroundColor: '#51cf66' } // green for liquid
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { stacked: true },
            y: {
              stacked: true,
              ticks: { callback: value => formatCurrency(value) }
            }
          }
        }
      });
    }

    function inferTypeFromValues(buyValue, pnl) {
      if (buyValue === null || buyValue === undefined) {
        return pnl >= 0 ? 'return' : 'fee';
      }
      if (buyValue >= 0 && pnl >= 0) return 'buy';
      if (buyValue >= 0 && pnl < 0) return 'buy-loss';
      if (buyValue < 0 && pnl >= 0) return 'sell';
      return 'sell-loss';
    }

    // ---------- IMPORT XLSX ----------
    function parseXlsx(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            resolve(workbook);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = err => reject(err);
        reader.readAsArrayBuffer(file);
      });
    }

    function parseTransactionsSheet(rows) {
      const list = [];
      rows.forEach((row, idx) => {
        const base = {
          date: row.date || row['data'] || row['Data'] || '',
          asset: row.asset || row['asset'] || row['Asset'] || '',
          tipo: row.tipo || row['tipo'] || row['Tipo'] || '',
          buyValue: Number(row.buyValue || row['buyValue'] || row['valore'] || 0),
          pnl: Number(row.pnl || row['pnl'] || 0),
          note: row.note || row['note'] || row['Note'] || ''
        };
        const currentValue = base.buyValue + base.pnl;
        const type = inferTypeFromValues(base.buyValue, base.pnl);
        list.push({
          id: crypto.randomUUID ? crypto.randomUUID() : `tx-${Date.now()}-${idx}`,
          ...base,
          currentValue,
          type
        });
      });
      return list;
    }

    function normalizeSnapshotRow(row, index) {
      const dateStr = (row.date || row['Date'] || row['data'] || row['Data'] || '').toString().slice(0, 10);
      const low = parseFloat(row['low risk'] ?? row.lowRisk ?? row.low ?? '') || 0;
      const medium = parseFloat(row['medium risk'] ?? row.mediumRisk ?? row.medium ?? '') || 0;
      const high = parseFloat(row['high risk'] ?? row.highRisk ?? row.high ?? '') || 0;
      const liquid = parseFloat(row['liquido'] ?? row.liquid ?? '') || 0;

      if (!dateStr) return null;

      return {
        id: row.id || (crypto.randomUUID ? crypto.randomUUID() : `snap-${Date.now()}-${index}`),
        date: dateStr,
        low,
        medium,
        high,
        liquid
      };
    }

    function parseMovementsSheet(rows) {
      const list = [];
      rows.forEach((row, idx) => {
        const valueRaw =
          row.valore ?? row['valore'] ?? row['Valore'] ??
          row.value ?? row['value'] ?? row['Value'];
        if (valueRaw === null || valueRaw === undefined || valueRaw === '') return;
        const value = parseFloat(valueRaw);
        if (Number.isNaN(value)) return;

        const direction = value >= 0 ? 'income' : 'expense';
        const amount = Math.abs(value);
        const name = (row.nome ?? row['nome'] ?? row['name'] ?? row['Name'] ?? '').toString();
        const note = (row.note ?? row['note'] ?? row['Note'] ?? row.tipo ?? row['tipo'] ?? '').toString();

        if (!name && !note) return;

        list.push({
          id: crypto.randomUUID ? crypto.randomUUID() : `mm-${Date.now()}-${idx}`,
          name,
          direction,
          amount,
          note
        });
      });
      return list;
    }

    function renderEverything() {
      updateTransactionSortIndicators();
      updateMmSortIndicators();
      renderDashboard();
      renderTable();
      renderMonthlyMovements();
      renderAssetChart();
      renderAssetPnlChart();
      renderAssetBlocks();
      updateZeroAssetsToggleLabel();
      renderMonthlyReview();
    }

    // ---------- EXPORT JSON & XLSX ----------
    async function exportBackup() {
      const state = getCurrentState();
      const json = JSON.stringify(state, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `investments-backup-${today}.json`;

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'JSON file',
              accept: { 'application/json': ['.json'] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (err) {
          console.warn('saveFilePicker failed, falling back', err);
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }

    function downloadXlsx() {
      const wb = XLSX.utils.book_new();

      const txRows = transactions.map(t => ({
        date: t.date,
        asset: t.asset,
        tipo: t.tipo,
        type: t.type,
        buyValue: t.buyValue,
        pnl: t.pnl,
        note: t.note
      }));
      const mmRows = monthlyMovements.map(m => ({
        name: m.name,
        direction: m.direction,
        amount: m.amount,
        note: m.note
      }));
      const snapRows = monthlySnapshots.map(s => ({
        date: s.date,
        lowRisk: s.low,
        mediumRisk: s.medium,
        highRisk: s.high,
        liquid: s.liquid
      }));

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), 'rawTransactions');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mmRows), 'movements');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(snapRows), 'monthlySnapshots');

      XLSX.writeFile(wb, `investments-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    }

    function updateTxSort(column) {
      if (transactionSortState.column === column) {
        transactionSortState.direction = transactionSortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        transactionSortState.column = column;
        transactionSortState.direction = 'desc';
      }
      renderTable();
      updateTransactionSortIndicators();
    }

    function updateMmSort(column) {
      if (mmSortState.column === column) {
        mmSortState.direction = mmSortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        mmSortState.column = column;
        mmSortState.direction = 'desc';
      }
      renderMonthlyMovements();
      updateMmSortIndicators();
    }

    document.addEventListener('DOMContentLoaded', () => {
      const tipoSelect = document.getElementById('tipoSelect');
      const groupBuy = document.getElementById('groupBuy');
      const groupPnl = document.getElementById('groupPnl');
      if (tipoSelect && groupBuy && groupPnl) {
        tipoSelect.addEventListener('change', () => {
          const tipo = tipoSelect.value;
          if (tipo === 'nuovo vincolo') {
            groupBuy.style.display = 'block';
            groupPnl.style.display = 'none';
          } else if (
            tipo === 'cedola' ||
            tipo === 'interessi' ||
            tipo === 'Variazione Valore' ||
            tipo === 'cashback'
          ) {
            groupBuy.style.display = 'none';
            groupPnl.style.display = 'block';
          } else {
            groupBuy.style.display = 'block';
            groupPnl.style.display = 'block';
          }
        });
        tipoSelect.dispatchEvent(new Event('change'));
      }

      // sort headers
      document.querySelectorAll('#page-transactions th[data-column]').forEach(th => {
        th.addEventListener('click', () => updateTxSort(th.dataset.column));
      });
      document.querySelectorAll('#page-monthly-movements th[data-mm-column]').forEach(th => {
        th.addEventListener('click', () => updateMmSort(th.dataset.mmColumn));
      });

      // Obsolete table listeners removed as we now use direct binding on card actions

      const txCancelBtn = document.getElementById('txCancelEditButton');
      if (txCancelBtn) {
        txCancelBtn.addEventListener('click', () => {
          resetTransactionForm();
        });
      }

      const mmCancelBtn = document.getElementById('monthlyCancelEditButton');
      if (mmCancelBtn) {
        mmCancelBtn.addEventListener('click', () => {
          resetMonthlyForm();
        });
      }

      const monthlyForm = document.getElementById('monthlyForm');
      if (monthlyForm) {
        monthlyForm.addEventListener('submit', event => {
          event.preventDefault();
          const name = monthlyForm.name.value.trim();
          const direction = monthlyForm.direction.value || 'income';
          const amount = parseFloat(monthlyForm.amount.value || '0');
          const note = monthlyForm.note.value || '';
          if (!name) {
            alert('Enter a name for the monthly movement');
            return;
          }
          if (Number.isNaN(amount)) {
            alert('Invalid amount');
            return;
          }

          if (editingMonthlyId) {
            monthlyMovements = monthlyMovements.map(m =>
              m.id === editingMonthlyId
                ? { ...m, name, direction, amount: Math.abs(amount), note }
                : m
            );
          } else {
            monthlyMovements.push({
              id: crypto.randomUUID ? crypto.randomUUID() : `mm-${Date.now()}-${monthlyMovements.length}`,
              name,
              direction,
              amount: Math.abs(amount),
              note
            });
          }

          saveState();
          renderMonthlyMovements();
          resetMonthlyForm();
        });
      }

      const toggleZeroBtn = document.getElementById('toggleZeroAssetsButton');
      if (toggleZeroBtn) {
        toggleZeroBtn.addEventListener('click', () => {
          showZeroAssets = !showZeroAssets;
          saveState();
          updateZeroAssetsToggleLabel();
          renderAssetBlocks();
          renderAssetChart();
          renderAssetPnlChart();
        });
        updateZeroAssetsToggleLabel();
      }

      // quick snapshot (monthly review)
      const quickLiquidityInput = document.getElementById('quickLiquidityInput');
      const addTodaySnapshotButton = document.getElementById('addTodaySnapshotButton');
      if (quickLiquidityInput && addTodaySnapshotButton) {
        addTodaySnapshotButton.addEventListener('click', () => {
          const raw = quickLiquidityInput.value;
          if (!raw) {
            alert('Enter a liquidity value');
            return;
          }
          const liquid = parseFloat(raw);
          if (Number.isNaN(liquid)) {
            alert('Invalid liquidity value');
            return;
          }
          const today = new Date().toISOString().slice(0, 10);

          let baseLow = 0, baseMedium = 0, baseHigh = 0;
          if (monthlySnapshots.length) {
            const sorted = [...monthlySnapshots].sort((a, b) =>
              (a.date || '').localeCompare(b.date || '')
            );
            const last = sorted[sorted.length - 1];
            baseLow = last.low || 0;
            baseMedium = last.medium || 0;
            baseHigh = last.high || 0;
          }

          monthlySnapshots = monthlySnapshots.filter(s => s.date !== today);
          monthlySnapshots.push({
            id: crypto.randomUUID ? crypto.randomUUID() : `snap-${Date.now()}-${monthlySnapshots.length}`,
            date: today,
            low: baseLow,
            medium: baseMedium,
            high: baseHigh,
            liquid
          });

          saveState();
          renderMonthlyReview();
          quickLiquidityInput.value = '';
        });
      }
    });

    // ---------- NUOVA TRANSAZIONE ----------
    document.addEventListener('DOMContentLoaded', () => {
      const addForm = document.getElementById('addForm');
      if (!addForm) return;

      addForm.addEventListener('submit', event => {
        event.preventDefault();

        const tipo = addForm.tipo.value;
        let buyValue = 0;
        let pnl = 0;

        if (tipo === 'nuovo vincolo') {
          buyValue = parseFloat(addForm.buyValue.value || '0');
          pnl = 0;
        } else if (
          tipo === 'cedola' ||
          tipo === 'interessi' ||
          tipo === 'Variazione Valore' ||
          tipo === 'cashback'
        ) {
          buyValue = 0;
          pnl = parseFloat(addForm.pnl.value || '0');
        } else {
          buyValue = parseFloat(addForm.buyValue.value || '0');
          pnl = parseFloat(addForm.pnl.value || '0');
        }

        const currentValue = buyValue + pnl;
        const buyForType = (
          tipo === 'cedola' ||
          tipo === 'interessi' ||
          tipo === 'Variazione Valore' ||
          tipo === 'cashback'
        ) ? null : buyValue;
        const type = inferTypeFromValues(buyForType, pnl);

        const base = {
          date: addForm.date.value,
          asset: addForm.asset.value,
          tipo: tipo,
          type: type,
          buyValue: buyValue,
          currentValue: currentValue,
          pnl: pnl,
          note: addForm.note.value
        };

        if (editingTransactionId) {
          transactions = transactions.map(t =>
            t.id === editingTransactionId ? { ...t, ...base, id: editingTransactionId } : t
          );
        } else {
          transactions.push({
            id: crypto.randomUUID ? crypto.randomUUID() : `tx-${Date.now()}-${transactions.length}`,
            ...base
          });
        }

        saveState();
        renderEverything();
        resetTransactionForm();
      });
    });

    function resetMonthlyForm() {
      const monthlyForm = document.getElementById('monthlyForm');
      if (!monthlyForm) return;
      monthlyForm.reset();
      monthlyForm.direction.value = 'income';
      editingMonthlyId = null;
      const submitBtn = document.getElementById('monthlySubmitButton');
      if (submitBtn) submitBtn.textContent = '💾 save';
      const cancelBtn = document.getElementById('monthlyCancelEditButton');
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    // ---------- IMPORT/EXPORT ----------
    document.addEventListener('DOMContentLoaded', () => {
      const fileInput = document.getElementById('fileInput');
      const importBackupInput = document.getElementById('importBackupInput');
      const exportBackupButton = document.getElementById('exportBackupButton');
      const exportXlsxButton = document.getElementById('exportXlsxButton');
      const fullPurgeButton = document.getElementById('fullPurgeButton');

      if (fileInput) {
        fileInput.addEventListener('change', async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const wb = await parseXlsx(file);
            const txSheet = wb.Sheets['rawTransactions'];
            const mmSheet = wb.Sheets['movements'];
            const snapSheet = wb.Sheets['monthlySnapshots'];

            if (txSheet) {
              const rows = XLSX.utils.sheet_to_json(txSheet);
              transactions = parseTransactionsSheet(rows);
            }
            if (mmSheet) {
              const rows = XLSX.utils.sheet_to_json(mmSheet);
              monthlyMovements = parseMovementsSheet(rows);
            }
            if (snapSheet) {
              const rows = XLSX.utils.sheet_to_json(snapSheet);
              monthlySnapshots = rows
                .map((row, idx) => normalizeSnapshotRow(row, idx))
                .filter(Boolean);
            }

            saveState();
            renderEverything();
          } catch (err) {
            alert('Import failed: ' + err.message);
          } finally {
            fileInput.value = '';
          }
        });
      }

      if (importBackupInput) {
        importBackupInput.addEventListener('change', event => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = e => {
            try {
              const parsed = JSON.parse(e.target.result);
              const state = normalizeState(parsed);
              transactions = state.transactions;
              monthlyMovements = state.monthlyMovements;
              monthlySnapshots = state.monthlySnapshots;
              showZeroAssets = !!(state.preferences?.showZeroAssets ?? false);
              saveState();
              renderEverything();
            } catch (err) {
              alert('Invalid JSON');
            }
          };
          reader.readAsText(file);
          importBackupInput.value = '';
        });
      }

      exportBackupButton?.addEventListener('click', () => exportBackup());
      exportXlsxButton?.addEventListener('click', () => downloadXlsx());
      fullPurgeButton?.addEventListener('click', () => {
        const ok = confirm('Are you sure you want to delete all data?');
        if (!ok) return;
        transactions = [];
        monthlyMovements = [];
        monthlySnapshots = [];
        showZeroAssets = false;
        saveState();
        renderEverything();
      });

      document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderMonthlyReview(btn.dataset.range);
        });
      });
    });

    // ---------- INIT ----------
    function applyState(state) {
      transactions = state.transactions || [];
      monthlyMovements = state.monthlyMovements || [];
      monthlySnapshots = state.monthlySnapshots || [];
      assetColorMap = state.assetColors && typeof state.assetColors === 'object' ? { ...state.assetColors } : {};
      assetRiskMap = state.assetRisks && typeof state.assetRisks === 'object' ? { ...state.assetRisks } : {};
      if (state.preferences && typeof state.preferences === 'object') {
        showZeroAssets = Boolean(state.preferences.showZeroAssets);
      } else {
        showZeroAssets = false;
      }
      renderEverything();
    }

    async function initApp() {
      try {
        const initialState = await loadState();
        applyState(initialState);
      } catch (err) {
        setAuthStatus(err.message || 'Failed to load state');
        console.error('failed to initialize state', err);
      }
    }

    async function restoreSessionIfPossible() {
      try {
        const state = await loadState();
        setAuthVisibility(true);
        setAppVisible(true);
        applyState(state);
        return true;
      } catch (err) {
        if ((err.message || '').includes('unauthorized')) {
          setAuthVisibility(false);
          setAppVisible(false);
          return false;
        }
        console.warn('could not restore session', err);
        return false;
      }
    }

    function wireNav() {
      const buttons = document.querySelectorAll(".nav-btn[data-page]");
      const pages = document.querySelectorAll(".page");

      function setActive(pageId) {
        if (!pageId) return;
        buttons.forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageId));
        pages.forEach(page => {
          if (page.id === `page-${pageId}`) {
            page.classList.add("active");
          } else {
            page.classList.remove("active");
          }
        });
        // Scroll top
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      buttons.forEach(btn => {
        btn.addEventListener("click", () => setActive(btn.dataset.page));
      });

      // Default active
      const current = document.querySelector(".nav-btn.active");
      if (current) setActive(current.dataset.page);
    }

    document.addEventListener('DOMContentLoaded', async () => {
      wireNav();
      wireAuthForm();
      setAuthVisibility(false);
      setAppVisible(false);
      resetAppState();
      await restoreSessionIfPossible();
    });
