const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyToken } = require('./_auth');

// Vercel Functions cap request bodies at 4.5MB. We send the image as base64
// (~33% larger than the raw bytes) inside a JSON body, so the raw file is
// capped well below that ceiling to leave headroom for the JSON wrapper.
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB

const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const localUploadsDir = path.join(process.cwd(), 'assets', 'uploads');

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

function safeFileSlug(name) {
  return String(name || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
}

module.exports = async (req, res) => {
  // CORS Headers (mirrors api/data.js)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  if (!verifyToken(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Admin privileges required' }));
    return;
  }

  try {
    const body = await getRequestBody(req);
    const { imageData, personName } = body;

    if (!imageData || typeof imageData !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing imageData' }));
      return;
    }

    // Expect a data URL, e.g. "data:image/png;base64,AAAA..."
    const match = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'imageData must be a base64 data URL' }));
      return;
    }

    const mimeType = match[1].toLowerCase();
    const extension = ALLOWED_TYPES[mimeType];
    if (!extension) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsupported image type. Use PNG, JPG, WEBP, or GIF.' }));
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_FILE_BYTES) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image too large. Max 3MB.' }));
      return;
    }

    const filename = `${safeFileSlug(personName)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${extension}`;

    // 1. Preferred: Vercel Blob storage. This persists across deploys and is
    //    shared across all serverless instances, unlike writing to disk.
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = require('@vercel/blob');
        const blob = await put(`anypennie-fotos/${filename}`, buffer, {
          access: 'public',
          contentType: mimeType,
          token: process.env.BLOB_READ_WRITE_TOKEN
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url: blob.url, storage: 'blob' }));
        return;
      } catch (err) {
        console.error('Vercel Blob upload failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Image storage upload failed: ' + err.message }));
        return;
      }
    }

    // 2. Local dev fallback: write straight to /assets/uploads on disk.
    //    This branch is intentionally never reached on Vercel itself — its
    //    filesystem is read-only/ephemeral there, so a "successful" write
    //    would silently vanish on the next request.
    if (!process.env.VERCEL) {
      try {
        if (!fs.existsSync(localUploadsDir)) {
          fs.mkdirSync(localUploadsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(localUploadsDir, filename), buffer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url: `assets/uploads/${filename}`, storage: 'local_disk' }));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to write local file: ' + err.message }));
        return;
      }
    }

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Image storage is not configured. Create a Vercel Blob store for this project so BLOB_READ_WRITE_TOKEN is set.'
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error: ' + err.message }));
  }
};