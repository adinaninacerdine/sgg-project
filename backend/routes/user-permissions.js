const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Middleware pour vérifier si l'utilisateur est admin
const requireAdmin = (req, res, next) => {
    if (req.user.role \!== 'admin' && \!req.user.is_super_admin) {
        return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    next();
};

// Obtenir toutes les permissions d'un utilisateur
router.get('/user/:userId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await pool.query(`
            SELECT 
                ump.*,
                m.name as ministry_name,
                u.name as user_name,
                u.email as user_email
            FROM user_ministry_permissions ump
            JOIN ministries m ON m.id = ump.ministry_id
            JOIN users u ON u.id = ump.user_id
            WHERE ump.user_id = $1
            ORDER BY m.name
        `, [userId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur récupération permissions:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des permissions' });
    }
});

// Attribuer ou mettre à jour les permissions pour un utilisateur
router.post('/assign', authenticateToken, requireAdmin, async (req, res) => {
    const { 
        user_id, 
        ministry_permissions // Array of { ministry_id, can_view, can_create, can_edit, can_delete }
    } = req.body;

    if (\!user_id || \!ministry_permissions || \!Array.isArray(ministry_permissions)) {
        return res.status(400).json({ error: 'Données invalides' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Supprimer toutes les permissions existantes
        await client.query(
            'DELETE FROM user_ministry_permissions WHERE user_id = $1',
            [user_id]
        );

        // Insérer les nouvelles permissions
        for (const perm of ministry_permissions) {
            await client.query(`
                INSERT INTO user_ministry_permissions (
                    user_id, ministry_id,
                    can_view_actions, can_create_actions, 
                    can_edit_actions, can_delete_actions,
                    can_view_team, can_manage_team,
                    can_view_reports, can_export_data,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                user_id,
                perm.ministry_id,
                perm.can_view || false,
                perm.can_create || false,
                perm.can_edit || false,
                perm.can_delete || false,
                perm.can_view_team || false,
                perm.can_manage_team || false,
                perm.can_view_reports || false,
                perm.can_export_data || false,
                req.user.id
            ]);
        }

        await client.query('COMMIT');

        // Récupérer les permissions mises à jour
        const updatedPerms = await pool.query(`
            SELECT 
                ump.*,
                m.name as ministry_name
            FROM user_ministry_permissions ump
            JOIN ministries m ON m.id = ump.ministry_id
            WHERE ump.user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            permissions: updatedPerms.rows
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erreur attribution permissions:', error);
        res.status(500).json({ error: 'Erreur lors de l\'attribution des permissions' });
    } finally {
        client.release();
    }
});

// Créer un utilisateur avec ses permissions
router.post('/create-user', authenticateToken, requireAdmin, async (req, res) => {
    const { 
        name, 
        email, 
        password, 
        role = 'user',
        ministry_permissions 
    } = req.body;

    if (\!name || \!email || \!password) {
        return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Vérifier si l'email existe déjà
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Cet email est déjà utilisé' });
        }

        // Hasher le mot de passe
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);

        // Créer l'utilisateur
        const userResult = await client.query(`
            INSERT INTO users (name, email, password, role, is_active, created_at)
            VALUES ($1, $2, $3, $4, true, NOW())
            RETURNING id, name, email, role
        `, [name, email, hashedPassword, role]);

        const newUserId = userResult.rows[0].id;

        // Attribuer les permissions si fournies
        if (ministry_permissions && Array.isArray(ministry_permissions)) {
            for (const perm of ministry_permissions) {
                await client.query(`
                    INSERT INTO user_ministry_permissions (
                        user_id, ministry_id,
                        can_view_actions, can_create_actions, 
                        can_edit_actions, can_delete_actions,
                        can_view_team, can_manage_team,
                        can_view_reports, can_export_data,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    newUserId,
                    perm.ministry_id,
                    perm.can_view || false,
                    perm.can_create || false,
                    perm.can_edit || false,
                    perm.can_delete || false,
                    perm.can_view_team || false,
                    perm.can_manage_team || false,
                    perm.can_view_reports || false,
                    perm.can_export_data || false,
                    req.user.id
                ]);
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            user: userResult.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erreur création utilisateur:', error);
        res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur' });
    } finally {
        client.release();
    }
});

// Obtenir tous les ministères disponibles
router.get('/ministries', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM ministries ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur récupération ministères:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des ministères' });
    }
});

// Obtenir un résumé des permissions par utilisateur
router.get('/summary', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                u.role,
                COUNT(DISTINCT ump.ministry_id) as ministries_count,
                array_agg(DISTINCT m.name) as ministries
            FROM users u
            LEFT JOIN user_ministry_permissions ump ON u.id = ump.user_id
            LEFT JOIN ministries m ON m.id = ump.ministry_id
            WHERE u.role \!= 'admin'
            GROUP BY u.id, u.name, u.email, u.role
            ORDER BY u.name
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur résumé permissions:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du résumé' });
    }
});

module.exports = router;
