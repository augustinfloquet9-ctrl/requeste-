require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// On force l'autorisation des connexions en temps réel pour Render (CORS)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

app.use('/public-app', express.static(path.join(__dirname, 'public/public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'public/dj-app')));

// Redirection automatique
app.get('/', (req, res) => {
  res.redirect('/public-app/');
});

// --- État en mémoire ---
let requests = [];

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

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

// --- API HTTP (Publique) ---
app.get('/api/requests', (req, res) => {
  res.json({ requests: [...requests].sort((a, b) => b.votes - a.votes) });
});

app.post('/api/request', (req, res) => {
  const { title, artist } = req.body;
  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Titre requis' });
  }

  const existing = requests.find(
    (r) => normalize(r.title) === normalize(title) && normalize(r.artist) === normalize(artist)
  );

  if (existing) {
    existing.votes += 1;
  } else {
    requests.push({
      id: crypto.randomUUID(),
      title: title.trim(),
      artist: artist ? artist.trim() : '',
      ts: Date.now(),
      votes: 1,
    });
  }

  broadcastState();
  res.json({ success: true });
});

app.post('/api/vote/:id', (req, res) => {
  const reqId = req.params.id;
  const item = requests.find((r) => r.id === reqId);
  if (item) {
    item.votes += 1;
    broadcastState();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Demande introuvable' });
  }
});

app.get('/api/qrcode', async (req, res) => {
  try {
    const host = req.get('host');
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const url = `${protocol}://${host}/public-app/`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Erreur QR Code' });
  }
});

// --- WebSockets (DJ) ---
io.on('connection', (socket) => {
  socket.on('dj:join', () => {
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur en ligne sur le port ${PORT}`);
});
