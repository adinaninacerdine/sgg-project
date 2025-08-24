const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:8080',
    credentials: true
}));
app.use(express.json());

// Route de test
app.get('/api/test', (req, res) => {
    res.json({ message: '✅ API SGG fonctionne!' });
});

// Importer les routes après leur création
try {
    const authRoutes = require('./routes/auth');
    const actionsRoutes = require('./routes/actions');
    const teamsRoutes = require('./routes/teams');
    
    app.use('/api/auth', authRoutes);
    app.use('/api/actions', actionsRoutes);
    app.use('/api/teams', teamsRoutes);
} catch (err) {
    console.log('⚠️ Routes non encore créées');
}

app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📡 API disponible sur http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend attendu sur ${process.env.CLIENT_URL}`);
});
