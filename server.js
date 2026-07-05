const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

const { readDb, writeDb } = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-moi';
const COOKIE_NAME = 'floor_session';

if (!process.env.JWT_SECRET) {
  console.warn('[attention] JWT_SECRET non defini dans les variables d\'environnement — utilise une valeur par defaut, a changer avant un vrai lancement public.');
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Authentification (lecture du cookie sur chaque requete) ---
app.use((req, res, next) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) { req.user = null; return next(); }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    req.user = null;
  }
  next();
});

function requireOwner(req, res, next) {
  if (!req.user || req.user.slug !== req.params.slug) {
    return res.status(403).json({ error: 'Non autorise' });
  }
  next();
}

function slugify(str) {
  return str
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function generateUniqueSlug(base, db) {
  const root = slugify(base) || 'dj';
  let candidate = root;
  let attempts = 0;
  while (db.accounts[candidate] && attempts < 30) {
    candidate = `${root}-${Math.random().toString(36).slice(2, 6)}`;
    attempts++;
  }
  return candidate;
}

// ============================================================
// PAGES
// ============================================================

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login/index.html')));
app.get('/dj-app', (req, res) => res.redirect('/login'));
app.get('/dj-app/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public/dj-app/index.html')));
app.get('/public-app', (req, res) => res.send('Lien invalide — demande le QR code ou le lien exact a ton DJ.'));
app.get('/public-app/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public/public-app/index.html')));

// ============================================================
// AUTH
// ============================================================

app.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caracteres' });
  }

  const db = readDb();
  const emailNorm = email.trim().toLowerCase();
  const exists = Object.values(db.accounts).find((a) => a.email === emailNorm);
  if (exists) {
    return res.status(409).json({ error: 'Un compte existe deja avec cet email' });
  }

  const slug = generateUniqueSlug(displayName, db);
  const passwordHash = await bcrypt.hash(password, 10);

  db.accounts[slug] = {
    slug,
    email: emailNorm,
    passwordHash,
    displayName: displayName.trim(),
    createdAt: Date.now(),
  };
  db.state[slug] = { requests: [], messages: [], dates: [] };
  writeDb(db);

  const token = jwt.sign({ slug }, JWT_SECRET, { expiresIn: '90d' });
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 90 * 24 * 3600 * 1000 });
  res.json({ ok: true, slug });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const db = readDb();
  const emailNorm = (email || '').trim().toLowerCase();
  const account = Object.values(db.accounts).find((a) => a.email === emailNorm);
  if (!account) return res.status(401).json({ error: 'Identifiants incorrects' });

  const ok = await bcrypt.compare(password || '', account.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = jwt.sign({ slug: account.slug }, JWT_SECRET, { expiresIn: '90d' });
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 90 * 24 * 3600 * 1000 });
  res.json({ ok: true, slug: account.slug });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non connecte' });
  const db = readDb();
  const account = db.accounts[req.user.slug];
  if (!account) return res.status(401).json({ error: 'Compte introuvable' });
  res.json({ slug: account.slug, displayName: account.displayName, email: account.email });
});

// ============================================================
// QR CODE (prive, propre a chaque DJ)
// ============================================================

app.get('/api/:slug/qrcode', requireOwner, async (req, res) => {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/public-app/${req.params.slug}`;
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
  res.json({ url, dataUrl });
});

// ============================================================
// MUSIQUE (lecture/ajout publics, gestion reservee au DJ proprietaire)
// ============================================================

app.get('/api/:slug/requests', (req, res) => {
  const db = readDb();
  const state = db.state[req.params.slug];
  if (!state) return res.status(404).json({ error: 'DJ introuvable' });
  const sorted = [...state.requests].sort((a, b) => b.votes - a.votes);
  res.json({ requests: sorted });
});

app.post('/api/:slug/requests', (req, res) => {
  const { title, artist } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Titre manquant' });

  const db = readDb();
  const state = db.state[req.params.slug];
  if (!state) return res.status(404).json({ error: 'DJ introuvable' });

  const duplicate = state.requests.find((r) =>
    r.title.toLowerCase().trim() === title.toLowerCase().trim() &&
    (r.artist || '').toLowerCase().trim() === (artist || '').toLowerCase().trim()
  );

  if (duplicate) {
    duplicate.votes += 1;
  } else {
    state.requests.push({
      id: Date.now().toString(),
      title: title.trim(),
      artist: artist ? artist.trim() : 'Artiste non specifie',
      votes: 0,
    });
  }
  writeDb(db);
  res.json({ success: true });
});

app.post('/api/:slug/dj/done/:id', requireOwner, (req, res) => {
  const db = readDb();
  const state = db.state[req.params.slug];
  if (!state) return res.status(404).json({ error: 'DJ introuvable' });
  state.requests = state.requests.filter((r) => r.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

app.post('/api/:slug/dj/clear', requireOwner, (req, res) => {
  const db = readDb();
  if (!db.state[req.params.slug]) return res.status(404).json({ error: 'DJ introuvable' });
  db.state[req.params.slug].requests = [];
  writeDb(db);
  res.json({ success: true });
});

// ============================================================
// MESSAGES (envoi public, lecture reservee au DJ)
// ============================================================

app.get('/api/:slug/messages', requireOwner, (req, res) => {
  const db = readDb();
  const state = db.state[req.params.slug];
  res.json({ messages: state ? state.messages : [] });
});

app.post('/api/:slug/messages', (req, res) => {
  const { text, pseudo } = req.body || {};
  const db = readDb();
  const state = db.state[req.params.slug];
  if (!state) return res.status(404).json({ error: 'DJ introuvable' });

  if (text) {
    state.messages.push({
      id: Date.now().toString(),
      text: text.trim(),
      pseudo: pseudo ? pseudo.trim() : 'Anonyme',
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    });
    writeDb(db);
  }
  res.json({ success: true });
});

app.post('/api/:slug/dj/messages/clear', requireOwner, (req, res) => {
  const db = readDb();
  if (!db.state[req.params.slug]) return res.status(404).json({ error: 'DJ introuvable' });
  db.state[req.params.slug].messages = [];
  writeDb(db);
  res.json({ success: true });
});

// ============================================================
// AGENDA (lecture publique, ajout reserve au DJ)
// ============================================================

app.get('/api/:slug/dates', (req, res) => {
  const db = readDb();
  const state = db.state[req.params.slug];
  res.json({ dates: state ? state.dates : [] });
});

app.post('/api/:slug/dj/dates', requireOwner, (req, res) => {
  const { date, location } = req.body || {};
  const db = readDb();
  const state = db.state[req.params.slug];
  if (!state) return res.status(404).json({ error: 'DJ introuvable' });

  if (date && location) {
    state.dates.push({ id: Date.now().toString(), date: date.trim(), location: location.trim() });
    writeDb(db);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Serveur HTTP connecte sur le port ${PORT}`);
});
