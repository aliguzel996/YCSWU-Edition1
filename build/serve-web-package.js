const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve('build/web-package');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.glb':'model/gltf-binary', '.ico':'image/x-icon' };
const server = http.createServer((req,res)=>{
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let target = path.join(root, url === '/' ? 'index.html' : url.replace(/^\//,''));
  if (!target.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target,'index.html');
  if (!fs.existsSync(target)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, {'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream'});
  fs.createReadStream(target).pipe(res);
});
server.listen(4173,'127.0.0.1');
