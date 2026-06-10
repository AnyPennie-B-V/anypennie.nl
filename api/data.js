const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const localDataPath = path.join(process.cwd(), 'data.json');
let inMemoryData = null;

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
  let isKV = false;

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
        return { data: parsed, isKV: true, warning: false };
      }
    } catch (err) {
      console.error('Failed to fetch from Vercel KV, falling back:', err);
    }
  }

  // 2. Try In-Memory Cache
  if (inMemoryData) {
    return { data: inMemoryData, isKV: false, warning: !!process.env.VERCEL };
  }

  // 3. Try Local File
  try {
    if (fs.existsSync(localDataPath)) {
      const fileContent = fs.readFileSync(localDataPath, 'utf8');
      const data = JSON.parse(fileContent);
      if (process.env.VERCEL) {
        inMemoryData = data; // Cache on Vercel
      }
      return { data, isKV: false, warning: !!process.env.VERCEL };
    }
  } catch (err) {
    console.error('Failed to read local data.json:', err);
  }

  // Fallback default
  const defaultData = {
    prices: { kanon: 1.80, ketel1: 18.50 },
    counts: { kanon: 0, ketel1: 0 },
    ledger: []
  };
  return { data: defaultData, isKV: false, warning: !!process.env.VERCEL };
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

// Recalculates counts and debt from the ledger to ensure consistent state
function recalculateTotals(data) {
  const prices = data.prices || { kanon: 1.80, ketel1: 18.50 };
  const counts = { kanon: 0, ketel1: 0 };
  let totalDebt = 0;

  (data.ledger || []).forEach(tx => {
    if (tx.type === 'consumption') {
      const price = prices[tx.drinkType] || 0;
      // If historical transaction value doesn't exist, calculate it
      if (tx.value === undefined || tx.value === null) {
        tx.value = tx.quantity * price;
      }
      counts[tx.drinkType] += tx.quantity;
      totalDebt += tx.value;
    } else if (tx.type === 'payment') {
      // Payments should be negative (reducing the debt)
      if (tx.value > 0) {
        tx.value = -tx.value;
      }
      totalDebt += tx.value;
    }
  });

  data.counts = counts;
  data.totalDebt = totalDebt;
  return data;
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
      prices: cleanData.prices,
      counts: cleanData.counts,
      totalDebt: cleanData.totalDebt,
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

      if (action === 'log_consumption') {
        const { drinkType, quantity, note, admin, timestamp } = body;
        if (!drinkType || !quantity || !admin) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        const price = cleanData.prices[drinkType] || 0;
        const txValue = quantity * price;

        const newTx = {
          id: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          timestamp: timestamp || new Date().toISOString(),
          type: 'consumption',
          drinkType,
          quantity: parseInt(quantity, 10),
          value: txValue,
          admin,
          note: note || ''
        };

        cleanData.ledger.push(newTx);
      } else if (action === 'log_payment') {
        const { amount, note, admin, timestamp } = body;
        if (!amount || !admin) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }

        const newTx = {
          id: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          timestamp: timestamp || new Date().toISOString(),
          type: 'payment',
          drinkType: null,
          quantity: 0,
          value: -parseFloat(amount),
          admin,
          note: note || ''
        };

        cleanData.ledger.push(newTx);
      } else if (action === 'update_settings') {
        const { prices } = body;
        if (!prices || typeof prices.kanon !== 'number' || typeof prices.ketel1 !== 'number') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid pricing parameters' }));
          return;
        }
        cleanData.prices = prices;
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
        prices: finalData.prices,
        counts: finalData.counts,
        totalDebt: finalData.totalDebt,
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
