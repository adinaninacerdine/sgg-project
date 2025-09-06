const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Middleware d'authentification intégré
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token manquant' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide' });
        }
        req.user = user;
        next();
    });
}

// Route GET / pour lister les utilisateurs
router.get('/', authenticateToken, async (req, res) => {
    try {
        console.log('GET /api/users - User:', req.user.email);
        
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin uniquement' });
        }
        
        const result = await pool.query(
            'SELECT id, name, email, role, ministry, is_active FROM users ORDER BY id'
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur GET /users:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route PUT /:id/password pour changer le mot de passe
router.put('/:id/password', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { password } = req.body;
        
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Mot de passe trop court' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            'UPDATE users SET password = $1 WHERE id = $2',
            [hashedPassword, userId]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
