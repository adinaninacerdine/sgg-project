const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Middleware pour vérifier si l'utilisateur est admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Accès refusé. Droits administrateur requis.' });
    }
    next();
};

// Récupérer tous les utilisateurs (Admin seulement)
router.get('/', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.ministry, 
                u.role, 
                u.is_active,
                u.created_at,
                u.last_login,
                u.approved_at,
                approver.name as approved_by_name
            FROM users u
            LEFT JOIN users approver ON u.approved_by = approver.id
            ORDER BY u.created_at DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur récupération utilisateurs:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
    }
});

// Récupérer les utilisateurs en attente de validation
router.get('/pending', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, email, ministry, created_at 
            FROM users 
            WHERE is_active = false 
            ORDER BY created_at ASC
        `);
        
        res.json({
            count: result.rows.length,
            users: result.rows
        });
    } catch (error) {
        console.error('Erreur récupération utilisateurs en attente:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
});

// Activer un utilisateur (Admin seulement)
router.put('/:id/activate', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Vérifier que l'utilisateur existe
        const checkUser = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );
        
        if (checkUser.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        if (checkUser.rows[0].is_active) {
            return res.status(400).json({ error: 'Utilisateur déjà actif' });
        }
        
        // Activer l'utilisateur
        const result = await pool.query(`
            UPDATE users 
            SET is_active = true, 
                approved_by = $1, 
                approved_at = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING id, name, email, is_active`,
            [req.user.id, id]
        );
        
        console.log(`✅ Utilisateur activé: ${result.rows[0].email} par ${req.user.email}`);
        
        res.json({
            message: 'Utilisateur activé avec succès',
            user: result.rows[0]
        });
        
        // TODO: Envoyer un email de notification à l'utilisateur
        
    } catch (error) {
        console.error('Erreur activation utilisateur:', error);
        res.status(500).json({ error: 'Erreur lors de l\'activation' });
    }
});

// Désactiver un utilisateur (Admin seulement)
router.put('/:id/deactivate', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Empêcher la désactivation de son propre compte
        if (req.user.id === parseInt(id)) {
            return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
        }
        
        // Vérifier que l'utilisateur existe
        const checkUser = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );
        
        if (checkUser.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Empêcher la désactivation du dernier admin
        if (checkUser.rows[0].role === 'admin') {
            const adminCount = await pool.query(
                'SELECT COUNT(*) FROM users WHERE role = $1 AND is_active = true',
                ['admin']
            );
            
            if (parseInt(adminCount.rows[0].count) <= 1) {
                return res.status(400).json({ error: 'Impossible de désactiver le dernier administrateur' });
            }
        }
        
        // Désactiver l'utilisateur
        const result = await pool.query(
            'UPDATE users SET is_active = false WHERE id = $1 RETURNING id, name, email, is_active',
            [id]
        );
        
        console.log(`⚠️ Utilisateur désactivé: ${result.rows[0].email} par ${req.user.email}`);
        
        res.json({
            message: 'Utilisateur désactivé',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur désactivation utilisateur:', error);
        res.status(500).json({ error: 'Erreur lors de la désactivation' });
    }
});

// Changer le rôle d'un utilisateur (Admin seulement)
router.put('/:id/role', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide' });
    }
    
    try {
        // Empêcher de modifier son propre rôle
        if (req.user.id === parseInt(id)) {
            return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle' });
        }
        
        // Vérifier qu'on ne supprime pas le dernier admin
        if (role === 'user') {
            const currentUser = await pool.query(
                'SELECT role FROM users WHERE id = $1',
                [id]
            );
            
            if (currentUser.rows[0]?.role === 'admin') {
                const adminCount = await pool.query(
                    'SELECT COUNT(*) FROM users WHERE role = $1 AND is_active = true',
                    ['admin']
                );
                
                if (parseInt(adminCount.rows[0].count) <= 1) {
                    return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur' });
                }
            }
        }
        
        const result = await pool.query(
            'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
            [role, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        console.log(`🔄 Rôle modifié pour ${result.rows[0].email}: ${role} par ${req.user.email}`);
        
        res.json({
            message: 'Rôle modifié avec succès',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur modification rôle:', error);
        res.status(500).json({ error: 'Erreur lors de la modification du rôle' });
    }
});

// Supprimer un utilisateur (Admin seulement)
router.delete('/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Empêcher la suppression de son propre compte
        if (req.user.id === parseInt(id)) {
            return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
        }
        
        // Vérifier que l'utilisateur existe
        const checkUser = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );
        
        if (checkUser.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Empêcher la suppression du dernier admin
        if (checkUser.rows[0].role === 'admin') {
            const adminCount = await pool.query(
                'SELECT COUNT(*) FROM users WHERE role = $1',
                ['admin']
            );
            
            if (parseInt(adminCount.rows[0].count) <= 1) {
                return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur' });
            }
        }
        
        // Supprimer l'utilisateur
        const result = await pool.query(
            'DELETE FROM users WHERE id = $1 RETURNING id, name, email',
            [id]
        );
        
        console.log(`🗑️ Utilisateur supprimé: ${result.rows[0].email} par ${req.user.email}`);
        
        res.json({
            message: 'Utilisateur supprimé',
            deleted: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur suppression utilisateur:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression' });
    }
});

// Statistiques des utilisateurs (Admin seulement)
router.get('/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active,
                COUNT(CASE WHEN is_active = false THEN 1 END) as pending,
                COUNT(CASE WHEN role = 'admin' THEN 1 END) as admins,
                COUNT(CASE WHEN role = 'user' THEN 1 END) as users
            FROM users
        `);
        
        const byMinistry = await pool.query(`
            SELECT 
                ministry,
                COUNT(*) as count,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active
            FROM users
            GROUP BY ministry
            ORDER BY count DESC
        `);
        
        const recentSignups = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as signups
            FROM users
            WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);
        
        res.json({
            overview: stats.rows[0],
            byMinistry: byMinistry.rows,
            recentSignups: recentSignups.rows
        });
        
    } catch (error) {
        console.error('Erreur statistiques utilisateurs:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

module.exports = router;
