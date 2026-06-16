const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load .env and .env.local files if they exist (no external deps needed)
// .env.local takes priority and overrides .env (used for Vercel-pulled credentials)
function loadEnvFile(filePath, override = false) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();
      if (key && value && (override || !process.env[key.trim()])) {
        process.env[key.trim()] = value.replace(/^['"]|['"]$/g, '');
      }
    }
  });
}

loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(process.cwd(), '.env.local'), true); // override with local secrets

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const loginHandler = require('./api/login');
const dataHandler = require('./api/data');

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Add simple response helper mocks to resemble Express/Vercel
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };

  // Emulate Vercel Serverless Function Routes
  if (pathname === '/api/login' || pathname === '/api/login.js') {
    loginHandler(req, res);
    return;
  }

  if (pathname === '/api/data' || pathname === '/api/data.js') {
    dataHandler(req, res);
    return;
  }

  // Default to index.html for root path
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Safe file resolution
  const filePath = path.join(process.cwd(), pathname);
  
  // Basic security check: make sure the path is inside the project root
  if (!filePath.startsWith(process.cwd())) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>');
    return;
  }

  const extname = path.extname(filePath);
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`Treasurer Scoreboard Local Server Running!`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`=================================================`);
});
