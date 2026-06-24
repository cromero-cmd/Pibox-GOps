// Servidor estático mínimo, sin dependencias — solo para servir este
// directorio en localhost (los módulos ES no cargan vía file://).
// Se invoca desde iniciar.bat con doble-click, no requiere terminal manual.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT_START = 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function send(res, status, body, headers){
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(req, res, filePath){
  fs.readFile(filePath, (err, data) => {
    if(err){ send(res, 404, 'No encontrado', {'Content-Type':'text/plain; charset=utf-8'}); return; }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {'Content-Type': MIME[ext] || 'application/octet-stream'});
  });
}

function handle(req, res){
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if(urlPath === '/') urlPath = '/index.html';

  // Evitar path traversal — resolver dentro de ROOT únicamente
  const resolved = path.normalize(path.join(ROOT, urlPath));
  if(!resolved.startsWith(ROOT)){ send(res, 403, 'Prohibido', {'Content-Type':'text/plain'}); return; }

  fs.stat(resolved, (err, stat) => {
    if(err){ send(res, 404, 'No encontrado', {'Content-Type':'text/plain; charset=utf-8'}); return; }
    if(stat.isDirectory()){ serveFile(req, res, path.join(resolved, 'index.html')); }
    else { serveFile(req, res, resolved); }
  });
}

function start(port, attemptsLeft){
  const server = http.createServer(handle);
  server.on('error', err => {
    if(err.code === 'EADDRINUSE' && attemptsLeft > 0){ start(port + 1, attemptsLeft - 1); }
    else { console.error('No se pudo iniciar el servidor:', err.message); process.exit(1); }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}/index.html`;
    console.log('═══════════════════════════════════════════════════');
    console.log('  Pipeline TaDa → Trump corriendo en:');
    console.log('  ' + url);
    console.log('  Deja esta ventana abierta mientras usas la app.');
    console.log('  Cierra esta ventana (o Ctrl+C) para detener.');
    console.log('═══════════════════════════════════════════════════');
    // Abrir el navegador automáticamente (Windows)
    require('child_process').exec(`start "" "${url}"`);
  });
}

start(PORT_START, 10);
