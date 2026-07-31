const API_BASE = '/api';

const STATE = {
    treasureHunt: {
        enabled: false,
        currentStage: 0,
        completed: false,
        hints: []
    },
    treasureToken: localStorage.getItem('treasure_hunt_token') || null
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

async function fetchTreasureData() {
    const headers = {};
    if (STATE.treasureToken) {
        headers.Authorization = `Bearer ${STATE.treasureToken}`;
    }

    const response = await fetch(`${API_BASE}/data`, { headers });
    if (!response.ok) {
        throw new Error('Failed to load treasure hunt');
    }

    const data = await response.json();
    STATE.treasureHunt = data.treasureHunt || STATE.treasureHunt;
}

async function checkTreasureAuth() {
    if (!STATE.treasureToken) {
        setTreasureAuthState(false);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/data?check_treasure_auth=true`, {
            headers: { Authorization: `Bearer ${STATE.treasureToken}` }
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
    const lockedPanel = document.getElementById('treasure-page-locked');
    const contentPanel = document.getElementById('treasure-page-content');
    const emptyPanel = document.getElementById('treasure-page-empty');
    const statusPanel = document.getElementById('treasure-page-status');
    const errorEl = document.getElementById('treasure-page-error');

    if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
    }

    const enabled = !!STATE.treasureHunt.enabled;
    if (statusPanel) {
        statusPanel.classList.toggle('hidden', !enabled);
    }

    if (!enabled) {
        if (lockedPanel) lockedPanel.classList.add('hidden');
        if (contentPanel) contentPanel.classList.add('hidden');
        if (emptyPanel) emptyPanel.classList.remove('hidden');
        return;
    }

    if (emptyPanel) emptyPanel.classList.add('hidden');
    const canSeeContent = isAuth || !!STATE.treasureHunt.completed;
    if (lockedPanel && contentPanel) {
        lockedPanel.classList.toggle('hidden', canSeeContent);
        contentPanel.classList.toggle('hidden', !canSeeContent);
    }
}

function renderTreasurePage() {
    const intro = document.getElementById('treasure-page-intro');
    const visibleCount = document.getElementById('treasure-page-visible-count');
    const hintList = document.getElementById('treasure-page-hint-list');

    const enabled = !!STATE.treasureHunt.enabled;
    const stageCount = Math.min(STATE.treasureHunt.currentStage || 0, (STATE.treasureHunt.hints || []).length);

    if (intro) {
        intro.textContent = enabled
            ? (STATE.treasureHunt.completed
                ? 'The treasure hunt is completed! Congratulations! You have unlocked all the hints and reached the end of the hunt.'
                : (STATE.treasureToken ? 'The treasure hunt has started! Good luck!' : 'The hunt is live. Enter the secret code to reveal the first clue.'))
            : 'This hunt is hidden until the admins switch it on.';
    }

    if (visibleCount) {
        visibleCount.textContent = String(stageCount);
    }

    if (!hintList) {
        return;
    }

    if (!enabled) {
        hintList.innerHTML = '';
        return;
    }

    if (STATE.treasureHunt.completed && !STATE.treasureToken) {
        hintList.innerHTML = `
      <div class="card treasure-page-complete">
        <h3>Treasure Hunt Complete</h3>
        <p>You made it to the end of the route. Thanks for taking part in the hunt.</p>
      </div>
    `;
        return;
    }

    if (!STATE.treasureToken) {
        hintList.innerHTML = '<div class="treasure-page-empty">Unlock the hunt to see the first clue.</div>';
        return;
    }

    const visibleHints = (STATE.treasureHunt.hints || []).slice(0, stageCount);
    if (visibleHints.length === 0) {
        hintList.innerHTML = (STATE.treasureHunt.hints || []).length > 0
            ? '<div class="treasure-page-empty">The hunt has been reset. Wait for the admins to unlock the next challenge.</div>'
            : '<div class="treasure-page-empty">No hints have been added yet.</div>';
        return;
    }

    hintList.innerHTML = '';
    visibleHints.forEach((hint, index) => {
        const card = document.createElement('article');
        card.className = 'card treasure-page-hint-card';
        card.innerHTML = `
      <div class="treasure-page-hint-badge">Hint ${index + 1}</div>
      <h3>${escapeHtml(hint.title || `Hint ${index + 1}`)}</h3>
      <p>${escapeHtml(hint.description || '')}</p>
    `;
        hintList.appendChild(card);
    });

    if (STATE.treasureHunt.completed) {
        const completeCard = document.createElement('div');
        completeCard.className = 'card treasure-page-complete';
        completeCard.innerHTML = `
      <h3>Treasure Hunt Complete</h3>
      <p>You made it to the end of the treasure hunt! Congratulations! You are now a real treasurer.</p>
    `;
        hintList.appendChild(completeCard);
    }
}

async function handleUnlock(e) {
    e.preventDefault();

    const codeInput = document.getElementById('treasure-page-code');
    const errorEl = document.getElementById('treasure-page-error');

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
        await loadTreasurePage();
    } catch (error) {
        if (errorEl) {
            errorEl.classList.remove('hidden');
            errorEl.textContent = error.message;
        } else {
            alert(error.message);
        }
    }
}

async function loadTreasurePage() {
    try {
        await fetchTreasureData();
        setTreasureAuthState(!!STATE.treasureToken);
        renderTreasurePage();
    } catch (error) {
        const intro = document.getElementById('treasure-page-intro');
        if (intro) {
            intro.textContent = error.message;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const unlockForm = document.getElementById('treasure-page-unlock-form');
    if (unlockForm) {
        unlockForm.addEventListener('submit', handleUnlock);
    }

    await checkTreasureAuth();
    await loadTreasurePage();
});