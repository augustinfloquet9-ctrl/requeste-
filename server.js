require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

// Servir les dossiers de l'application
app.use('/public-app', express.static(path.join(__dirname, 'public/public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'public/dj-app')));

// Redirection automatique vers l'app publique
app.get('/', (req, res) => {
  res.redirect('/public-app/');
});

// --- État des demandes en mémoire ---
let requests = [];

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

// --- API HTTP POUR L'APP PUBLIQUE ---

// Récupérer la liste des musiques
app.get('/api/requests', (req, res) => {
  res.json({ requests: [...requests].sort((a, b) => b.votes - a.votes) });
});

// Ajouter une musique ou voter si elle existe déjà
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
  res.json({ success: true });
});

// Voter pour une musique depuis la liste publique
app.post('/api/vote/:id', (req, res) => {
  const reqId = req.params.id;
  const item = requests.find((r) => r.id === reqId);
  if (item) {
    item.votes += 1;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Demande introuvable' });
  }
});

// Générer le QR Code
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

// --- NOUVELLES API HTTP DÉDIÉES AU DJ (Remplacent les WebSockets) ---

// Supprimer un morceau quand le DJ clique sur "✓"
app.post('/api/dj/done/:id', (req, res) => {
  const reqId = req.params.id;
  requests = requests.filter((r) => r.id !== reqId);
  res.json({ success: true });
});

// Tout effacer quand le DJ clique sur "Tout effacer"
app.post('/api/dj/clear', (req, res) => {
  requests = [];
  res.json({ success: true });
});

// Lancement du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur HTTP connecté sur le port ${PORT}`);
});
