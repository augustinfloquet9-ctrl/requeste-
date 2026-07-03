require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DJ_PASSWORD = process.env.DJ_PASSWORD || 'changeme';
const SOCIAL_PATH = path.join(__dirname, 'social-links.json');
const SOCIAL_LABELS = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  youtube: 'YouTube',
  x: 'X / Twitter',
};

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/public-app', express.static(path.join(__dirname, 'public/public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'public/dj-app')));

// --- Etat en memoire (file de demandes de la soiree) ---
let requests = []; // { id, title, artist, ts, votes }

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

// Classement : regroupe les demandes par morceau et additionne les votes.
function computeLeaderboard() {
  const groups = {};
  requests.forEach((r) => {
    const key = normalize(r.title) + '|' + normalize(r.artist);
    if (!groups[key]) groups[key] = { title: r.title, artist: r.artist, votes: 0 };
    groups[key].votes += r.votes;
  });
  return Object.values(groups).sort((a, b) => b.votes - a.votes).slice(0, 8);
}

function broadcastState() {
  io.to('dj-room').emit('state', {
    requests: [...requests].sort((a, b) => b.votes - a.votes),
    leaderboard: computeLeaderboard(),
  });
}

// --- Routes HTTP ---

app.get('/', (req, res) => res.redirect('/public-app/'));

app.post('/api/request', (req, res) => {
  const { title, artist } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'title requis' });

  const entry = {
    id: crypto.randomUUID(),
    title: title.trim(),
    artist: (artist || '').trim(),
    ts: Date.now(),
    votes: 1,
  };
  requests.unshift(entry);
  broadcastState();
  res.json({ ok: true, id: entry.id });
});

app.get('/api/requests', (req, res) => {
  const list = [...requests].sort((a, b) => b.votes - a.votes);
  res.json({ requests: list });
});

app.post('/api/vote/:id', (req, res) => {
  const entry = requests.find((r) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'introuvable' });
  entry.votes += 1;
  broadcastState();
  res.json({ ok: true, votes: entry.votes });
});

app.get('/api/qrcode', async (req, res) => {
  // Fonctionne en local (IP reseau) ET une fois deploye (Render, etc.)
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/public-app/`;
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
  res.json({ url, dataUrl });
});

// Lit social-links.json et ne renvoie que les liens que tu as vraiment remplis
app.get('/api/social-links', (req, res) => {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(SOCIAL_PATH, 'utf8'));
  } catch (err) {
    raw = {};
  }
  const links = {};
  Object.entries(raw).forEach(([key, url]) => {
    if (url && url.trim()) {
      links[SOCIAL_LABELS[key] || key] = url.trim();
    }
  });
  res.json({ links });
});

// --- Socket.io (vue DJ) ---
io.on('connection', (socket) => {
  socket.on('dj:join', ({ password }) => {
    if (password !== DJ_PASSWORD) {
      socket.emit('dj:unauthorized');
      return;
    }
    socket.join('dj-room');
    socket.emit('state', {
      requests: [...requests].sort((a, b) => b.votes - a.votes),
      leaderboard: computeLeaderboard(),
    });
  });

  socket.on('dj:done', ({ id }) => {
    requests = requests.filter((r) => r.id !== id);
    broadcastState();
  });

  socket.on('dj:clear', () => {
    requests = [];
    broadcastState();
  });
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log('');
  console.log('  Floor Request est lance');
  console.log('  ------------------------');
  console.log(`  App publique (a scanner)  : http://${ip}:${PORT}/public-app/`);
  console.log(`  Dashboard DJ (sur ton PC) : http://localhost:${PORT}/dj-app/`);
  console.log('');
  console.log('  Assure-toi que ton telephone est sur le meme reseau WiFi que cet ordinateur.');
  console.log('  Sur Mac, la premiere fois, autorise Node a accepter les connexions entrantes');
  console.log('  si macOS te le demande (Reglages Systeme > Confidentialite et securite > Pare-feu).');
  console.log('');
});
