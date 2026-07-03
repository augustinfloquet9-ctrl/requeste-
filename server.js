require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DJ_PASSWORD = process.env.DJ_PASSWORD || 'changeme';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// Désactive la page d'avertissement de Ngrok pour le public
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

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

// --- API HTTP ---

// Récupérer la liste (pour l'app publique)
app.get('/api/requests', (req, res) => {
  res.json({ requests: [...requests].sort((a, b) => b.votes - a.votes) });
});

// Soumettre une nouvelle demande
app.post('/api/request', (req, res) => {
  const { title, artist } = req.body;
  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Titre requis' });
  }

  // Cherche si ce morceau exact (titre + artiste) a déjà été demandé ce soir
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

// Voter pour une demande existante
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

// Générer le QR Code (pour la vue DJ)
app.get('/api/qrcode', async (req, res) => {
  try {
    const ip = getLocalIp();
    const url = `http://${ip}:${PORT}/public-app/`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Erreur QR Code' });
  }
});

// --- WebSockets (Communication en temps réel avec le DJ) ---
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
});