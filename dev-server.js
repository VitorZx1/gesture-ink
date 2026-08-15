const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 8080;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };

http.createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const root = __dirname;
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== root) {
    response.writeHead(403); response.end('Acesso negado'); return;
  }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end('Arquivo não encontrado'); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    response.end(content);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Gesture Ink iniciado em http://localhost:${port}`);
  console.log('Mantenha esta janela aberta enquanto estiver usando.');
});
