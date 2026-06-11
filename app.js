// ==========================================================================
// APP STATE & CONSTANTS
// ==========================================================================
const STATE = {
  anytimers: [],
  totalOutstanding: 0,
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
    
    STATE.anytimers = resData.anytimers || [];
    STATE.totalOutstanding = resData.totalOutstanding || 0;
    STATE.ledger = resData.ledger;

    // Display storage warning if Vercel is warning us
    const warningBanner = document.getElementById('storage-warning');
    if (resData.storageWarning) {
      warningBanner.classList.remove('hidden');
    } else {
      warningBanner.classList.add('hidden');
    }

    renderDashboard();
    renderAnytimers();
    renderLedger();
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

function renderDashboard() {
  const totalElement = document.getElementById('anytimers-total');
  if (totalElement) {
    totalElement.textContent = String(STATE.totalOutstanding);
  }

  const cardCountElement = document.getElementById('anytimers-count');
  if (cardCountElement) {
    cardCountElement.textContent = String(STATE.anytimers.length);
  }

  const ledgerInlineCount = document.getElementById('ledger-count-inline');
  if (ledgerInlineCount) {
    ledgerInlineCount.textContent = String(STATE.ledger.length);
  }
}

function renderAnytimers() {
  const grid = document.getElementById('anytimers-grid');
  if (!grid) return;

  grid.innerHTML = '';

  if (STATE.anytimers.length === 0) {
    grid.innerHTML = '<div class="anytimer-empty">No anytimers logged yet. Use the admin panel to add the first one.</div>';
    return;
  }

  STATE.anytimers.forEach(person => {
    const card = document.createElement('article');
    card.className = 'card anytimer-card';

    const statusClass = person.outstanding > 0 ? 'has-outstanding' : 'is-cleared';

    card.innerHTML = `
      <div class="anytimer-card-top">
        <div>
          <div class="anytimer-name">${person.name}</div>
          <div class="anytimer-meta">${person.taken} taken · ${person.received} received</div>
        </div>
        <span class="anytimer-status ${statusClass}">${person.outstanding > 0 ? 'OWED' : 'CLEARED'}</span>
      </div>
      <div class="anytimer-count-row">
        <span class="anytimer-count">${person.outstanding}</span>
        <span class="anytimer-count-label">anys remaining</span>
      </div>
    `;

    grid.appendChild(card);
  });
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
    
    const typeLabel = tx.type === 'any_received'
      ? 'Any received'
      : tx.type === 'any_taken'
        ? 'Any taken'
        : tx.type;
    const typeBadge = `<span class="type-badge ${tx.type}">${typeLabel}</span>`;
    const personName = tx.personName || tx.person || '—';
    const qtyText = Number.isFinite(Number(tx.quantity)) ? tx.quantity : '—';
    const balanceText = Number.isFinite(Number(tx.balanceAfter)) ? tx.balanceAfter : '—';

    // Admin action button
    const deleteColClass = STATE.isAuthenticated ? 'admin-only-col' : 'admin-only-col hidden';
    const deleteAction = `<td class="${deleteColClass}">
      <button class="delete-tx-btn" data-id="${tx.id}" title="Delete entry">🗑️</button>
    </td>`;

    tr.innerHTML = `
      <td><strong>${dateStr}</strong> <span style="color:var(--text-secondary); margin-left: 0.3rem;">${timeStr}</span></td>
      <td>${typeBadge}</td>
      <td>${personName}</td>
      <td>${qtyText}</td>
      <td>${balanceText}</td>
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

  const receivedForm = document.getElementById('form-log-any-received');
  if (receivedForm) {
    receivedForm.addEventListener('submit', handleLogAnyReceived);
  }

  const takenForm = document.getElementById('form-log-any-taken');
  if (takenForm) {
    takenForm.addEventListener('submit', handleLogAnyTaken);
  }

  // Admin Actions: Clear Ledger Purge
  const clearButton = document.getElementById('btn-clear-ledger');
  if (clearButton) {
    clearButton.addEventListener('click', handleClearLedger);
  }
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

async function handleLogAnyReceived(e) {
  e.preventDefault();

  const payload = {
    action: 'log_any_received',
    personName: document.getElementById('input-received-person').value,
    quantity: parseInt(document.getElementById('input-received-qty').value, 10),
    admin: document.getElementById('input-received-admin').value,
    note: document.getElementById('input-received-note').value,
    timestamp: new Date().toISOString()
  };

  const success = await sendAdminAction(payload);
  if (success) {
    document.getElementById('input-received-person').value = '';
    document.getElementById('input-received-qty').value = '1';
    document.getElementById('input-received-admin').value = '';
    document.getElementById('input-received-note').value = '';
  }
}

async function handleLogAnyTaken(e) {
  e.preventDefault();

  const payload = {
    action: 'log_any_taken',
    personName: document.getElementById('input-taken-person').value,
    quantity: parseInt(document.getElementById('input-taken-qty').value, 10),
    admin: document.getElementById('input-taken-admin').value,
    note: document.getElementById('input-taken-note').value,
    timestamp: new Date().toISOString()
  };

  const success = await sendAdminAction(payload);
  if (success) {
    document.getElementById('input-taken-person').value = '';
    document.getElementById('input-taken-qty').value = '1';
    document.getElementById('input-taken-admin').value = '';
    document.getElementById('input-taken-note').value = '';
  }
}

async function handleDeleteTransaction(e) {
  const transactionId = e.currentTarget.getAttribute('data-id');
  if (!transactionId) return;

  if (confirm('Are you sure you want to permanently delete this ledger entry? This will recalculate the affected anytimer balances immediately.')) {
    const payload = {
      action: 'delete_transaction',
      transactionId
    };
    await sendAdminAction(payload);
  }
}

async function handleClearLedger() {
  if (confirm('⚠️ WARNING: Are you absolutely sure you want to purge the entire ledger history? This will reset all anytimer balances to zero. This action is irreversible.')) {
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
    STATE.anytimers = resData.anytimers || [];
    STATE.totalOutstanding = resData.totalOutstanding || 0;
    STATE.ledger = resData.ledger;

    renderDashboard();
    renderAnytimers();
    renderLedger();
    
    return true;
  } catch (error) {
    alert('Admin Error: ' + error.message);
    return false;
  }
}
