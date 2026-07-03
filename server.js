const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware pour analyser les requêtes JSON envoyées par les applications
app.use(express.json());

// Sécurité des dossiers : On sert les fichiers statiques pour toutes les architectures possibles
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public-app', express.static(path.join(__dirname, 'public/public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'public/dj-app')));
app.use('/public-app', express.static(path.join(__dirname, 'public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'dj-app')));

// --- BASE DE DONNÉES EN MÉMOIRE ---
let requests = [];      // Liste des musiques demandées
let messages = [];      // Liste des messages envoyés au DJ
let upcomingDates = []; // Liste des dates du calendrier

// --- 🎵 API SYSTEME DE MUSIQUE ---

// 1. Récupérer les musiques (triées automatiquement par votes)
app.get('/api/requests', (req, res) => {
    const sortedRequests = [...requests].sort((a, b) => b.votes - a.votes);
    res.json({ requests: sortedRequests });
});

// 2. Ajouter une musique (avec système de vote si doublon)
app.post('/api/requests', (req, res) => {
    const { title, artist } = req.body;
    if (!title) return res.status(400).json({ error: "Titre manquant" });

    // Si la musique existe déjà (même titre et même artiste), on ajoute +1 vote
    const duplicate = requests.find(r => 
        r.title.toLowerCase().trim() === title.toLowerCase().trim() &&
        (r.artist || '').toLowerCase().trim() === (artist || '').toLowerCase().trim()
    );

    if (duplicate) {
        duplicate.votes += 1;
    } else {
        // Sinon, on crée un nouveau morceau avec 1 vote
        requests.push({
            id: Date.now().toString(),
            title: title.trim(),
            artist: artist ? artist.trim() : 'Artiste non spécifié',
            votes: 1
        });
    }
    res.json({ success: true });
});

// 3. Supprimer un morceau joué (Action du bouton ✓ du DJ)
app.post('/api/dj/done/:id', (req, res) => {
    const { id } = req.params;
    requests = requests.filter(r => r.id !== id);
    res.json({ success: true });
});

// 4. Tout effacer les musiques (DJ)
app.post('/api/dj/clear', (req, res) => {
    requests = [];
    res.json({ success: true });
});


// --- 💬 API SYSTEME DE MESSAGES ---

// 1. Récupérer les messages reçus
app.get('/api/messages', (req, res) => {
    res.json({ messages });
});

// 2. Envoyer un message (Action du Public)
app.post('/api/messages', (req, res) => {
    const { text, pseudo } = req.body;
    if (text) {
        messages.push({
            id: Date.now().toString(),
            text: text.trim(),
            pseudo: pseudo ? pseudo.trim() : 'Anonyme',
            time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        });
    }
    res.json({ success: true });
});

// 3. Tout effacer les messages (DJ)
app.post('/api/dj/messages/clear', (req, res) => {
    messages = [];
    res.json({ success: true });
});


// --- 📅 API SYSTEME DE CALENDRIER ---

// 1. Récupérer les dates programmées
app.get('/api/dates', (req, res) => {
    res.json({ dates: upcomingDates });
});

// 2. Ajouter une date (Action du DJ)
app.post('/api/dj/dates', (req, res) => {
    const { date, location } = req.body;
    if (date && location) {
        upcomingDates.push({
            id: Date.now().toString(),
            date: date.trim(),
            location: location.trim()
        });
    }
    res.json({ success: true });
});


// --- DEMARRAGE DU SERVEUR ---
app.listen(PORT, () => {
    console.log(`Serveur HTTP connecté sur le port ${PORT}`);
    console.log(`Version de l'application : v1.0`);
});
