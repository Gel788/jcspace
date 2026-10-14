// JC SPACE content admin — small Node service behind nginx (/admin, /api).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const express = require('express'), session = require('express-session'), bcrypt = require('bcryptjs'), multer = require('multer');
const render = require('./lib/render');
const { LANGS } = require('./lib/fields');

// configuration comes only from the environment (never from files in the repo)
const env = process.env, need = ['JC_PASSWORD_HASH', 'JC_SESSION_SECRET'];
const missing = need.filter((k) => !env[k]);
if (missing.length) { console.error('jc-admin: missing env ' + missing.join(', ') + ' (see deploy/jc-admin.service)'); process.exit(1); }
if (!/^\$2[aby]\$\d\d\$/.test(env.JC_PASSWORD_HASH)) { console.error('jc-admin: JC_PASSWORD_HASH is not a bcrypt hash'); process.exit(1); }
if (env.JC_SESSION_SECRET.length < 32) { console.error('jc-admin: JC_SESSION_SECRET must be at least 32 characters'); process.exit(1); }
const cfg = { user: env.JC_ADMIN_USER || 'admin', passwordHash: env.JC_PASSWORD_HASH, sessionSecret: env.JC_SESSION_SECRET,
  siteDir: env.JC_SITE_DIR || '..', dataDir: env.JC_DATA_DIR || 'data', port: +env.JC_PORT || 3100, host: env.JC_HOST || '127.0.0.1',
  secureCookie: env.JC_SECURE_COOKIE !== '0', keepVersions: +env.JC_KEEP_VERSIONS || 60 };
const DATA = path.resolve(__dirname, cfg.dataDir || 'data'), SITE = path.resolve(__dirname, cfg.siteDir || '../site');
const VERS = path.join(DATA, 'versions'), UPL = path.join(SITE, 'img', 'uploads');
fs.mkdirSync(VERS, { recursive: true }); fs.mkdirSync(UPL, { recursive: true });
const CONTENT = path.join(DATA, 'content.json');
const readContent = () => JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const KEEP = cfg.keepVersions || 60;

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'no-store' }); next(); });
app.use(express.json({ limit: '4mb' }));
app.use(session({ name: 'jcadm', secret: cfg.sessionSecret, resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'strict', secure: cfg.secureCookie !== false, maxAge: 1000 * 60 * 60 * 8, path: '/' } }));

// --- rate limit (login): 5 failures / 15 min per IP, then locked for the rest of the window
const fails = new Map();
const limited = (ip) => { const f = fails.get(ip); return f && f.n >= 5 && Date.now() - f.t < 15 * 60e3; };
const fail = (ip) => { const f = fails.get(ip); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; };
// --- general API limiter: 120 req/min per session/ip
const hits = new Map();
app.use('/api', (req, res, next) => { const k = req.ip, now = Date.now(), h = hits.get(k) || { n: 0, t: now }; if (now - h.t > 60e3) { h.n = 0; h.t = now; } h.n++; hits.set(k, h); if (h.n > 120) return res.status(429).json({ error: 'Too many requests' }); next(); });

const auth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Unauthorized' });
const csrf = (req, res, next) => { const t = String(req.get('x-csrf-token') || ''), s = String(req.session.csrf || ''); if (!t || t.length !== s.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(s))) return res.status(403).json({ error: 'Bad CSRF token' }); next(); };

app.get('/api/session', (req, res) => res.json({ user: req.session.user || null, csrf: req.session.user ? req.session.csrf : null }));
app.post('/api/login', async (req, res) => {
  const ip = req.ip; if (limited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { user, password } = req.body || {};
  const ok = typeof password === 'string' && user === (cfg.user || 'admin') && await bcrypt.compare(password, cfg.passwordHash);
  if (!ok) { fail(ip); await new Promise((r) => setTimeout(r, 400)); return res.status(401).json({ error: 'Wrong login or password' }); }
  fails.delete(ip);
  req.session.regenerate((e) => { if (e) return res.status(500).end(); req.session.user = user; req.session.csrf = crypto.randomBytes(24).toString('hex'); res.json({ user, csrf: req.session.csrf }); });
});
app.post('/api/logout', auth, csrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/content', auth, (req, res) => res.json(readContent()));

// validation: same keys as current content, strings only, sane length, balanced tags, no scripts/handlers
const BAD = /<\s*(script|iframe|object|embed|style|link|meta)\b|\son\w+\s*=|javascript:/i;
function validate(next, cur) {
  const errs = [];
  for (const k of Object.keys(cur.fields)) {
    const f = next.fields && next.fields[k]; if (!f) { errs.push(`${k}: missing`); continue; }
    for (const l of LANGS) {
      const v = f[l]; if (typeof v !== 'string') { errs.push(`${k}.${l}: not text`); continue; }
      if (!v.trim()) errs.push(`${k}.${l}: empty`);
      if (v.length > 4000) errs.push(`${k}.${l}: too long`);
      if (BAD.test(v)) errs.push(`${k}.${l}: forbidden markup`);
      const open = (v.match(/<(b|i|em|strong|span|small|a|br)\b/gi) || []).filter((t) => !/^<br/i.test(t)).length, close = (v.match(/<\/(b|i|em|strong|span|small|a)>/gi) || []).length;
      if (open !== close) errs.push(`${k}.${l}: unbalanced tags`);
    }
  }
  for (const k of Object.keys(cur.images)) { const im = next.images && next.images[k]; if (!im || typeof im.src !== 'string' || !/^(img|tex)\/[\w./-]+$/.test(im.src)) errs.push(`${k}: bad image path`); }
  return errs;
}
function snapshot(note) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(CONTENT, path.join(VERS, `${id}.json`));
  fs.writeFileSync(path.join(VERS, `${id}.meta.json`), JSON.stringify({ note: note || '', at: new Date().toISOString() }));
  const all = fs.readdirSync(VERS).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) { fs.rmSync(path.join(VERS, f)); fs.rmSync(path.join(VERS, f.replace('.json', '.meta.json')), { force: true }); }
  return id;
}
function commit(next, note, user) {
  const prev = snapshot(note);
  next.updatedAt = new Date().toISOString(); next.updatedBy = user;
  const tmp = CONTENT + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(next, null, 1)); fs.renameSync(tmp, CONTENT);
  try { return { stamp: render(DATA, SITE, next), prev }; }
  catch (e) { fs.copyFileSync(path.join(VERS, prev + '.json'), CONTENT); render(DATA, SITE); throw e; }
}
app.put('/api/content', auth, csrf, (req, res) => {
  const cur = readContent(), next = req.body;
  const errs = validate(next, cur); if (errs.length) return res.status(422).json({ error: 'Validation failed', details: errs.slice(0, 50) });
  try { const r = commit({ version: cur.version, fields: next.fields, images: next.images }, (req.get('x-note') || '').slice(0, 120), req.session.user); res.json({ ok: true, ...r }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Render failed, previous version restored' }); }
});
app.get('/api/versions', auth, (req, res) => {
  const list = fs.readdirSync(VERS).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).sort().reverse().map((f) => {
    const id = f.replace('.json', ''); let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(VERS, id + '.meta.json'), 'utf8')); } catch (e) {}
    return { id, at: meta.at || null, note: meta.note || '' }; });
  res.json(list);
});
app.post('/api/rollback/:id', auth, csrf, (req, res) => {
  const id = req.params.id; if (!/^[\w-]+$/.test(id)) return res.status(400).end();
  const f = path.join(VERS, id + '.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: 'No such version' });
  try { const r = commit(JSON.parse(fs.readFileSync(f, 'utf8')), 'rollback to ' + id, req.session.user); res.json({ ok: true, ...r }); }
  catch (e) { res.status(500).json({ error: 'Rollback failed' }); }
});
// image upload: jpeg/png/webp by magic bytes, 8 MB max, content-addressed file name
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const sniff = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null;
app.post('/api/upload', auth, csrf, (req, res) => up.single('file')(req, res, (err) => {
  if (err) return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File larger than 8 MB' : 'Upload failed' });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const ext = sniff(req.file.buffer); if (!ext) return res.status(415).json({ error: 'Only JPEG, PNG or WebP' });
  const name = crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16) + '.' + ext;
  fs.writeFileSync(path.join(UPL, name), req.file.buffer); res.json({ src: 'img/uploads/' + name });
}));

// admin UI (static)
app.use('/admin', express.static(path.join(__dirname, 'admin'), { index: 'index.html', setHeaders: (r) => r.set('Cache-Control', 'no-cache') }));
app.use((err, req, res, next) => { console.error(err); res.status(400).json({ error: 'Bad request' }); });
const port = cfg.port || 3100, host = cfg.host || '127.0.0.1';
if (require.main === module) app.listen(port, host, () => console.log(`jc-admin on http://${host}:${port}`));
module.exports = app;
