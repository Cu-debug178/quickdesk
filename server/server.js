/*
 * QuizDesk 服务端 —— 零依赖 Node.js（无需 npm install）
 *
 * 功能：
 *   1. 托管 web/ 静态页面
 *   2. 题库 API：列表 / 读取 / 更新（带管理令牌）
 *   3. 错题同步 API：按设备 ID 存取，实现多设备错题本
 *
 * 数据存放在 server/data/ 目录（纯 JSON 文件），备份=复制目录。
 *
 * 启动：node server.js   （环境变量 PORT、ADMIN_TOKEN 可覆盖默认值）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8901);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-please';
const WEB_DIR = path.join(__dirname, '..', 'web');
const DATA_DIR = path.join(__dirname, 'data');
const BANK_DIR = path.join(DATA_DIR, 'banks');
const WRONG_DIR = path.join(DATA_DIR, 'wrong');

const MAX_BODY = 20 * 1024 * 1024; // 20MB，足够大题库 JSON

for (const dir of [DATA_DIR, BANK_DIR, WRONG_DIR]) fs.mkdirSync(dir, { recursive: true });

/* ---------- 小工具 ---------- */
function send(res, code, body, headers) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, Object.assign({ 'Content-Length': buf.length }, headers || {}));
  res.end(buf);
}
function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- 题库存储 ---------- */
function bankFile(id) {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return null; // 只允许安全字符
  return path.join(BANK_DIR, id + '.json');
}
function listBanks() {
  const files = fs.readdirSync(BANK_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(BANK_DIR, f), 'utf8'));
      return {
        id: path.basename(f, '.json'),
        name: (meta.bank && meta.bank.name) || f,
        count: (meta.questions || []).length,
        version: meta.version || meta.generatedAt || '',
        updatedAt: meta.updatedAt || null
      };
    } catch (e) { return { id: path.basename(f, '.json'), name: f, error: '损坏' }; }
  });
}
function getBank(id) {
  const file = bankFile(id);
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function saveBank(id, doc) {
  if (!doc || !Array.isArray(doc.questions)) throw new Error('题库必须是含 questions 数组的 JSON');
  doc.updatedAt = new Date().toISOString();
  doc.version = doc.updatedAt;
  fs.writeFileSync(bankFile(id), JSON.stringify(doc));
  return { id, name: (doc.bank && doc.bank.name) || id, count: doc.questions.length, version: doc.version };
}

/* 若服务器上没有题库，用内嵌的默认题库初始化一次 */
const seedSrc = path.join(__dirname, '..', 'web', 'data', 'java-web.json');
if (fs.existsSync(seedSrc) && listBanks().length === 0) {
  const doc = JSON.parse(fs.readFileSync(seedSrc, 'utf8'));
  console.log('初始化默认题库 java-web:', saveBank('java-web', doc).count, '题');
}

/* ---------- 路由 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mhtml': 'message/rfc822'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  try {
    /* --- 题库 API --- */
    if (p === '/api/banks' && req.method === 'GET') {
      return sendJSON(res, 200, { banks: listBanks() });
    }
    let m = p.match(/^\/api\/bank\/([a-z0-9-]+)$/);
    if (m) {
      const id = m[1];
      if (req.method === 'GET') {
        const doc = getBank(id);
        return doc ? sendJSON(res, 200, doc) : sendJSON(res, 404, { error: '题库不存在' });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return sendJSON(res, 401, { error: '管理令牌错误' });
        const doc = JSON.parse((await readBody(req)).toString('utf8'));
        return sendJSON(res, 200, saveBank(id, doc));
      }
    }

    /* --- 错题同步 API：/api/wrong/<deviceId> --- */
    m = p.match(/^\/api\/wrong\/([A-Za-z0-9-]{4,64})$/);
    if (m) {
      const file = path.join(WRONG_DIR, m[1] + '.json');
      if (req.method === 'GET') {
        const ids = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        return sendJSON(res, 200, { ids });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        if (!Array.isArray(body.ids)) return sendJSON(res, 400, { error: 'ids 必须是数组' });
        const old = new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
        body.ids.forEach(i => old.add(i));
        fs.writeFileSync(file, JSON.stringify(Array.from(old)));
        return sendJSON(res, 200, { ids: Array.from(old) });
      }
    }

    if (p === '/api/health') return sendJSON(res, 200, { ok: true, banks: listBanks().length });

    if (req.method === 'GET') return serveStatic(req, res, p);
    return sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJSON(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`QuizDesk 服务已启动: http://127.0.0.1:${PORT}`);
  console.log(`管理令牌: ${ADMIN_TOKEN} （生产环境请用环境变量 ADMIN_TOKEN 覆盖）`);
});
