const crypto = require('crypto');

// Verify admin token (shared between /api/data and /api/upload-image)
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

function createTreasureToken() {
  const secret = process.env.TREASURE_HUNT_CODE || 'treasure123';
  const hash = crypto.createHmac('sha256', secret)
    .update('treasure-session')
    .digest('hex');
  return `treasure.${hash}`;
}

function verifyTreasureToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.split(' ')[1];
  return token === createTreasureToken();
}

module.exports = { verifyToken, createTreasureToken, verifyTreasureToken };