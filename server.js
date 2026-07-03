const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/public-app', express.static(path.join(__dirname, 'public/public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'public/dj-app')));
app.use('/public-app', express.static(path.join(__dirname, 'public-app')));
app.use('/dj-app', express.static(path.join(__dirname, 'dj-app')));

let requests = [];      
let messages = [];      
let upcomingDates = []; 

// --- 🎵 API SYSTEME DE MUSIQUE ---
app.get('/api/requests', (req, res) => {
    const sortedRequests = [...requests].sort((a, b) => b.votes - a.votes);
    res.json({ requests: sortedRequests });
});

app.post('/api/requests', (req, res) => {
    const { title, artist } = req.body;
    if (!title) return res.status(400).json({ error: "Titre manquant" });

    const duplicate = requests.find(r => 
        r.title.toLowerCase().trim() === title.toLowerCase().trim() &&
        (r.artist || '').toLowerCase().trim() === (artist || '').toLowerCase().trim()
    );

    if (duplicate) {
        duplicate.votes += 1;
    } else {
        // CORRECTION : Les morceaux commencent maintenant officiellement à 0 vote !
        requests.push({
            id: Date.now().toString(),
            title: title.trim(),
            artist: artist ? artist.trim() : 'Artiste non spécifié',
            votes: 0
        });
    }
    res.json({ success: true });
});

app.post('/api/dj/done/:id', (req, res) => {
    const { id } = req.params;
    requests = requests.filter(r => r.id !== id);
    res.json({ success: true });
});

app.post('/api/dj/clear', (req, res) => {
    requests = [];
    res.json({ success: true });
});

// --- 💬 API SYSTEME DE MESSAGES ---
app.get('/api/messages', (req, res) => {
    res.json({ messages });
});

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

app.post('/api/dj/messages/clear', (req, res) => {
    messages = [];
    res.json({ success: true });
});

// --- 📅 API SYSTEME DE CALENDRIER ---
app.get('/api/dates', (req, res) => {
    res.json({ dates: upcomingDates });
});

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

app.listen(PORT, () => {
    console.log(`Serveur HTTP connecté sur le port ${PORT}`);
});
