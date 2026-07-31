// ==========================================================================
// APP STATE & CONSTANTS
// ==========================================================================
const STATE = {
  anytimers: [],
  totalOutstanding: 0,
  ledger: [],
  gameLeaderboard: [],
  treasureHunt: {
    enabled: false,
    currentStage: 0,
    hints: []
  },
  token: localStorage.getItem('admin_token') || null,
  treasureToken: localStorage.getItem('treasure_hunt_token') || null,
  isAuthenticated: false
};

const API_BASE = '/api';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB, kept in sync with api/upload-image.js

// ==========================================================================
// SMALL UTILITIES
// ==========================================================================
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ==========================================================================
// INITIALIZATION & ROUTING
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initRouting();
  await checkAuth();
  await checkTreasureAuth();
  await fetchData();
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

    if (activeTab && !activeTab.classList.contains('hidden')) {
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
    let url = `${API_BASE}/data`;

    if (STATE.isAuthenticated && STATE.token) {
      headers['Authorization'] = `Bearer ${STATE.token}`;
      url += '?all_games=true';
    } else if (STATE.treasureToken) {
      headers['Authorization'] = `Bearer ${STATE.treasureToken}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error('Failed to retrieve scoreboard data');
    }

    const resData = await response.json();

    STATE.anytimers = resData.anytimers || [];
    STATE.totalOutstanding = resData.totalOutstanding || 0;
    STATE.ledger = resData.ledger;
    STATE.gameLeaderboard = resData.gameLeaderboard || [];
    STATE.treasureHunt = resData.treasureHunt || STATE.treasureHunt;

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
    renderAdminLeaderboard();
    renderTreasureHunt();
    renderTreasureAdminPanel();
    populateProfileSelect();
    populatePersonSelects();
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

function getOrdinalSuffix(numberStr) {
  const n = parseInt(numberStr, 10);
  if (isNaN(n)) return numberStr;

  const j = n % 10;
  const k = n % 100;

  if (j === 1 && k !== 11) return n + "st";
  if (j === 2 && k !== 12) return n + "nd";
  if (j === 3 && k !== 13) return n + "rd";
  return n + "th";
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
    card.className = `card anytimer-card ${person.type === 'external' ? 'external' : ''}`;

    const statusClass = person.outstanding > 0 ? 'has-outstanding' : 'is-cleared';

    const avatarHtml = `
      <div class="anytimer-avatar-wrap">
        <div class="anytimer-avatar-placeholder">${escapeHtml(getInitials(person.name))}</div>
        ${person.imageUrl ? `<img class="anytimer-avatar-img" src="${escapeHtml(person.imageUrl)}" alt="${escapeHtml(person.name)}" onerror="this.style.display='none'">` : ''}
      </div>
    `;

    // Automatically make everyone a Treasurer, adding the prefix if a board number exists
    let combinedRoleText = "Treasurer";
    if (person.type === 'external') {
      combinedRoleText = "External";
    } else if (person.boardNumber) {
      combinedRoleText = `${getOrdinalSuffix(person.boardNumber)} Treasurer`;
    }

    const roleHTML = person.role ? `<div class="anytimer-role">(${escapeHtml(person.role)})</div>` : '';
    const combinedRoleHtml = `<div class="anytimer-role">${escapeHtml(combinedRoleText)}</div>`;
    const funFactHtml = person.funFact ? `<div class="anytimer-funfact">“${escapeHtml(person.funFact)}”</div>` : '';

    card.innerHTML = `
      <div class="anytimer-card-top">
        ${avatarHtml}
        <div class="anytimer-info">
          <div class="anytimer-name-role-wrap">
            <div class="anytimer-name">${escapeHtml(person.name)}</div>
            ${roleHTML}
          </div>
          ${combinedRoleHtml}
          <div class="anytimer-meta">${person.taken} taken · ${person.received} received</div>
        </div>
        <span class="anytimer-status ${statusClass}">${person.outstanding > 0 ? 'OWED' : 'CLEARED'}</span>
      </div>
      <div class="anytimer-count-row">
        <span class="anytimer-count">${person.outstanding}</span>
        <span class="anytimer-count-label">anys remaining</span>
      </div>
      ${funFactHtml}
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
    const personName = escapeHtml(tx.personName || tx.person || '—');
    const adminName = escapeHtml(tx.admin || '—');
    const noteText = escapeHtml(tx.note || '—');
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
      <td>${adminName}</td>
      <td><span style="color:var(--text-secondary); font-style: italic;">${noteText}</span></td>
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
    const response = await fetch(`${API_BASE}/data?check_auth=true`, {
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

async function checkTreasureAuth() {
  if (!STATE.treasureToken) {
    setTreasureAuthState(false);
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/data?check_treasure_auth=true`, {
      headers: { 'Authorization': `Bearer ${STATE.treasureToken}` }
    });

    if (response.status === 200) {
      setTreasureAuthState(true);
    } else {
      localStorage.removeItem('treasure_hunt_token');
      STATE.treasureToken = null;
      setTreasureAuthState(false);
    }
  } catch (error) {
    setTreasureAuthState(false);
  }
}

function setTreasureAuthState(isAuth) {
  const lockedPanel = document.getElementById('treasure-hunt-locked');
  const contentPanel = document.getElementById('treasure-hunt-content');
  const unlockError = document.getElementById('treasure-unlock-error');

  if (unlockError) {
    unlockError.classList.add('hidden');
    unlockError.textContent = '';
  }

  if (lockedPanel && contentPanel) {
    lockedPanel.classList.toggle('hidden', isAuth);
    contentPanel.classList.toggle('hidden', !isAuth);
  }

  renderTreasureHunt();
}

function renderTreasureHunt() {
  const section = document.getElementById('tab-treasure-hunt');
  const launcher = document.getElementById('treasure-hunt-launcher');
  const intro = document.getElementById('treasure-hunt-intro');
  const visibleCount = document.getElementById('treasure-visible-count');
  const hintsWrap = document.getElementById('treasure-hunt-hints');

  if (!section || !launcher) return;

  const enabled = !!STATE.treasureHunt.enabled;
  section.classList.toggle('hidden', !enabled);
  launcher.classList.toggle('hidden', !enabled);

  if (!enabled) {
    if (intro) {
      intro.textContent = 'This hunt is hidden until the admins switch it on.';
    }
    return;
  }

  if (intro) {
    intro.textContent = STATE.treasureHunt.completed
      ? 'The treasure hunt is complete. The final proof is in.'
      : (STATE.treasureToken
        ? 'You are unlocked. The currently available hints are shown below.'
        : 'The hunt is active. Enter the secret code to reveal the first hint.');
  }

  if (visibleCount) {
    visibleCount.textContent = String(Math.min(STATE.treasureHunt.currentStage || 0, (STATE.treasureHunt.hints || []).length));
  }

  if (!hintsWrap) return;

  const hints = Array.isArray(STATE.treasureHunt.hints) ? STATE.treasureHunt.hints : [];
  if (STATE.treasureHunt.completed && !STATE.treasureToken) {
    hintsWrap.innerHTML = `
      <div class="card treasure-page-complete">
        <h3>Treasure Hunt Complete</h3>
        <p>You made it to the end of the route. Thanks for taking part in the hunt.</p>
      </div>
    `;
    return;
  }

  if (!STATE.treasureToken) {
    hintsWrap.innerHTML = '<div class="treasure-empty">Unlock the hunt to see the first clue.</div>';
    return;
  }

  const visibleHints = hints.slice(0, Math.min(STATE.treasureHunt.currentStage || 0, hints.length));

  if (visibleHints.length === 0) {
    hintsWrap.innerHTML = hints.length > 0
      ? '<div class="treasure-empty">The hunt has been reset. Wait for the admins to unlock the next challenge.</div>'
      : '<div class="treasure-empty">No hints have been added yet.</div>';
    return;
  }

  hintsWrap.innerHTML = '';
  visibleHints.forEach((hint, index) => {
    const card = document.createElement('article');
    card.className = 'card treasure-hint-card';
    card.innerHTML = `
      <div class="treasure-hint-badge">Hint ${index + 1}</div>
      <h3>${escapeHtml(hint.title || `Hint ${index + 1}`)}</h3>
      <p>${escapeHtml(hint.description || '')}</p>
    `;
    hintsWrap.appendChild(card);
  });

  if (STATE.treasureHunt.completed) {
    const completeCard = document.createElement('div');
    completeCard.className = 'card treasure-page-complete';
    completeCard.innerHTML = `
      <h3>Treasure Hunt Complete</h3>
      <p>The final proof has been submitted. The hunt is officially over.</p>
    `;
    hintsWrap.appendChild(completeCard);
  }
}

function renderTreasureAdminPanel() {
  const toggle = document.getElementById('treasure-enabled-toggle');
  const hintsWrap = document.getElementById('treasure-admin-hints');

  if (toggle) {
    toggle.checked = !!STATE.treasureHunt.enabled;
  }

  if (!hintsWrap) return;

  const hints = Array.isArray(STATE.treasureHunt.hints) ? STATE.treasureHunt.hints : [];
  if (hints.length === 0) {
    hintsWrap.innerHTML = '<div class="treasure-empty">No treasure hints have been created yet.</div>';
    return;
  }

  hintsWrap.innerHTML = '';
  hints.forEach((hint, index) => {
    const card = document.createElement('div');
    card.className = 'treasure-admin-hint';
    card.innerHTML = `
      <div class="treasure-admin-hint-header">
        <div>
          <strong>Hint ${index + 1}</strong>
          <div class="treasure-admin-hint-title">${escapeHtml(hint.title || 'Untitled hint')}</div>
        </div>
        <button type="button" class="delete-tx-btn treasure-delete-hint-btn" data-id="${escapeHtml(hint.id)}" title="Delete hint">Delete</button>
      </div>
      <div class="form-group">
        <label for="treasure-hint-title-${escapeHtml(hint.id)}">Hint Title</label>
        <input type="text" class="treasure-hint-title-input" id="treasure-hint-title-${escapeHtml(hint.id)}" value="${escapeHtml(hint.title || '')}">
      </div>
      <div class="form-group">
        <label for="treasure-hint-description-${escapeHtml(hint.id)}">Hint Description</label>
        <textarea class="treasure-hint-description-input" id="treasure-hint-description-${escapeHtml(hint.id)}" rows="4">${escapeHtml(hint.description || '')}</textarea>
      </div>
      ${hint.proofImageUrl ? `<a class="treasure-proof-link" href="${escapeHtml(hint.proofImageUrl)}" target="_blank" rel="noreferrer">Proof image</a>` : '<div class="treasure-admin-proof-note">No proof image yet.</div>'}
      ${hint.proofNote ? `<div class="treasure-admin-proof-note">${escapeHtml(hint.proofNote)}</div>` : ''}
      <div class="treasure-admin-hint-actions">
        <button type="button" class="cta-button secondary-btn treasure-save-hint-btn" data-id="${escapeHtml(hint.id)}">Save Hint</button>
      </div>
    `;
    hintsWrap.appendChild(card);
  });

  const resetProgressButton = document.getElementById('btn-reset-treasure-progress');
  if (resetProgressButton) {
    resetProgressButton.addEventListener('click', handleResetTreasureProgress);
  }

  const clearHintsButton = document.getElementById('btn-clear-treasure-hints');
  if (clearHintsButton) {
    clearHintsButton.addEventListener('click', handleClearTreasureHints);
  }

  document.querySelectorAll('.treasure-save-hint-btn').forEach(btn => {
    btn.addEventListener('click', handleUpdateTreasureHint);
  });

  document.querySelectorAll('.treasure-delete-hint-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteTreasureHint);
  });
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

  const treasureUnlockForm = document.getElementById('treasure-unlock-form');
  if (treasureUnlockForm) {
    treasureUnlockForm.addEventListener('submit', handleTreasureUnlock);
  }

  // Profile Management
  const profileForm = document.getElementById('form-update-profile');
  if (profileForm) {
    profileForm.addEventListener('submit', handleUpdateProfile);
  }

  const profileSelect = document.getElementById('profile-person-select');
  if (profileSelect) {
    profileSelect.addEventListener('change', handleProfilePersonSelect);
  }

  const profileImageFile = document.getElementById('input-profile-image-file');
  if (profileImageFile) {
    profileImageFile.addEventListener('change', handleProfileImageFileChange);
  }

  // Admin Actions: Clear Ledger Purge
  const clearButton = document.getElementById('btn-clear-ledger');
  if (clearButton) {
    clearButton.addEventListener('click', handleClearLedger);
  }

  const purgePersonForm = document.getElementById('form-purge-person');
  if (purgePersonForm) {
    purgePersonForm.addEventListener('submit', handlePurgePerson);
  }

  // Manage Game Leaderboard Search
  const searchInput = document.getElementById('admin-leaderboard-search');
  if (searchInput) {
    searchInput.addEventListener('input', renderAdminLeaderboard);
  }

  const treasureToggle = document.getElementById('treasure-enabled-toggle');
  if (treasureToggle) {
    treasureToggle.addEventListener('change', handleTreasureVisibilityToggle);
  }

  const treasureHintForm = document.getElementById('form-add-treasure-hint');
  if (treasureHintForm) {
    treasureHintForm.addEventListener('submit', handleAddTreasureHint);
  }

  const treasureProofFile = document.getElementById('treasure-proof-image-file');
  if (treasureProofFile) {
    treasureProofFile.addEventListener('change', handleTreasureProofFileChange);
  }

  const treasureUnlockNextButton = document.getElementById('btn-unlock-next-treasure-hunt');
  if (treasureUnlockNextButton) {
    treasureUnlockNextButton.addEventListener('click', handleUnlockNextTreasureChallenge);
  }

  // Toggle Board # visibility based on chosen Type
  const profileTypeSelect = document.getElementById('input-profile-type');
  if (profileTypeSelect) {
    profileTypeSelect.addEventListener('change', () => {
      const boardGroup = document.getElementById('group-profile-board');
      const boardInput = document.getElementById('input-profile-board');
      if (profileTypeSelect.value === 'external') {
        if (boardGroup) boardGroup.classList.add('hidden');
        if (boardInput) boardInput.value = '';
      } else {
        if (boardGroup) boardGroup.classList.remove('hidden');
      }
    });
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

async function handleTreasureUnlock(e) {
  e.preventDefault();

  const codeInput = document.getElementById('treasure-code-input');
  const errorEl = document.getElementById('treasure-unlock-error');

  try {
    const response = await fetch(`${API_BASE}/auth-treasure-hunt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput.value })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to unlock treasure hunt');
    }

    STATE.treasureToken = result.token;
    localStorage.setItem('treasure_hunt_token', result.token);
    codeInput.value = '';
    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    }

    await checkTreasureAuth();
    await fetchData();
  } catch (error) {
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = error.message;
    } else {
      alert(error.message);
    }
  }
}

async function handleTreasureVisibilityToggle(e) {
  const payload = {
    action: 'update_treasure_hunt_settings',
    enabled: e.currentTarget.checked
  };

  await sendAdminAction(payload);
}

async function handleAddTreasureHint(e) {
  e.preventDefault();

  const payload = {
    action: 'add_treasure_hunt_hint',
    title: document.getElementById('treasure-hint-title').value.trim(),
    description: document.getElementById('treasure-hint-description').value.trim()
  };

  const success = await sendAdminAction(payload);
  if (success) {
    document.getElementById('treasure-hint-title').value = '';
    document.getElementById('treasure-hint-description').value = '';
  }
}

async function handleUpdateTreasureHint(e) {
  const hintId = e.currentTarget.getAttribute('data-id');
  if (!hintId) return;

  const card = e.currentTarget.closest('.treasure-admin-hint');
  const titleInput = card ? card.querySelector('.treasure-hint-title-input') : null;
  const descriptionInput = card ? card.querySelector('.treasure-hint-description-input') : null;

  const payload = {
    action: 'update_treasure_hunt_hint',
    hintId,
    title: titleInput ? titleInput.value.trim() : '',
    description: descriptionInput ? descriptionInput.value.trim() : ''
  };

  await sendAdminAction(payload);
}

async function handleResetTreasureProgress() {
  if (confirm('Reset the current treasure progress? This will keep the hints but remove all proof images and set the hunt back to stage 0.')) {
    await sendAdminAction({ action: 'reset_treasure_hunt_progress' });
  }
}

async function handleClearTreasureHints() {
  if (confirm('Remove all treasure hints and proof images entirely? This will also disable the hunt.')) {
    await sendAdminAction({ action: 'clear_treasure_hunt_hints' });
  }
}

async function handleDeleteTreasureHint(e) {
  const hintId = e.currentTarget.getAttribute('data-id');
  if (!hintId) return;

  if (confirm('Delete this treasure hint?')) {
    await sendAdminAction({
      action: 'delete_treasure_hunt_hint',
      hintId
    });
  }
}

async function handleTreasureProofFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('treasure-proof-upload-status');
  const hiddenInput = document.getElementById('treasure-proof-image-url');
  const previewWrap = document.getElementById('treasure-proof-preview-wrap');
  const previewImg = document.getElementById('treasure-proof-preview');

  const showStatus = (text) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove('hidden');
  };

  if (file.size > MAX_IMAGE_BYTES) {
    showStatus('Image too large (max 3MB).');
    e.target.value = '';
    return;
  }

  if (!STATE.token) {
    alert('Authentication required to upload images.');
    e.target.value = '';
    return;
  }

  try {
    showStatus('Uploading…');

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });

    const response = await fetch(`${API_BASE}/upload-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ imageData: dataUrl, personName: 'treasure-hunt-proof' })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Upload failed');
    }

    hiddenInput.value = result.url;
    if (previewImg && previewWrap) {
      previewImg.src = result.url;
      previewWrap.classList.remove('hidden');
    }
    showStatus('Uploaded ✓');
    setTimeout(() => statusEl && statusEl.classList.add('hidden'), 2000);
  } catch (error) {
    showStatus('Upload error: ' + error.message);
    e.target.value = '';
  }
}

async function handleUnlockNextTreasureChallenge() {
  const payload = {
    action: 'unlock_treasure_hunt_next',
    proofImageUrl: document.getElementById('treasure-proof-image-url').value.trim(),
    proofNote: document.getElementById('treasure-proof-note').value.trim()
  };

  const success = await sendAdminAction(payload);
  if (success) {
    document.getElementById('treasure-proof-image-file').value = '';
    document.getElementById('treasure-proof-image-url').value = '';
    document.getElementById('treasure-proof-note').value = '';
    const previewWrap = document.getElementById('treasure-proof-preview-wrap');
    const previewImg = document.getElementById('treasure-proof-preview');
    const statusEl = document.getElementById('treasure-proof-upload-status');
    if (previewImg) previewImg.src = '';
    if (previewWrap) previewWrap.classList.add('hidden');
    if (statusEl) {
      statusEl.classList.add('hidden');
      statusEl.textContent = '';
    }
  }
}

// ==========================================================================
// PERSON DROPDOWNS (Log Any Received / Log Any Taken)
// ==========================================================================
function populatePersonSelects() {
  const receivedSelect = document.getElementById('input-received-person');
  const takenSelect = document.getElementById('input-taken-person');
  const receivedHint = document.getElementById('received-no-people-hint');
  const takenHint = document.getElementById('taken-no-people-hint');

  if (receivedSelect) {
    const current = receivedSelect.value;
    receivedSelect.innerHTML = '<option value="" disabled selected>Select a person…</option>';

    STATE.anytimers.forEach(person => {
      const opt = document.createElement('option');
      opt.value = person.name;
      opt.textContent = person.name;
      receivedSelect.appendChild(opt);
    });

    if (current && STATE.anytimers.some(p => p.name === current)) {
      receivedSelect.value = current;
    }
  }

  const purgeSelect = document.getElementById('purge-person-select');
  if (purgeSelect) {
    const current = purgeSelect.value;
    purgeSelect.innerHTML = '<option value="" disabled selected>Select a person to delete…</option>';

    STATE.anytimers.forEach(person => {
      const opt = document.createElement('option');
      opt.value = person.name;
      opt.textContent = person.name;
      purgeSelect.appendChild(opt);
    });

    if (current && STATE.anytimers.some(p => p.name === current)) {
      purgeSelect.value = current;
    }
  }

  if (receivedHint) {
    receivedHint.classList.toggle('hidden', STATE.anytimers.length > 0);
  }

  if (takenSelect) {
    const current = takenSelect.value;
    takenSelect.innerHTML = '<option value="" disabled selected>Select a person…</option>';

    const eligible = STATE.anytimers.filter(person => person.outstanding > 0);
    eligible.forEach(person => {
      const opt = document.createElement('option');
      opt.value = person.name;
      opt.textContent = `${person.name} (${person.outstanding} owed)`;
      takenSelect.appendChild(opt);
    });

    if (current && eligible.some(p => p.name === current)) {
      takenSelect.value = current;
    }

    if (takenHint) {
      takenHint.classList.toggle('hidden', eligible.length > 0);
    }
  }

}

// ==========================================================================
// PROFILE MANAGEMENT (Image, Role, Fun Fact)
// ==========================================================================
function populateProfileSelect() {
  const select = document.getElementById('profile-person-select');
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML = '<option value="">+ New person</option>';

  STATE.anytimers.forEach(person => {
    const opt = document.createElement('option');
    opt.value = person.name;
    opt.textContent = person.name;
    select.appendChild(opt);
  });

  if (currentValue && STATE.anytimers.some(p => p.name === currentValue)) {
    select.value = currentValue;
  }
}

function setProfileImagePreview(imageUrl) {
  const previewWrap = document.getElementById('profile-image-preview-wrap');
  const previewImg = document.getElementById('profile-image-preview');
  if (!previewWrap || !previewImg) return;

  if (imageUrl) {
    previewImg.src = imageUrl;
    previewWrap.classList.remove('hidden');
  } else {
    previewImg.src = '';
    previewWrap.classList.add('hidden');
  }
}

function handleProfilePersonSelect() {
  const select = document.getElementById('profile-person-select');
  const nameInput = document.getElementById('input-profile-name');
  const imageInput = document.getElementById('input-profile-image'); // hidden, holds the resolved URL
  const fileInput = document.getElementById('input-profile-image-file');
  const typeSelect = document.getElementById('input-profile-type');
  const roleInput = document.getElementById('input-profile-role');
  const boardInput = document.getElementById('input-profile-board');
  const boardGroup = document.getElementById('group-profile-board');
  const funFactInput = document.getElementById('input-profile-funfact');
  const statusEl = document.getElementById('profile-image-upload-status');

  const selectedName = select.value;

  // Switching people always clears any in-progress file selection/status
  if (fileInput) fileInput.value = '';
  if (statusEl) statusEl.classList.add('hidden');

  if (!selectedName) {
    nameInput.value = '';
    nameInput.disabled = false;
    imageInput.value = '';
    if (typeSelect) {
      typeSelect.value = 'treasurer';
    }
    roleInput.value = '';
    if (boardInput) {
      boardInput.value = '';
    }
    if (boardGroup) {
      boardGroup.classList.remove('hidden');
    }
    funFactInput.value = '';
    setProfileImagePreview('');
    return;
  }

  const person = STATE.anytimers.find(p => p.name === selectedName);
  nameInput.value = selectedName;
  nameInput.disabled = true;
  imageInput.value = person?.imageUrl || '';
  if (typeSelect) {
    typeSelect.value = person?.type || 'treasurer';
  }
  roleInput.value = person?.role || '';
  if (boardInput) {
    boardInput.value = person?.boardNumber || '';
  }

  if (boardGroup) {
    if (person?.type === 'external') {
      boardGroup.classList.add('hidden');
    } else {
      boardGroup.classList.remove('hidden');
    }
  }

  funFactInput.value = person?.funFact || '';
  setProfileImagePreview(person?.imageUrl || '');
}

// Reads the chosen file, uploads it to /api/upload-image, and stores the
// resulting permanent URL in the hidden #input-profile-image field.
async function handleProfileImageFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('profile-image-upload-status');
  const hiddenInput = document.getElementById('input-profile-image');

  const showStatus = (text) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove('hidden');
  };

  if (file.size > MAX_IMAGE_BYTES) {
    showStatus('Image too large (max 3MB).');
    e.target.value = '';
    return;
  }

  if (!STATE.token) {
    alert('Authentication required to upload images.');
    e.target.value = '';
    return;
  }

  try {
    showStatus('Uploading…');

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });

    const select = document.getElementById('profile-person-select');
    const nameInput = document.getElementById('input-profile-name');
    const personName = ((select && select.value) || (nameInput && nameInput.value) || 'person').trim();

    const response = await fetch(`${API_BASE}/upload-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ imageData: dataUrl, personName })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Upload failed');
    }

    hiddenInput.value = result.url;
    setProfileImagePreview(result.url);
    showStatus('Uploaded ✓');
    setTimeout(() => statusEl && statusEl.classList.add('hidden'), 2000);
  } catch (error) {
    showStatus('Upload error: ' + error.message);
    e.target.value = '';
  }
}

async function handleUpdateProfile(e) {
  e.preventDefault();

  const select = document.getElementById('profile-person-select');
  const nameInput = document.getElementById('input-profile-name');
  const successMsg = document.getElementById('profile-success-msg');

  const personName = (select.value || nameInput.value).trim();
  if (!personName) {
    alert('Please select an existing person, or type a name to create a new profile.');
    return;
  }

  const payload = {
    action: 'update_profile',
    personName,
    imageUrl: document.getElementById('input-profile-image').value.trim(),
    role: document.getElementById('input-profile-role').value.trim(),
    boardNumber: document.getElementById('input-profile-board') ? document.getElementById('input-profile-board').value.trim() : '',
    funFact: document.getElementById('input-profile-funfact').value.trim(),
    type: document.getElementById('input-profile-type') ? document.getElementById('input-profile-type').value : 'treasurer'
  };

  const success = await sendAdminAction(payload);
  if (success && successMsg) {
    successMsg.classList.remove('hidden');
    setTimeout(() => successMsg.classList.add('hidden'), 2500);
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

async function handlePurgePerson(e) {
  e.preventDefault();
  const select = document.getElementById('purge-person-select');
  const personName = select.value;

  if (!personName) return;

  if (confirm(`⚠️ WARNING: Are you sure you want to permanently delete ${personName}? This will wipe their profile and remove all their transactions from the ledger.`)) {
    const payload = {
      action: 'delete_person',
      personName: personName
    };
    const success = await sendAdminAction(payload);
    if (success) {
      select.value = ''; // Reset the dropdown on success
    }
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
    STATE.gameLeaderboard = resData.gameLeaderboard || [];
    STATE.treasureHunt = resData.treasureHunt || STATE.treasureHunt;

    renderDashboard();
    renderAnytimers();
    renderLedger();
    renderAdminLeaderboard();
    renderTreasureHunt();
    renderTreasureAdminPanel();
    populateProfileSelect();
    populatePersonSelects();

    return true;
  } catch (error) {
    alert('Admin Error: ' + error.message);
    return false;
  }
}

// ==========================================================================
// GAME LEADERBOARD
// ==========================================================================
function renderAdminLeaderboard() {
  const tbody = document.getElementById('admin-leaderboard-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (STATE.gameLeaderboard.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">No scores recorded yet.</td></tr>`;
    return;
  }

  const searchInput = document.getElementById('admin-leaderboard-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filteredScores = STATE.gameLeaderboard.filter(score =>
    String(score.playerName || '').toLowerCase().includes(query)
  );

  if (filteredScores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">No matching scores found.</td></tr>`;
    return;
  }

  filteredScores.forEach(score => {
    const globalRank = STATE.gameLeaderboard.findIndex(s => s.id === score.id) + 1;
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td><strong>#${globalRank}</strong></td>
      <td>${escapeHtml(score.playerName)}</td>
      <td><strong>${score.score}</strong> pts</td>
      <td>
        <button class="delete-tx-btn rename-score-btn" data-id="${score.id}" data-name="${escapeHtml(score.playerName)}" title="Rename player">✏️</button>
        <button class="delete-tx-btn delete-score-btn" data-id="${score.id}" title="Delete score">🗑️</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (STATE.isAuthenticated) {
    document.querySelectorAll('.rename-score-btn').forEach(btn => {
      btn.addEventListener('click', handleRenameGamePlayer);
    });
    document.querySelectorAll('.delete-score-btn').forEach(btn => {
      btn.addEventListener('click', handleDeleteGameScore);
    });
  }
}

async function handleRenameGamePlayer(e) {
  const currentName = e.currentTarget.getAttribute('data-name');
  if (!currentName) return;

  const nextName = prompt(`Rename all leaderboard entries for "${currentName}" to:`, currentName);
  if (nextName === null) return;

  const trimmedName = nextName.trim();
  if (!trimmedName) {
    alert('Please enter a valid name.');
    return;
  }

  if (trimmedName === currentName) {
    return;
  }

  const payload = {
    action: 'rename_game_player',
    playerName: currentName,
    newPlayerName: trimmedName
  };

  const success = await sendAdminAction(payload);
  if (success && localStorage.getItem('ninjaPlayerName') === currentName) {
    localStorage.setItem('ninjaPlayerName', trimmedName);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'ninjaPlayerName',
      oldValue: currentName,
      newValue: trimmedName,
      storageArea: localStorage,
      url: window.location.href
    }));
  }
}

async function handleDeleteGameScore(e) {
  const scoreId = e.currentTarget.getAttribute('data-id');
  if (!scoreId) return;

  if (confirm('Are you sure you want to permanently delete this game score?')) {
    const payload = {
      action: 'delete_game_score',
      scoreId
    };
    await sendAdminAction(payload);
  }
}