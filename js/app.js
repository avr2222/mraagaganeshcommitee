/* Ganesh Pooja Expense Portal
   Client-side data store backed by localStorage. No backend required. */

const STORAGE_KEY = 'gpep_data_v1';

const defaultData = () => ({
  settings: {
    eventName: 'Ganesh Pooja Expense Portal',
    subtitle: 'Community contributions & expense tracker'
  },
  contributions: [],
  expenses: []
});

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return {
      settings: { ...defaultData().settings, ...(parsed.settings || {}) },
      contributions: Array.isArray(parsed.contributions) ? parsed.contributions : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : []
    };
  } catch (e) {
    console.error('Failed to load data, starting fresh.', e);
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadData();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 2200);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'dashboard') renderDashboard();
  });
});

/* ---------- Settings ---------- */
function applySettingsToHeader() {
  document.getElementById('eventTitle').textContent = state.settings.eventName;
  document.getElementById('eventSubtitle').textContent = state.settings.subtitle;
  document.title = state.settings.eventName;
}

const settingsModal = document.getElementById('settingsModal');
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsEventName').value = state.settings.eventName;
  document.getElementById('settingsSubtitle').value = state.settings.subtitle;
  settingsModal.classList.remove('hidden');
});
document.getElementById('settingsCancelBtn').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('settingsSaveBtn').addEventListener('click', () => {
  state.settings.eventName = document.getElementById('settingsEventName').value.trim() || defaultData().settings.eventName;
  state.settings.subtitle = document.getElementById('settingsSubtitle').value.trim();
  saveData();
  applySettingsToHeader();
  settingsModal.classList.add('hidden');
  showToast('Settings saved');
});

/* ---------- Contributions ---------- */
const contribForm = document.getElementById('contributionForm');
const contribCancelBtn = document.getElementById('contribCancelBtn');

contribForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('contribId').value;
  const entry = {
    id: id || uid(),
    name: document.getElementById('contribName').value.trim(),
    phone: document.getElementById('contribPhone').value.trim(),
    amount: Number(document.getElementById('contribAmount').value) || 0,
    date: document.getElementById('contribDate').value,
    mode: document.getElementById('contribMode').value,
    notes: document.getElementById('contribNotes').value.trim(),
    createdAt: id ? undefined : new Date().toISOString()
  };
  if (id) {
    const idx = state.contributions.findIndex(c => c.id === id);
    if (idx > -1) entry.createdAt = state.contributions[idx].createdAt;
    if (idx > -1) state.contributions[idx] = entry;
  } else {
    state.contributions.unshift(entry);
  }
  saveData();
  resetContribForm();
  renderContributions();
  renderDashboard();
  showToast(id ? 'Contribution updated' : 'Contribution added');
});

function resetContribForm() {
  contribForm.reset();
  document.getElementById('contribId').value = '';
  document.getElementById('contribDate').value = todayISO();
  document.getElementById('contribFormTitle').textContent = 'Add Contribution';
  document.getElementById('contribSubmitBtn').textContent = 'Add Contribution';
  contribCancelBtn.classList.add('hidden');
}
contribCancelBtn.addEventListener('click', resetContribForm);

function editContribution(id) {
  const c = state.contributions.find(x => x.id === id);
  if (!c) return;
  document.getElementById('contribId').value = c.id;
  document.getElementById('contribName').value = c.name;
  document.getElementById('contribPhone').value = c.phone || '';
  document.getElementById('contribAmount').value = c.amount;
  document.getElementById('contribDate').value = c.date;
  document.getElementById('contribMode').value = c.mode || 'Cash';
  document.getElementById('contribNotes').value = c.notes || '';
  document.getElementById('contribFormTitle').textContent = 'Edit Contribution';
  document.getElementById('contribSubmitBtn').textContent = 'Save Changes';
  contribCancelBtn.classList.remove('hidden');
  document.getElementById('contributions').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteContribution(id) {
  if (!confirm('Delete this contribution? This cannot be undone.')) return;
  state.contributions = state.contributions.filter(c => c.id !== id);
  saveData();
  renderContributions();
  renderDashboard();
  showToast('Contribution deleted');
}

function renderContributions() {
  const tbody = document.querySelector('#contributionsTable tbody');
  const search = document.getElementById('contribSearch').value.trim().toLowerCase();
  const rows = state.contributions
    .filter(c => !search || c.name.toLowerCase().includes(search))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  tbody.innerHTML = rows.map(c => `
    <tr>
      <td>${formatDate(c.date)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>${escapeHtml(c.mode)}</td>
      <td>${escapeHtml(c.notes)}</td>
      <td class="num">${formatCurrency(c.amount)}</td>
      <td class="row-actions">
        <button class="row-btn" title="Edit" onclick="editContribution('${c.id}')">✏️</button>
        <button class="row-btn" title="Delete" onclick="deleteContribution('${c.id}')">🗑️</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('contributionsEmpty').classList.toggle('hidden', rows.length > 0);
}
document.getElementById('contribSearch').addEventListener('input', renderContributions);

/* ---------- Expenses ---------- */
const expenseForm = document.getElementById('expenseForm');
const expenseCancelBtn = document.getElementById('expenseCancelBtn');

expenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('expenseId').value;
  const entry = {
    id: id || uid(),
    description: document.getElementById('expenseDesc').value.trim(),
    category: document.getElementById('expenseCategory').value,
    amount: Number(document.getElementById('expenseAmount').value) || 0,
    date: document.getElementById('expenseDate').value,
    vendor: document.getElementById('expenseVendor').value.trim(),
    notes: document.getElementById('expenseNotes').value.trim(),
    createdAt: id ? undefined : new Date().toISOString()
  };
  if (id) {
    const idx = state.expenses.findIndex(x => x.id === id);
    if (idx > -1) entry.createdAt = state.expenses[idx].createdAt;
    if (idx > -1) state.expenses[idx] = entry;
  } else {
    state.expenses.unshift(entry);
  }
  saveData();
  resetExpenseForm();
  renderExpenses();
  renderDashboard();
  showToast(id ? 'Expense updated' : 'Expense added');
});

function resetExpenseForm() {
  expenseForm.reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expenseDate').value = todayISO();
  document.getElementById('expenseFormTitle').textContent = 'Add Expense';
  document.getElementById('expenseSubmitBtn').textContent = 'Add Expense';
  expenseCancelBtn.classList.add('hidden');
}
expenseCancelBtn.addEventListener('click', resetExpenseForm);

function editExpense(id) {
  const x = state.expenses.find(e => e.id === id);
  if (!x) return;
  document.getElementById('expenseId').value = x.id;
  document.getElementById('expenseDesc').value = x.description;
  document.getElementById('expenseCategory').value = x.category;
  document.getElementById('expenseAmount').value = x.amount;
  document.getElementById('expenseDate').value = x.date;
  document.getElementById('expenseVendor').value = x.vendor || '';
  document.getElementById('expenseNotes').value = x.notes || '';
  document.getElementById('expenseFormTitle').textContent = 'Edit Expense';
  document.getElementById('expenseSubmitBtn').textContent = 'Save Changes';
  expenseCancelBtn.classList.remove('hidden');
  document.getElementById('expenses').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteExpense(id) {
  if (!confirm('Delete this expense? This cannot be undone.')) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveData();
  renderExpenses();
  renderDashboard();
  showToast('Expense deleted');
}

function renderExpenses() {
  const tbody = document.querySelector('#expensesTable tbody');
  const search = document.getElementById('expenseSearch').value.trim().toLowerCase();
  const rows = state.expenses
    .filter(x => !search || x.description.toLowerCase().includes(search))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  tbody.innerHTML = rows.map(x => `
    <tr>
      <td>${formatDate(x.date)}</td>
      <td>${escapeHtml(x.description)}</td>
      <td>${escapeHtml(x.category)}</td>
      <td>${escapeHtml(x.vendor)}</td>
      <td>${escapeHtml(x.notes)}</td>
      <td class="num">${formatCurrency(x.amount)}</td>
      <td class="row-actions">
        <button class="row-btn" title="Edit" onclick="editExpense('${x.id}')">✏️</button>
        <button class="row-btn" title="Delete" onclick="deleteExpense('${x.id}')">🗑️</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('expensesEmpty').classList.toggle('hidden', rows.length > 0);
}
document.getElementById('expenseSearch').addEventListener('input', renderExpenses);

/* ---------- Dashboard ---------- */
function renderDashboard() {
  const totalCollections = state.contributions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const totalExpenses = state.expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = totalCollections - totalExpenses;

  document.getElementById('totalCollections').textContent = formatCurrency(totalCollections);
  document.getElementById('totalExpenses').textContent = formatCurrency(totalExpenses);
  document.getElementById('balanceAmount').textContent = formatCurrency(balance);
  document.getElementById('contributorCount').textContent = state.contributions.length;

  // Category breakdown
  const byCategory = {};
  state.expenses.forEach(x => {
    byCategory[x.category] = (byCategory[x.category] || 0) + (Number(x.amount) || 0);
  });
  const maxCat = Math.max(1, ...Object.values(byCategory));
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const breakdownEl = document.getElementById('categoryBreakdown');
  breakdownEl.innerHTML = catEntries.length ? catEntries.map(([cat, amt]) => `
    <div class="breakdown-row">
      <span class="breakdown-label">${escapeHtml(cat)}</span>
      <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${(amt / maxCat) * 100}%"></div></div>
      <span class="breakdown-amount">${formatCurrency(amt)}</span>
    </div>
  `).join('') : '<p class="empty-state">No expenses recorded yet.</p>';

  // Recent activity: merge contributions + expenses, newest first
  const activity = [
    ...state.contributions.map(c => ({ type: 'in', label: c.name, amount: c.amount, date: c.date })),
    ...state.expenses.map(x => ({ type: 'out', label: x.description, amount: x.amount, date: x.date }))
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);

  const activityEl = document.getElementById('recentActivity');
  activityEl.innerHTML = activity.length ? activity.map(a => `
    <div class="activity-item">
      <span><span class="activity-tag ${a.type}">${a.type === 'in' ? 'IN' : 'OUT'}</span>${escapeHtml(a.label)}</span>
      <span>${formatCurrency(a.amount)} · ${formatDate(a.date)}</span>
    </div>
  `).join('') : '<p class="empty-state">No activity yet.</p>';
}

/* ---------- CSV Export ---------- */
function toCsv(rows, headers) {
  const escapeCsv = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(h => h.label).join(',')];
  rows.forEach(row => {
    lines.push(headers.map(h => escapeCsv(row[h.key])).join(','));
  });
  return lines.join('\n');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('exportContribCsv').addEventListener('click', () => {
  const csv = toCsv(state.contributions, [
    { key: 'date', label: 'Date' },
    { key: 'name', label: 'Donor Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'mode', label: 'Payment Mode' },
    { key: 'notes', label: 'Notes' },
    { key: 'amount', label: 'Amount' }
  ]);
  downloadFile('contributions.csv', csv, 'text/csv');
});

document.getElementById('exportExpenseCsv').addEventListener('click', () => {
  const csv = toCsv(state.expenses, [
    { key: 'date', label: 'Date' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'notes', label: 'Notes' },
    { key: 'amount', label: 'Amount' }
  ]);
  downloadFile('expenses.csv', csv, 'text/csv');
});

/* ---------- Backup / Restore ---------- */
document.getElementById('exportBackup').addEventListener('click', () => {
  downloadFile(
    `ganesh-pooja-expense-backup-${todayISO()}.json`,
    JSON.stringify(state, null, 2),
    'application/json'
  );
});

document.getElementById('importBackup').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!confirm('Restoring a backup will replace all current data. Continue?')) return;
      state = {
        settings: { ...defaultData().settings, ...(parsed.settings || {}) },
        contributions: Array.isArray(parsed.contributions) ? parsed.contributions : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : []
      };
      saveData();
      applySettingsToHeader();
      renderContributions();
      renderExpenses();
      renderDashboard();
      showToast('Backup restored');
    } catch (err) {
      alert('Could not read backup file. Please make sure it is a valid JSON export from this portal.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('This will permanently delete ALL contributions and expenses. Are you sure?')) return;
  if (!confirm('Really sure? This cannot be undone.')) return;
  state.contributions = [];
  state.expenses = [];
  saveData();
  renderContributions();
  renderExpenses();
  renderDashboard();
  showToast('All data cleared');
});

/* ---------- Print Report ---------- */
document.getElementById('printReport').addEventListener('click', () => {
  const totalCollections = state.contributions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const totalExpenses = state.expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = totalCollections - totalExpenses;

  document.getElementById('printTitle').textContent = state.settings.eventName;
  document.getElementById('printSubtitle').textContent = state.settings.subtitle;
  document.getElementById('printTotalCollections').textContent = formatCurrency(totalCollections);
  document.getElementById('printTotalExpenses').textContent = formatCurrency(totalExpenses);
  document.getElementById('printBalance').textContent = formatCurrency(balance);
  document.getElementById('printDate').textContent = new Date().toLocaleString('en-IN');

  const byCategory = {};
  state.expenses.forEach(x => {
    byCategory[x.category] = (byCategory[x.category] || 0) + (Number(x.amount) || 0);
  });
  const catTable = document.getElementById('printCategoryTable');
  catTable.innerHTML = '<tr><th>Category</th><th>Amount</th></tr>' +
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `<tr><td>${escapeHtml(cat)}</td><td>${formatCurrency(amt)}</td></tr>`).join('');

  window.print();
});

/* ---------- Init ---------- */
document.getElementById('contribDate').value = todayISO();
document.getElementById('expenseDate').value = todayISO();
applySettingsToHeader();
renderContributions();
renderExpenses();
renderDashboard();
