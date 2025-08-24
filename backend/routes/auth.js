const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Route d'inscription
router.post('/signup', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').notEmpty().trim(),
    body('ministry').notEmpty()
], async (req, res) => {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, ministry } = req.body;

    try {
        // Vérifier si l'utilisateur existe déjà
        const userExists = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
        }

        // Hasher le mot de passe
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Créer le nouvel utilisateur
        const newUser = await pool.query(
            'INSERT INTO users (name, email, password, ministry, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, ministry, role, created_at',
            [name, email, hashedPassword, ministry, 'user']
        );

        res.status(201).json({
            message: 'Compte créé avec succès',
            user: {
                id: newUser.rows[0].id,
                name: newUser.rows[0].name,
                email: newUser.rows[0].email,
                ministry: newUser.rows[0].ministry,
                role: newUser.rows[0].role
            }
        });

        console.log(`✅ Nouvel utilisateur créé: ${email}`);

    } catch (error) {
        console.error('Erreur lors de l\'inscription:', error);
        res.status(500).json({ error: 'Erreur lors de la création du compte' });
    }
});

// Route de connexion
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        // Récupérer l'utilisateur par email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const user = result.rows[0];

	// ⚠️ AJOUTER CETTE VÉRIFICATION ICI ⚠️
        // Vérifier si le compte est activé
        if (user.is_active === false) {
            return res.status(403).json({ 
                error: 'Votre compte est en attente de validation par un administrateur. Vous recevrez un email une fois votre compte activé.' 
            });
        }
        // ⚠️ FIN DE LA VÉRIFICATION ⚠️

        // Vérifier le mot de passe
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        // Mettre à jour la dernière connexion
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        // Créer le token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                name: user.name,
                role: user.role,
                ministry: user.ministry 
            },
            process.env.JWT_SECRET || 'default_secret_key',
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Connexion réussie',
            token: token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                ministry: user.ministry,
                role: user.role
            }
        });

        console.log(`✅ Connexion réussie pour: ${email}`);

    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(500).json({ error: 'Erreur lors de la connexion' });
    }
});

// Route de vérification du token
router.get('/verify', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ valid: false, error: 'Token manquant' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');
        
        // Récupérer les infos utilisateur actualisées
        const result = await pool.query(
            'SELECT id, name, email, ministry, role FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ valid: false, error: 'Utilisateur non trouvé' });
        }

        res.json({
            valid: true,
            user: result.rows[0]
        });

    } catch (error) {
        res.status(403).json({ valid: false, error: 'Token invalide' });
    }
});

// Route de changement de mot de passe
router.post('/change-password', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Non autorisé' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Mots de passe requis' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
        }

        // Récupérer l'utilisateur
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        const user = result.rows[0];

        // Vérifier l'ancien mot de passe
        const validPassword = await bcrypt.compare(oldPassword, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
        }

        // Hasher le nouveau mot de passe
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Mettre à jour le mot de passe
        await pool.query(
            'UPDATE users SET password = $1 WHERE id = $2',
            [hashedPassword, decoded.id]
        );

        res.json({ message: 'Mot de passe modifié avec succès' });

    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({ error: 'Erreur lors du changement de mot de passe' });
    }
});

// Route de déconnexion (optionnelle - gérée côté client)
router.post('/logout', (req, res) => {
    // En pratique, la déconnexion est gérée côté client en supprimant le token
    res.json({ message: 'Déconnexion réussie' });
});

// Créer un utilisateur admin par défaut si la base est vide
async function createDefaultAdmin() {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM users');
        const count = parseInt(result.rows[0].count);

        if (count === 0) {
            const hashedPassword = await bcrypt.hash('Admin@2025', 10);
            await pool.query(
                'INSERT INTO users (name, email, password, ministry, role) VALUES ($1, $2, $3, $4, $5)',
                ['Administrateur', 'admin@sgg.km', hashedPassword, 'Administration', 'admin']
            );
            console.log('✅ Compte admin par défaut créé: admin@sgg.km / Admin@2025');
        }
    } catch (error) {
        console.error('Erreur création admin par défaut:', error);
    }
}

// Créer l'admin par défaut au démarrage
createDefaultAdmin();

module.exports = router;
