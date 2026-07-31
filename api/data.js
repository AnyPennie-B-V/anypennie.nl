const fs = require('fs');
const path = require('path');
const { verifyToken, verifyTreasureToken } = require('./_auth');
const { del: deleteBlob } = require('@vercel/blob');

const localDataPath = path.join(process.cwd(), 'data.json');
let inMemoryData = null;

const DEFAULT_DATA = {
  anytimers: [],
  ledger: [],
  gameLeaderboard: [],
  treasureHunt: {
    enabled: false,
    currentStage: 0,
    completed: false,
    hints: []
  }
};

// Helper to read data with dual-mode storage
async function getScoreboardData() {
  // 1. Try Vercel KV via REST API
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const response = await fetch(process.env.KV_REST_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['GET', 'scoreboard_data'])
      });
      const resData = await response.json();
      if (resData.result) {
        const parsed = JSON.parse(resData.result);
        return { data: parsed, warning: false };
      }
    } catch (err) {
      console.error('Failed to fetch from Vercel KV, falling back:', err);
    }
  }

  // 2. Try In-Memory Cache
  if (inMemoryData) {
    return { data: inMemoryData, warning: !!process.env.VERCEL };
  }

  // 3. Try Local File
  try {
    if (fs.existsSync(localDataPath)) {
      const fileContent = fs.readFileSync(localDataPath, 'utf8');
      const data = JSON.parse(fileContent);
      if (process.env.VERCEL) {
        inMemoryData = data; // Cache on Vercel
      }
      return { data, warning: !!process.env.VERCEL };
    }
  } catch (err) {
    console.error('Failed to read local data.json:', err);
  }

  // Fallback default
  return { data: { ...DEFAULT_DATA }, warning: !!process.env.VERCEL };
}

// Helper to save data with dual-mode storage
async function saveScoreboardData(data) {
  // 1. Try Vercel KV
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const response = await fetch(process.env.KV_REST_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', 'scoreboard_data', JSON.stringify(data)])
      });
      const resData = await response.json();
      if (resData.result === 'OK') {
        return { success: true, storage: 'kv' };
      }
    } catch (err) {
      console.error('Failed to write to Vercel KV:', err);
    }
  }

  // Always update in-memory cache
  inMemoryData = data;

  // 2. Try writing to local file (succeeds locally, fails on deployed serverless function)
  try {
    fs.writeFileSync(localDataPath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, storage: 'file' };
  } catch (err) {
    console.warn('Read-only filesystem detected. Saved to in-memory cache.');
    return { success: true, storage: 'memory_warning' };
  }
}

function normalizePersonName(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  return normalized
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function createLedgerEntryId() {
  return 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
}

function createDefaultPerson(name) {
  return {
    name,
    outstanding: 0,
    received: 0,
    taken: 0,
    imageUrl: '',
    role: '',
    boardNumber: '',
    funFact: '',
    type: 'treasurer'
  };
}

function toSafeQuantity(value) {
  const quantity = parseInt(value, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

// Trims and caps the length of a free-text profile field
function sanitizeProfileText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function getDeduplicatedLeaderboard(rawLeaderboard) {
  const uniqueScores = new Map();
  rawLeaderboard.forEach(entry => {
    const key = (entry.playerName || 'Anonymous').toLowerCase();
    if (!uniqueScores.has(key)) {
      uniqueScores.set(key, entry);
    } else {
      const existing = uniqueScores.get(key);
      if (entry.score > existing.score) {
        uniqueScores.set(key, entry);
      } else if (entry.score === existing.score) {
        if (new Date(entry.timestamp) > new Date(existing.timestamp)) {
          uniqueScores.set(key, entry);
        }
      }
    }
  });
  return Array.from(uniqueScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
}

function normalizeLeaderboardName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function getLeaderboardNameKey(name) {
  return normalizeLeaderboardName(name).toLowerCase();
}

function createTreasureHintId() {
  return 'hint-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
}

function sanitizeTreasureHint(hint) {
  const title = sanitizeProfileText(hint?.title, 120);
  const description = sanitizeProfileText(hint?.description, 1000);
  const id = sanitizeProfileText(hint?.id, 80) || createTreasureHintId();

  return {
    id,
    title,
    description,
    proofImageUrl: sanitizeProfileText(hint?.proofImageUrl, 500),
    proofNote: sanitizeProfileText(hint?.proofNote, 300),
    unlockedAt: sanitizeProfileText(hint?.unlockedAt, 80)
  };
}

function sanitizeTreasureHunt(rawTreasureHunt) {
  const source = rawTreasureHunt && typeof rawTreasureHunt === 'object' ? rawTreasureHunt : {};
  const hints = Array.isArray(source.hints)
    ? source.hints.map(sanitizeTreasureHint).filter(hint => hint.title || hint.description)
    : [];

  let currentStage = parseInt(source.currentStage, 10);
  if (!Number.isFinite(currentStage) || currentStage < 0) {
    currentStage = 0;
  }

  currentStage = Math.min(currentStage, hints.length);

  if (!source.enabled) {
    currentStage = 0;
  }

  const completed = !!source.completed && !!source.enabled && hints.length > 0 && currentStage >= hints.length;

  return {
    enabled: !!source.enabled,
    currentStage,
    completed,
    hints
  };
}

async function deleteTreasureProofAsset(imageUrl) {
  const safeUrl = String(imageUrl || '').trim();
  if (!safeUrl) {
    return;
  }

  if (/^assets\/uploads\//i.test(safeUrl)) {
    const localFilePath = path.join(process.cwd(), safeUrl);
    if (localFilePath.startsWith(path.join(process.cwd(), 'assets')) && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (err) {
        console.warn('Failed to delete local treasure proof asset:', err.message);
      }
    }
    return;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN && /^https?:\/\//i.test(safeUrl)) {
    try {
      await deleteBlob(safeUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch (err) {
      console.warn('Failed to delete blob treasure proof asset:', err.message);
    }
  }
}

async function deleteTreasureProofAssets(hints) {
  const uniqueUrls = [...new Set(
    (Array.isArray(hints) ? hints : [])
      .map(hint => hint?.proofImageUrl)
      .filter(Boolean)
  )];

  await Promise.all(uniqueUrls.map(deleteTreasureProofAsset));
}

// Recalculates balances from the ledger to ensure consistent state
function recalculateTotals(data) {
  const cleanData = {
    anytimers: Array.isArray(data.anytimers) ? data.anytimers : [],
    ledger: Array.isArray(data.ledger) ? data.ledger : [],
    gameLeaderboard: Array.isArray(data.gameLeaderboard) ? data.gameLeaderboard : [],
    treasureHunt: sanitizeTreasureHunt(data.treasureHunt)
  };

  // Profile info (image, role, fun fact) is NOT derived from the ledger, so
  // preserve it separately, keyed by normalized name. Balances are always
  // rebuilt from scratch below.
  const profiles = new Map();
  cleanData.anytimers.forEach(person => {
    const name = normalizePersonName(person.name);
    if (!name) {
      return;
    }
    profiles.set(name, {
      imageUrl: sanitizeProfileText(person.imageUrl, 500),
      role: sanitizeProfileText(person.role, 60),
      boardNumber: sanitizeProfileText(person.boardNumber, 34),
      funFact: sanitizeProfileText(person.funFact, 200),
      type: sanitizeProfileText(person.type, 20)
    });
  });

  const balances = new Map();

  const chronologicalLedger = [...cleanData.ledger].sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  chronologicalLedger.forEach(tx => {
    if (tx.type !== 'any_received' && tx.type !== 'any_taken') {
      return;
    }

    const personName = normalizePersonName(tx.personName || tx.person || tx.name);
    if (!personName) {
      return;
    }

    const quantity = toSafeQuantity(tx.quantity) || 1;
    const existing = balances.get(personName) || createDefaultPerson(personName);

    if (tx.type === 'any_received') {
      existing.outstanding += quantity;
      existing.received += quantity;
    } else {
      existing.outstanding = Math.max(0, existing.outstanding - quantity);
      existing.taken += quantity;
    }

    balances.set(personName, existing);
    tx.personName = personName;
    tx.quantity = quantity;
    tx.balanceAfter = existing.outstanding;
  });

  // People with a saved profile but no ledger activity yet should still show up
  profiles.forEach((profile, name) => {
    if (!balances.has(name)) {
      balances.set(name, createDefaultPerson(name));
    }
  });

  // Re-attach profile info to every person
  balances.forEach((person, name) => {
    const profile = profiles.get(name) || { imageUrl: '', role: '', funFact: '', type: 'treasurer' };
    person.imageUrl = profile.imageUrl;
    person.role = profile.role;
    person.boardNumber = profile.boardNumber;
    person.funFact = profile.funFact;
    person.type = profile.type || 'treasurer';
  });

  const anytimers = Array.from(balances.values()).sort((a, b) => {
    if (b.outstanding !== a.outstanding) {
      return b.outstanding - a.outstanding;
    }
    return a.name.localeCompare(b.name);
  });

  cleanData.anytimers = anytimers;
  cleanData.ledger = chronologicalLedger;
  cleanData.totalOutstanding = anytimers.reduce((sum, person) => sum + person.outstanding, 0);

  return cleanData;
}

// Utility to parse request body if not already parsed
function getRequestBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined) {
      resolve(req.body);
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { data, warning } = await getScoreboardData();
  const cleanData = recalculateTotals(data);

  if (req.method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const wantAllGames = urlObj.searchParams.get('all_games') === 'true';
    const checkAuth = urlObj.searchParams.get('check_auth') === 'true';
    const checkTreasureAuth = urlObj.searchParams.get('check_treasure_auth') === 'true';
    const isAdmin = verifyToken(req);
    const isTreasure = verifyTreasureToken(req);

    if (checkAuth && !isAdmin) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (checkTreasureAuth && !isTreasure) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const showAllLeaderboard = wantAllGames && isAdmin;
    const leaderboardToSend = showAllLeaderboard 
      ? cleanData.gameLeaderboard 
      : getDeduplicatedLeaderboard(cleanData.gameLeaderboard);

    const treasureHuntToSend = isAdmin
      ? cleanData.treasureHunt
      : isTreasure
        ? {
            enabled: cleanData.treasureHunt.enabled,
            currentStage: cleanData.treasureHunt.currentStage,
            completed: cleanData.treasureHunt.completed,
            hints: cleanData.treasureHunt.hints.slice(0, cleanData.treasureHunt.currentStage)
          }
        : {
            enabled: cleanData.treasureHunt.enabled,
            currentStage: cleanData.treasureHunt.completed ? cleanData.treasureHunt.hints.length : 0,
            completed: cleanData.treasureHunt.completed,
            hints: cleanData.treasureHunt.completed ? cleanData.treasureHunt.hints : []
          };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      anytimers: cleanData.anytimers,
      totalOutstanding: cleanData.totalOutstanding,
      ledger: cleanData.ledger,
      gameLeaderboard: leaderboardToSend,
      treasureHunt: treasureHuntToSend,
      storageWarning: warning
    }));
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const action = body.action;

      // Verify admin privileges for all actions except log_game_score
      if (action !== 'log_game_score' && !verifyToken(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Admin privileges required' }));
        return;
      }

      if (action === 'log_any_received') {
        const { personName, quantity, note, admin, timestamp } = body;
        const normalizedName = normalizePersonName(personName);
        const safeQuantity = toSafeQuantity(quantity);

        if (!normalizedName || !safeQuantity || !admin) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        const newTx = {
          id: createLedgerEntryId(),
          timestamp: timestamp || new Date().toISOString(),
          type: 'any_received',
          personName: normalizedName,
          quantity: safeQuantity,
          change: safeQuantity,
          balanceAfter: 0,
          admin,
          note: note || ''
        };

        cleanData.ledger.push(newTx);
      } else if (action === 'log_any_taken') {
        const { personName, quantity, note, admin, timestamp } = body;
        const normalizedName = normalizePersonName(personName);
        const safeQuantity = toSafeQuantity(quantity);

        if (!normalizedName || !safeQuantity || !admin) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        const existingPerson = cleanData.anytimers.find(person => person.name.toLowerCase() === normalizedName.toLowerCase());
        if (!existingPerson) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No outstanding anytimers recorded for ${normalizedName}` }));
          return;
        }

        if (safeQuantity > existingPerson.outstanding) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `${normalizedName} only has ${existingPerson.outstanding} anytimers remaining` }));
          return;
        }

        const newTx = {
          id: createLedgerEntryId(),
          timestamp: timestamp || new Date().toISOString(),
          type: 'any_taken',
          personName: normalizedName,
          quantity: safeQuantity,
          change: -safeQuantity,
          balanceAfter: Math.max(0, existingPerson.outstanding - safeQuantity),
          admin,
          note: note || ''
        };

        cleanData.ledger.push(newTx);
      } else if (action === 'update_profile') {
        const { personName, imageUrl, role, funFact, type } = body;
        const normalizedName = normalizePersonName(personName);

        if (!normalizedName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameter: personName' }));
          return;
        }

        const safeImageUrl = sanitizeProfileText(imageUrl, 500);
        // Accept either a permanent https:// URL (e.g. a Vercel Blob URL) or
        // a local relative path under assets/ (used by the local-dev upload
        // fallback when no Blob store is configured).
        if (safeImageUrl && !/^(https?:\/\/|assets\/)/i.test(safeImageUrl)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Image URL must be an https:// link or a local assets/ path' }));
          return;
        }

        let person = cleanData.anytimers.find(p => normalizePersonName(p.name) === normalizedName);
        if (!person) {
          person = createDefaultPerson(normalizedName);
          cleanData.anytimers.push(person);
        }

        person.imageUrl = safeImageUrl;
        person.role = sanitizeProfileText(role, 60);
        person.boardNumber = sanitizeProfileText(body.boardNumber, 34);
        person.funFact = sanitizeProfileText(funFact, 200);
        person.type = sanitizeProfileText(type, 20) || 'treasurer';
      } else if (action === 'delete_transaction') {
        const { transactionId } = body;
        if (!transactionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing transactionId' }));
          return;
        }

        cleanData.ledger = cleanData.ledger.filter(tx => tx.id !== transactionId);
      } else if (action === 'clear_ledger') {
        cleanData.ledger = [];
      } else if (action === 'delete_person'){
        const { personName } = body;
        const normalizedName = normalizePersonName(personName);

        if (!normalizedName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameter: personName' }));
          return;
        }

        cleanData.ledger = cleanData.ledger.filter(
          tx => normalizePersonName(tx.personName || tx.person || tx.name) !== normalizedName
        );

        cleanData.anytimers = cleanData.anytimers.filter(
          p => normalizePersonName(p.name) !== normalizedName
        );
      } else if (action === 'log_game_score') {
        const { playerName, score } = body;
        const normalizedName = sanitizeProfileText(playerName, 20) || 'Anonymous';
        const safeScore = parseInt(score, 10) || 0;
        
        cleanData.gameLeaderboard.push({
          id: createLedgerEntryId(),
          playerName: normalizedName,
          score: safeScore,
          timestamp: new Date().toISOString()
        });
        
        // Sort descending
        cleanData.gameLeaderboard.sort((a, b) => b.score - a.score);
        
      } else if (action === 'delete_game_score') {
        const { scoreId } = body;
        if (!scoreId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing scoreId' }));
          return;
        }
        cleanData.gameLeaderboard = cleanData.gameLeaderboard.filter(s => s.id !== scoreId);
      } else if (action === 'rename_game_player') {
        const { playerName, newPlayerName } = body;
        const oldName = normalizeLeaderboardName(playerName);
        const renamedName = normalizeLeaderboardName(newPlayerName);

        if (!oldName || !renamedName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        if (getLeaderboardNameKey(oldName) === getLeaderboardNameKey(renamedName)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'New name must be different from the current name' }));
          return;
        }

        let renamedCount = 0;
        cleanData.gameLeaderboard = cleanData.gameLeaderboard.map(entry => {
          if (getLeaderboardNameKey(entry.playerName) !== getLeaderboardNameKey(oldName)) {
            return entry;
          }

          renamedCount += 1;
          return {
            ...entry,
            playerName: renamedName
          };
        });

        if (!renamedCount) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No leaderboard entries found for ${oldName}` }));
          return;
        }

        cleanData.gameLeaderboard.sort((a, b) => b.score - a.score);
      } else if (action === 'update_treasure_hunt_settings') {
        const enabled = !!body.enabled;
        cleanData.treasureHunt.enabled = enabled;
        if (!enabled) {
          cleanData.treasureHunt.currentStage = 0;
          cleanData.treasureHunt.completed = false;
        } else if (cleanData.treasureHunt.hints.length > 0 && cleanData.treasureHunt.currentStage === 0) {
          cleanData.treasureHunt.currentStage = 1;
          cleanData.treasureHunt.completed = false;
        }
      } else if (action === 'add_treasure_hunt_hint') {
        const title = sanitizeProfileText(body.title, 120);
        const description = sanitizeProfileText(body.description, 1000);

        if (!title || !description) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        cleanData.treasureHunt.hints.push({
          id: createTreasureHintId(),
          title,
          description,
          proofImageUrl: '',
          proofNote: '',
          unlockedAt: ''
        });

        if (cleanData.treasureHunt.enabled && cleanData.treasureHunt.currentStage === 0) {
          cleanData.treasureHunt.currentStage = 1;
        }
        cleanData.treasureHunt.completed = false;
      } else if (action === 'delete_treasure_hunt_hint') {
        const hintId = sanitizeProfileText(body.hintId, 80);

        if (!hintId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing hintId' }));
          return;
        }

        const targetHint = cleanData.treasureHunt.hints.find(hint => hint.id === hintId);
        if (!targetHint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Hint not found' }));
          return;
        }

        await deleteTreasureProofAsset(targetHint.proofImageUrl);

        cleanData.treasureHunt.hints = cleanData.treasureHunt.hints.filter(hint => hint.id !== hintId);

        if (cleanData.treasureHunt.currentStage > cleanData.treasureHunt.hints.length) {
          cleanData.treasureHunt.currentStage = cleanData.treasureHunt.hints.length;
        }
        if (cleanData.treasureHunt.hints.length === 0) {
          cleanData.treasureHunt.completed = false;
        }
      } else if (action === 'update_treasure_hunt_hint') {
        const hintId = sanitizeProfileText(body.hintId, 80);
        const title = sanitizeProfileText(body.title, 120);
        const description = sanitizeProfileText(body.description, 1000);

        if (!hintId || !title || !description) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        const targetHint = cleanData.treasureHunt.hints.find(hint => hint.id === hintId);
        if (!targetHint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Hint not found' }));
          return;
        }

        targetHint.title = title;
        targetHint.description = description;
      } else if (action === 'reset_treasure_hunt_progress') {
        await deleteTreasureProofAssets(cleanData.treasureHunt.hints);
        cleanData.treasureHunt.hints = cleanData.treasureHunt.hints.map(hint => ({
          ...hint,
          proofImageUrl: '',
          proofNote: '',
          unlockedAt: ''
        }));
        cleanData.treasureHunt.currentStage = 0;
        cleanData.treasureHunt.completed = false;
      } else if (action === 'clear_treasure_hunt_hints') {
        await deleteTreasureProofAssets(cleanData.treasureHunt.hints);
        cleanData.treasureHunt.hints = [];
        cleanData.treasureHunt.currentStage = 0;
        cleanData.treasureHunt.enabled = false;
        cleanData.treasureHunt.completed = false;
      } else if (action === 'unlock_treasure_hunt_next') {
        if (!cleanData.treasureHunt.enabled) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Treasure hunt is disabled' }));
          return;
        }

        const proofImageUrl = sanitizeProfileText(body.proofImageUrl, 500);
        const proofNote = sanitizeProfileText(body.proofNote, 300);
        const hintCount = cleanData.treasureHunt.hints.length;

        if (hintCount === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No hints have been created yet' }));
          return;
        }

        const currentStage = Math.max(0, Math.min(cleanData.treasureHunt.currentStage, hintCount));
        const isFinalCompletion = currentStage >= hintCount;
        const targetIndex = Math.max(0, Math.min(currentStage - 1, hintCount - 1));
        const targetHint = cleanData.treasureHunt.hints[targetIndex];

        if (targetHint) {
          targetHint.proofImageUrl = proofImageUrl;
          targetHint.proofNote = proofNote;
          targetHint.unlockedAt = new Date().toISOString();
        }

        if (isFinalCompletion) {
          cleanData.treasureHunt.currentStage = hintCount;
          cleanData.treasureHunt.completed = true;
        } else {
          cleanData.treasureHunt.currentStage = Math.min(hintCount, currentStage + 1);
          cleanData.treasureHunt.completed = false;
        }
      }
      else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action' }));
        return;
      }

      // Re-run totals calculation to update counts and totalDebt
      const finalData = recalculateTotals(cleanData);
      const saveResult = await saveScoreboardData(finalData);

      const isAdmin = verifyToken(req);
      const leaderboardToSend = isAdmin 
        ? finalData.gameLeaderboard 
        : getDeduplicatedLeaderboard(finalData.gameLeaderboard);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        anytimers: finalData.anytimers,
        totalOutstanding: finalData.totalOutstanding,
        ledger: finalData.ledger,
        gameLeaderboard: leaderboardToSend,
        treasureHunt: finalData.treasureHunt,
        storage: saveResult.storage
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error: ' + err.message }));
    }
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }
};