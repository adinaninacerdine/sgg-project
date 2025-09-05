// ==========================================
// backend/routes/permissions.js
// Routes pour la gestion des permissions
// ==========================================

const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Middleware pour vérifier si l'utilisateur est admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin' && !req.user.is_super_admin) {
        return res.status(403).json({ error: 'Accès refusé. Droits administrateur requis.' });
    }
    next();
};

// Middleware pour vérifier une permission spécifique
const checkPermission = (permission) => {
    return async (req, res, next) => {
        const userId = req.user.id;
        const ministryId = req.body.ministry_id || req.params.ministry_id || req.query.ministry_id;
        
        if (!ministryId) {
            return res.status(400).json({ error: 'ID du ministère requis' });
        }

        try {
            const result = await pool.query(
                'SELECT * FROM check_user_permission($1, $2, $3)',
                [userId, ministryId, permission]
            );

            if (result.rows[0].check_user_permission) {
                next();
            } else {
                res.status(403).json({ error: `Permission refusée: ${permission}` });
            }
        } catch (error) {
            console.error('Erreur vérification permission:', error);
            res.status(500).json({ error: 'Erreur lors de la vérification des permissions' });
        }
    };
};

// Obtenir les permissions d'un utilisateur
router.get('/user/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    
    // Vérifier que l'utilisateur demande ses propres permissions ou est admin
    if (req.user.id !== parseInt(userId) && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Accès non autorisé' });
    }

    try {
        const result = await pool.query(`
            SELECT 
                m.id as ministry_id,
                m.name as ministry_name,
                m.abbrev as ministry_abbrev,
                ump.*
            FROM ministries m
            LEFT JOIN user_ministry_permissions ump 
                ON ump.ministry_id = m.id AND ump.user_id = $1
            ORDER BY m.name
        `, [userId]);

        // Vérifier aussi si l'utilisateur est super admin
        const userResult = await pool.query(
            'SELECT is_super_admin FROM users WHERE id = $1',
            [userId]
        );

        res.json({
            is_super_admin: userResult.rows[0]?.is_super_admin || false,
            permissions: result.rows
        });

    } catch (error) {
        console.error('Erreur récupération permissions:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des permissions' });
    }
});

// Obtenir tous les utilisateurs avec leurs permissions (Admin seulement)
router.get('/all', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id as user_id,
                u.name as user_name,
                u.email as user_email,
                u.role as user_role,
                u.is_active,
                u.is_super_admin,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'ministry_id', m.id,
                            'ministry_name', m.name,
                            'ministry_abbrev', m.abbrev,
                            'can_view_actions', ump.can_view_actions,
                            'can_create_actions', ump.can_create_actions,
                            'can_edit_actions', ump.can_edit_actions,
                            'can_delete_actions', ump.can_delete_actions,
                            'can_view_team', ump.can_view_team,
                            'can_manage_team', ump.can_manage_team,
                            'can_view_reports', ump.can_view_reports,
                            'can_export_data', ump.can_export_data
                        )
                    ) FILTER (WHERE m.id IS NOT NULL), 
                    '[]'
                ) as permissions
            FROM users u
            LEFT JOIN user_ministry_permissions ump ON u.id = ump.user_id
            LEFT JOIN ministries m ON ump.ministry_id = m.id
            GROUP BY u.id, u.name, u.email, u.role, u.is_active, u.is_super_admin
            ORDER BY u.name
        `);

        res.json(result.rows);

    } catch (error) {
        console.error('Erreur récupération permissions globales:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des permissions' });
    }
});

// Attribuer des permissions à un utilisateur
router.post('/assign', authenticateToken, isAdmin, async (req, res) => {
    const { 
        user_id, 
        ministry_id, 
        permissions,
        apply_to_all_ministries 
    } = req.body;

    if (!user_id || (!ministry_id && !apply_to_all_ministries)) {
        return res.status(400).json({ error: 'Données manquantes' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Si on applique à tous les ministères
        if (apply_to_all_ministries) {
            const ministriesResult = await client.query('SELECT id FROM ministries');
            
            for (const ministry of ministriesResult.rows) {
                await client.query(`
                    INSERT INTO user_ministry_permissions (
                        user_id, ministry_id,
                        can_view_actions, can_create_actions, 
                        can_edit_actions, can_delete_actions,
                        can_view_team, can_manage_team,
                        can_view_reports, can_export_data,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (user_id, ministry_id) 
                    DO UPDATE SET
                        can_view_actions = EXCLUDED.can_view_actions,
                        can_create_actions = EXCLUDED.can_create_actions,
                        can_edit_actions = EXCLUDED.can_edit_actions,
                        can_delete_actions = EXCLUDED.can_delete_actions,
                        can_view_team = EXCLUDED.can_view_team,
                        can_manage_team = EXCLUDED.can_manage_team,
                        can_view_reports = EXCLUDED.can_view_reports,
                        can_export_data = EXCLUDED.can_export_data,
                        updated_at = CURRENT_TIMESTAMP
                `, [
                    user_id,
                    ministry.id,
                    permissions.can_view_actions !== false,
                    permissions.can_create_actions || false,
                    permissions.can_edit_actions || false,
                    permissions.can_delete_actions || false,
                    permissions.can_view_team !== false,
                    permissions.can_manage_team || false,
                    permissions.can_view_reports !== false,
                    permissions.can_export_data || false,
                    req.user.id
                ]);
            }
        } else {
            // Appliquer à un ministère spécifique
            await client.query(`
                INSERT INTO user_ministry_permissions (
                    user_id, ministry_id,
                    can_view_actions, can_create_actions, 
                    can_edit_actions, can_delete_actions,
                    can_view_team, can_manage_team,
                    can_view_reports, can_export_data,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (user_id, ministry_id) 
                DO UPDATE SET
                    can_view_actions = EXCLUDED.can_view_actions,
                    can_create_actions = EXCLUDED.can_create_actions,
                    can_edit_actions = EXCLUDED.can_edit_actions,
                    can_delete_actions = EXCLUDED.can_delete_actions,
                    can_view_team = EXCLUDED.can_view_team,
                    can_manage_team = EXCLUDED.can_manage_team,
                    can_view_reports = EXCLUDED.can_view_reports,
                    can_export_data = EXCLUDED.can_export_data,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                user_id,
                ministry_id,
                permissions.can_view_actions !== false,
                permissions.can_create_actions || false,
                permissions.can_edit_actions || false,
                permissions.can_delete_actions || false,
                permissions.can_view_team !== false,
                permissions.can_manage_team || false,
                permissions.can_view_reports !== false,
                permissions.can_export_data || false,
                req.user.id
            ]);
        }

        await client.query('COMMIT');

        res.json({ 
            message: 'Permissions attribuées avec succès',
            affected_ministries: apply_to_all_ministries ? 'Tous' : 1
        });

        console.log(`✅ Permissions attribuées à l'utilisateur ${user_id} par ${req.user.email}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erreur attribution permissions:', error);
        res.status(500).json({ error: 'Erreur lors de l\'attribution des permissions' });
    } finally {
        client.release();
    }
});

// Révoquer des permissions
router.delete('/revoke', authenticateToken, isAdmin, async (req, res) => {
    const { user_id, ministry_id, revoke_all } = req.body;

    if (!user_id || (!ministry_id && !revoke_all)) {
        return res.status(400).json({ error: 'Données manquantes' });
    }

    try {
        let result;
        
        if (revoke_all) {
            // Révoquer toutes les permissions de l'utilisateur
            result = await pool.query(
                'DELETE FROM user_ministry_permissions WHERE user_id = $1 RETURNING *',
                [user_id]
            );
        } else {
            // Révoquer pour un ministère spécifique
            result = await pool.query(
                'DELETE FROM user_ministry_permissions WHERE user_id = $1 AND ministry_id = $2 RETURNING *',
                [user_id, ministry_id]
            );
        }

        res.json({
            message: 'Permissions révoquées',
            revoked_count: result.rowCount
        });

        console.log(`⚠️ Permissions révoquées pour l'utilisateur ${user_id}`);

    } catch (error) {
        console.error('Erreur révocation permissions:', error);
        res.status(500).json({ error: 'Erreur lors de la révocation des permissions' });
    }
});

// Appliquer un groupe de permissions prédéfini
router.post('/apply-group', authenticateToken, isAdmin, async (req, res) => {
    const { user_id, group_name, ministry_ids } = req.body;

    if (!user_id || !group_name || !ministry_ids || ministry_ids.length === 0) {
        return res.status(400).json({ error: 'Données manquantes' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Récupérer le groupe de permissions
        const groupResult = await client.query(
            'SELECT permissions FROM permission_groups WHERE name = $1',
            [group_name]
        );

        if (groupResult.rows.length === 0) {
            throw new Error('Groupe de permissions non trouvé');
        }

        const groupPermissions = groupResult.rows[0].permissions;

        // Appliquer les permissions à chaque ministère
        for (const ministryId of ministry_ids) {
            await client.query(`
                INSERT INTO user_ministry_permissions (
                    user_id, ministry_id,
                    can_view_actions, can_create_actions, 
                    can_edit_actions, can_delete_actions,
                    can_view_team, can_manage_team,
                    can_view_reports, can_export_data,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (user_id, ministry_id) 
                DO UPDATE SET
                    can_view_actions = EXCLUDED.can_view_actions,
                    can_create_actions = EXCLUDED.can_create_actions,
                    can_edit_actions = EXCLUDED.can_edit_actions,
                    can_delete_actions = EXCLUDED.can_delete_actions,
                    can_view_team = EXCLUDED.can_view_team,
                    can_manage_team = EXCLUDED.can_manage_team,
                    can_view_reports = EXCLUDED.can_view_reports,
                    can_export_data = EXCLUDED.can_export_data,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                user_id,
                ministryId,
                groupPermissions.can_view_actions,
                groupPermissions.can_create_actions,
                groupPermissions.can_edit_actions,
                groupPermissions.can_delete_actions,
                groupPermissions.can_view_team,
                groupPermissions.can_manage_team,
                groupPermissions.can_view_reports,
                groupPermissions.can_export_data,
                req.user.id
            ]);
        }

        await client.query('COMMIT');

        res.json({
            message: `Groupe "${group_name}" appliqué avec succès`,
            affected_ministries: ministry_ids.length
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erreur application groupe:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Obtenir les groupes de permissions disponibles
router.get('/groups', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM permission_groups ORDER BY name'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur récupération groupes:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des groupes' });
    }
});

// Vérifier si un utilisateur a une permission spécifique
router.get('/check', authenticateToken, async (req, res) => {
    const { ministry_id, permission } = req.query;
    const user_id = req.user.id;

    if (!ministry_id || !permission) {
        return res.status(400).json({ error: 'Paramètres manquants' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM check_user_permission($1, $2, $3)',
            [user_id, ministry_id, permission]
        );

        res.json({
            has_permission: result.rows[0].check_user_permission || false
        });

    } catch (error) {
        console.error('Erreur vérification permission:', error);
        res.status(500).json({ error: 'Erreur lors de la vérification' });
    }
});

module.exports = router;
