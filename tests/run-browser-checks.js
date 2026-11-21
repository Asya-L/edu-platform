const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const body = await fs.readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
(async () => {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  try {
    for (const file of (process.env.BROWSER_TESTS ? process.env.BROWSER_TESTS.split(',') : ['homework-browser.js','visits-browser.js','board-browser.js','lesson-summary-browser.js','catalogs-browser.js','lesson-pack-browser.js'])) {
      const child = spawn(process.execPath, [path.join(__dirname,file)], {
        env:{...process.env,SITE:`http://127.0.0.1:${server.address().port}/`},stdio:'inherit'
      });
      const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',resolve); });
      if (code !== 0) { process.exitCode = 1; break; }
    }
  } finally { server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode=1; });
