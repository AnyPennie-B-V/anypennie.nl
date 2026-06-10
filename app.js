// ==========================================================================
// APP STATE & CONSTANTS
// ==========================================================================
const STATE = {
  prices: { kanon: 1.80, ketel1: 18.50 },
  counts: { kanon: 0, ketel1: 0 },
  totalDebt: 0,
  ledger: [],
  token: localStorage.getItem('admin_token') || null,
  isAuthenticated: false
};

const API_BASE = '/api';

// ==========================================================================
// INITIALIZATION & ROUTING
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initRouting();
  fetchData();
  checkAuth();
  setupEventListeners();
});

function initRouting() {
  const tabs = document.querySelectorAll('.tab-content');
  const navLinks = document.querySelectorAll('.nav-link');

  function handleRoute() {
    const hash = window.location.hash || '#scoreboard';
    
    // Deactivate all nav links and tab sections
    navLinks.forEach(link => link.classList.remove('active'));
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Find active tab and link
    const activeTab = document.getElementById('tab-' + hash.replace('#', ''));
    const activeLink = document.querySelector(`a[href="${hash}"]`);

    if (activeTab) {
      activeTab.classList.add('active');
    } else {
      // Fallback
      document.getElementById('tab-scoreboard').classList.add('active');
    }

    if (activeLink) {
      activeLink.classList.add('active');
    }
    
    // Scroll to top
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', handleRoute);
  // Initial route execution
  handleRoute();
}

// ==========================================================================
// DATA FETCHING & RENDERING
// ==========================================================================
async function fetchData() {
  try {
    const headers = {};
    if (STATE.token) {
      headers['Authorization'] = `Bearer ${STATE.token}`;
    }

    const response = await fetch(`${API_BASE}/data`, { headers });
    if (!response.ok) {
      throw new Error('Failed to retrieve scoreboard data');
    }

    const resData = await response.json();
    
    STATE.prices = resData.prices;
    STATE.counts = resData.counts;
    STATE.totalDebt = resData.totalDebt;
    STATE.ledger = resData.ledger;

    // Display storage warning if Vercel is warning us
    const warningBanner = document.getElementById('storage-warning');
    if (resData.storageWarning) {
      warningBanner.classList.remove('hidden');
    } else {
      warningBanner.classList.add('hidden');
    }

    renderScoreboard();
    renderLedger();
    renderDebtChart();
    populateSettingsForm();
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

function renderScoreboard() {
  // Quantities
  document.getElementById('count-kanon').textContent = STATE.counts.kanon;
  document.getElementById('count-ketel1').textContent = STATE.counts.ketel1;

  // Price subs
  document.getElementById('price-kanon-sub').textContent = `@ €${STATE.prices.kanon.toFixed(2)} each`;
  document.getElementById('price-ketel1-sub').textContent = `@ €${STATE.prices.ketel1.toFixed(2)} each`;

  // Total cost breakdowns
  const kanonCost = STATE.counts.kanon * STATE.prices.kanon;
  const ketel1Cost = STATE.counts.ketel1 * STATE.prices.ketel1;
  document.getElementById('total-kanon-cost').textContent = `Total: €${kanonCost.toFixed(2)}`;
  document.getElementById('total-ketel1-cost').textContent = `Total: €${ketel1Cost.toFixed(2)}`;

  // Debt Value
  const debtElement = document.getElementById('debt-amount-val');
  const displayDebt = Math.abs(STATE.totalDebt) < 0.005 ? 0 : STATE.totalDebt;
  debtElement.textContent = displayDebt.toFixed(2);
  
  // Visual colors based on debt status
  if (STATE.totalDebt > 100) {
    debtElement.style.color = 'var(--crimson-hover)';
  } else if (STATE.totalDebt <= 0) {
    debtElement.style.color = '#81c784'; // Green if healthy balance
  } else {
    debtElement.style.color = 'var(--text-primary)';
  }
}

function renderLedger() {
  const tbody = document.getElementById('ledger-body');
  const ledgerCount = document.getElementById('ledger-count');
  
  tbody.innerHTML = '';
  ledgerCount.textContent = STATE.ledger.length;

  if (STATE.ledger.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">No transactions recorded in the audit trail.</td></tr>`;
    return;
  }

  // Display logs from newest to oldest
  const sortedLedger = [...STATE.ledger].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  sortedLedger.forEach(tx => {
    const tr = document.createElement('tr');
    
    // Date & Time formatting
    const txDate = new Date(tx.timestamp);
    const dateStr = txDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = txDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    
    // Badges & Labels
    let drinkLabel = '-';
    if (tx.drinkType === 'kanon') drinkLabel = 'Grolsch Kanon';
    if (tx.drinkType === 'ketel1') drinkLabel = 'Ketel 1';

    const typeBadge = `<span class="type-badge ${tx.type}">${tx.type}</span>`;
    const qtyText = tx.type === 'consumption' ? tx.quantity : '-';
    
    // Value text coloring
    const isPosVal = tx.value >= 0;
    const sign = isPosVal ? '+' : '';
    const valClass = isPosVal ? 'pos' : 'neg';
    const valText = `<span class="tx-value-col ${valClass}">${sign}€${tx.value.toFixed(2)}</span>`;

    // Admin action button
    const deleteColClass = STATE.isAuthenticated ? 'admin-only-col' : 'admin-only-col hidden';
    const deleteAction = `<td class="${deleteColClass}">
      <button class="delete-tx-btn" data-id="${tx.id}" title="Delete entry">🗑️</button>
    </td>`;

    tr.innerHTML = `
      <td><strong>${dateStr}</strong> <span style="color:var(--text-secondary); margin-left: 0.3rem;">${timeStr}</span></td>
      <td>${typeBadge}</td>
      <td>${drinkLabel}</td>
      <td>${qtyText}</td>
      <td>${valText}</td>
      <td>${tx.admin}</td>
      <td><span style="color:var(--text-secondary); font-style: italic;">${tx.note || '—'}</span></td>
      ${deleteAction}
    `;

    tbody.appendChild(tr);
  });

  // Attach delete handlers if admin
  if (STATE.isAuthenticated) {
    document.querySelectorAll('.delete-tx-btn').forEach(btn => {
      btn.addEventListener('click', handleDeleteTransaction);
    });
  }
}

// Draws a dynamic SVG chart showing debt trends over time
function renderDebtChart() {
  const chartAreaPath = document.getElementById('chart-area');
  const chartLinePath = document.getElementById('chart-line');
  
  if (STATE.ledger.length === 0) {
    chartAreaPath.setAttribute('d', 'M 0 120 L 500 120 Z');
    chartLinePath.setAttribute('d', 'M 0 120 L 500 120');
    return;
  }

  // Sort logs oldest to newest for chronological plotting
  const chronological = [...STATE.ledger].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Compute points: running debt over time
  let runningDebt = 0;
  const points = [{ val: 0, time: new Date(chronological[0].timestamp) - 3600000 }]; // initial state (1 hour before first log)

  chronological.forEach(tx => {
    runningDebt += tx.value;
    points.push({ val: runningDebt, time: new Date(tx.timestamp) });
  });

  // Plotting metrics
  const width = 500;
  const height = 120;
  const paddingX = 15;
  const paddingY = 15;

  const minVal = 0; // standard base floor is €0
  const maxVal = Math.max(...points.map(p => p.val), 20); // ensure scale handles at least €20 max debt to avoid flat lines

  const minTime = points[0].time;
  const maxTime = points[points.length - 1].time;
  const timeDiff = maxTime - minTime || 1; // avoid division by zero

  let pathString = '';
  
  points.forEach((pt, index) => {
    // X scale based on time progress
    const x = paddingX + ((pt.time - minTime) / timeDiff) * (width - 2 * paddingX);
    // Y scale based on debt amount (higher debt = lower Y pixel coordinate)
    const y = (height - paddingY) - ((pt.val - minVal) / (maxVal - minVal)) * (height - 2 * paddingY);
    
    if (index === 0) {
      pathString += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      // Draw smooth line
      pathString += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  });

  // Update line path
  chartLinePath.setAttribute('d', pathString);

  // Close the shape to the bottom for area fill
  const firstX = paddingX;
  const lastX = width - paddingX;
  const bottomY = height;
  const areaPathString = `${pathString} L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`;
  chartAreaPath.setAttribute('d', areaPathString);
}

function populateSettingsForm() {
  document.getElementById('setting-price-kanon').value = STATE.prices.kanon.toFixed(2);
  document.getElementById('setting-price-ketel1').value = STATE.prices.ketel1.toFixed(2);
}

// ==========================================================================
// SECURITY / AUTHENTICATION
// ==========================================================================
async function checkAuth() {
  if (!STATE.token) {
    setAuthState(false);
    return;
  }

  // Try to read authenticated data, if it responds 200, we are confirmed admins
  try {
    const response = await fetch(`${API_BASE}/data`, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });

    if (response.status === 200) {
      setAuthState(true);
    } else {
      // Token is stale or invalid
      localStorage.removeItem('admin_token');
      STATE.token = null;
      setAuthState(false);
    }
  } catch (error) {
    setAuthState(false);
  }
}

function setAuthState(isAuth) {
  STATE.isAuthenticated = isAuth;
  const authPanel = document.getElementById('auth-panel');
  const adminDashboard = document.getElementById('admin-dashboard');
  const adminCols = document.querySelectorAll('.admin-only-col');

  if (isAuth) {
    authPanel.classList.add('hidden');
    adminDashboard.classList.remove('hidden');
    adminCols.forEach(col => col.classList.remove('hidden'));
  } else {
    authPanel.classList.remove('hidden');
    adminDashboard.classList.add('hidden');
    adminCols.forEach(col => col.classList.add('hidden'));
  }
}

// ==========================================================================
// EVENT HANDLERS & POSTS
// ==========================================================================
function setupEventListeners() {
  // Navigation explore button scrolls down to main details
  const btnExplore = document.getElementById('btn-explore');
  if (btnExplore) {
    btnExplore.addEventListener('click', () => {
      document.getElementById('unopened-debt-section').scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Auth: Login Form
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  
  // Auth: Logout Button
  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  // Admin Actions: Quick log buttons
  document.getElementById('btn-quick-kanon').addEventListener('click', () => quickLogDrink('kanon'));
  document.getElementById('btn-quick-ketel').addEventListener('click', () => quickLogDrink('ketel1'));

  // Admin Actions: Detailed Log Form
  document.getElementById('form-log-consumption').addEventListener('submit', handleLogConsumption);

  // Admin Actions: Log Payment Form
  document.getElementById('form-log-payment').addEventListener('submit', handleLogPayment);

  // Admin Actions: Settings Config Form
  document.getElementById('form-settings').addEventListener('submit', handleSaveSettings);

  // Admin Actions: Clear Ledger Purge
  document.getElementById('btn-clear-ledger').addEventListener('click', handleClearLedger);
}

async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById('admin-password').value;
  const loginError = document.getElementById('login-error');

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const result = await response.json();

    if (result.success) {
      STATE.token = result.token;
      localStorage.setItem('admin_token', result.token);
      loginError.classList.add('hidden');
      document.getElementById('admin-password').value = '';
      setAuthState(true);
      fetchData(); // Reload stats with admin actions visible
    } else {
      loginError.classList.remove('hidden');
      loginError.textContent = result.error || 'Authentication failed.';
    }
  } catch (error) {
    loginError.classList.remove('hidden');
    loginError.textContent = 'Server connection error. Please verify the server is running.';
  }
}

function handleLogout() {
  localStorage.removeItem('admin_token');
  STATE.token = null;
  setAuthState(false);
  fetchData(); // Refresh to lock/hide admin table operations
}

async function quickLogDrink(drinkType) {
  if (!STATE.isAuthenticated) return;
  
  const label = drinkType === 'kanon' ? 'Grolsch Kanon (Quick Log)' : 'Ketel 1 Bottle (Quick Log)';
  
  const payload = {
    action: 'log_consumption',
    drinkType,
    quantity: 1,
    admin: 'Quick Admin Audit',
    note: label,
    timestamp: new Date().toISOString()
  };

  await sendAdminAction(payload);
}

async function handleLogConsumption(e) {
  e.preventDefault();
  
  const drinkType = document.getElementById('select-drink').value;
  const quantity = parseInt(document.getElementById('input-qty').value, 10);
  const admin = document.getElementById('input-cons-admin').value;
  const note = document.getElementById('input-cons-note').value;

  const payload = {
    action: 'log_consumption',
    drinkType,
    quantity,
    admin,
    note,
    timestamp: new Date().toISOString()
  };

  const success = await sendAdminAction(payload);
  if (success) {
    document.getElementById('input-qty').value = '1';
    document.getElementById('input-cons-admin').value = '';
    document.getElementById('input-cons-note').value = '';
  }
}

async function handleLogPayment(e) {
  e.preventDefault();
  
  const amount = parseFloat(document.getElementById('input-payment-amount').value);
  const admin = document.getElementById('input-pay-admin').value;
  const note = document.getElementById('input-pay-note').value;

  const payload = {
    action: 'log_payment',
    amount,
    admin,
    note,
    timestamp: new Date().toISOString()
  };

  const success = await sendAdminAction(payload);
  if (success) {
    document.getElementById('input-payment-amount').value = '';
    document.getElementById('input-pay-admin').value = '';
    document.getElementById('input-pay-note').value = '';
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();

  const kanonPrice = parseFloat(document.getElementById('setting-price-kanon').value);
  const ketel1Price = parseFloat(document.getElementById('setting-price-ketel1').value);

  const payload = {
    action: 'update_settings',
    prices: {
      kanon: kanonPrice,
      ketel1: ketel1Price
    }
  };

  await sendAdminAction(payload);
}

async function handleDeleteTransaction(e) {
  const transactionId = e.currentTarget.getAttribute('data-id');
  if (!transactionId) return;

  if (confirm('Are you sure you want to permanently delete this ledger entry? This will adjust the scoreboard counts and debt values immediately.')) {
    const payload = {
      action: 'delete_transaction',
      transactionId
    };
    await sendAdminAction(payload);
  }
}

async function handleClearLedger() {
  if (confirm('⚠️ WARNING: Are you absolutely sure you want to purge the entire ledger history? This will reset all beverage counts and outstanding debts to zero. This action is irreversible.')) {
    const payload = {
      action: 'clear_ledger'
    };
    await sendAdminAction(payload);
  }
}

// Sends an authenticated administrative action to the API endpoint
async function sendAdminAction(payload) {
  if (!STATE.token) {
    alert('Authentication required.');
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errRes = await response.json();
      throw new Error(errRes.error || 'Failed to apply admin transaction');
    }

    const resData = await response.json();
    
    // Update local state with returning synced values
    STATE.prices = resData.prices;
    STATE.counts = resData.counts;
    STATE.totalDebt = resData.totalDebt;
    STATE.ledger = resData.ledger;

    renderScoreboard();
    renderLedger();
    renderDebtChart();
    populateSettingsForm();
    
    return true;
  } catch (error) {
    alert('Admin Error: ' + error.message);
    return false;
  }
}
