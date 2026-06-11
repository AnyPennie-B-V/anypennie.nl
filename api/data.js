const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const localDataPath = path.join(process.cwd(), 'data.json');
let inMemoryData = null;

const DEFAULT_DATA = {
  anytimers: [],
  ledger: []
};

// Helper to verify admin token
function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.split(' ')[1];
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] !== 'admin') {
    return false;
  }
  const salt = process.env.ADMIN_PASSWORD || 'admin123';
  const expectedHash = crypto.createHmac('sha256', salt)
    .update('admin-session')
    .digest('hex');
  return parts[1] === expectedHash;
}

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
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function createLedgerEntryId() {
  return 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
}

function createDefaultPerson(name) {
  return {
    name,
    outstanding: 0,
    received: 0,
    taken: 0
  };
}

function toSafeQuantity(value) {
  const quantity = parseInt(value, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

// Recalculates balances from the ledger to ensure consistent state
function recalculateTotals(data) {
  const cleanData = {
    anytimers: Array.isArray(data.anytimers) ? data.anytimers : [],
    ledger: Array.isArray(data.ledger) ? data.ledger : []
  };

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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      anytimers: cleanData.anytimers,
      totalOutstanding: cleanData.totalOutstanding,
      ledger: cleanData.ledger,
      storageWarning: warning
    }));
    return;
  }

  if (req.method === 'POST') {
    // Verify admin privileges
    if (!verifyToken(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Admin privileges required' }));
      return;
    }

    try {
      const body = await getRequestBody(req);
      const action = body.action;

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
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action' }));
        return;
      }

      // Re-run totals calculation to update counts and totalDebt
      const finalData = recalculateTotals(cleanData);
      const saveResult = await saveScoreboardData(finalData);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        anytimers: finalData.anytimers,
        totalOutstanding: finalData.totalOutstanding,
        ledger: finalData.ledger,
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
