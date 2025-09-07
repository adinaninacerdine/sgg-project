const pool = require('../config/database');

// Middleware RBAC (Role-Based Access Control) par ministère
const rbac = {
    // Vérifier l'accès à un ministère avec une permission spécifique
    checkMinistryAccess: (action = 'read') => {
        return async (req, res, next) => {
            try {
                const userId = req.user.id;
                const userRole = req.user.role;

                // Super admin a tous les droits
                if (req.user.is_super_admin) {
                    req.userPermissions = { all: true };
                    return next();
                }

                // Admin a tous les droits
                if (userRole === 'admin') {
                    req.userPermissions = { all: true };
                    return next();
                }

                // Déterminer le ministère concerné
                let ministryName = null;
                
                // Depuis les paramètres de route
                if (req.params.id) {
                    const actionResult = await pool.query(
                        'SELECT ministry FROM actions WHERE id = $1::INTEGER OR action_code = $1::TEXT',
                        [req.params.id]
                    );
                    if (actionResult.rows.length > 0) {
                        ministryName = actionResult.rows[0].ministry;
                    }
                }
                
                // Depuis le body de la requête
                if (\!ministryName && req.body.ministry) {
                    ministryName = req.body.ministry;
                }
                
                // Depuis les query params
                if (\!ministryName && req.query.ministry) {
                    ministryName = req.query.ministry;
                }

                // Si pas de ministère spécifique, on vérifie tous les accès
                if (\!ministryName) {
                    const permissionsResult = await pool.query(`
                        SELECT 
                            m.name as ministry_name,
                            ump.can_view_actions,
                            ump.can_create_actions,
                            ump.can_edit_actions,
                            ump.can_delete_actions
                        FROM user_ministry_permissions ump
                        JOIN ministries m ON m.id = ump.ministry_id
                        WHERE ump.user_id = $1
                    `, [userId]);

                    req.userPermissions = {
                        ministries: permissionsResult.rows
                    };

                    // Pour une liste, on continue (le filtrage se fera dans la route)
                    if (action === 'read' && \!req.params.id) {
                        return next();
                    }
                }

                // Vérifier les permissions pour un ministère spécifique
                if (ministryName) {
                    const permResult = await pool.query(`
                        SELECT ump.* 
                        FROM user_ministry_permissions ump
                        JOIN ministries m ON m.id = ump.ministry_id
                        WHERE ump.user_id = $1 AND m.name = $2
                    `, [userId, ministryName]);

                    if (permResult.rows.length === 0) {
                        return res.status(403).json({ 
                            error: 'Accès refusé : vous n\'avez pas accès à ce ministère'
                        });
                    }

                    const permissions = permResult.rows[0];
                    let hasPermission = false;

                    switch(action) {
                        case 'read':
                            hasPermission = permissions.can_view_actions;
                            break;
                        case 'create':
                            hasPermission = permissions.can_create_actions;
                            break;
                        case 'update':
                            hasPermission = permissions.can_edit_actions;
                            break;
                        case 'delete':
                            hasPermission = permissions.can_delete_actions;
                            break;
                    }

                    if (\!hasPermission) {
                        return res.status(403).json({ 
                            error: `Permission refusée : ${action} sur ${ministryName}`
                        });
                    }

                    req.userPermissions = {
                        ministry: ministryName,
                        permissions: permissions
                    };
                }

                next();
            } catch (error) {
                console.error('Erreur RBAC:', error);
                res.status(500).json({ error: 'Erreur lors de la vérification des permissions' });
            }
        };
    },

    // Filtrer les résultats selon les permissions
    filterByPermissions: async (userId, query, params = []) => {
        // Récupérer les ministères autorisés pour l'utilisateur
        const permResult = await pool.query(`
            SELECT m.name 
            FROM user_ministry_permissions ump
            JOIN ministries m ON m.id = ump.ministry_id
            WHERE ump.user_id = $1 AND ump.can_view_actions = true
        `, [userId]);

        if (permResult.rows.length === 0) {
            // Aucun accès
            return { query: query + ' AND 1=0', params };
        }

        const allowedMinistries = permResult.rows.map(r => r.name);
        const paramIndex = params.length + 1;
        
        query += ` AND ministry = ANY($${paramIndex})`;
        params.push(allowedMinistries);

        return { query, params };
    },

    // Logger les actions
    logAction: (actionType) => {
        return async (req, res, next) => {
            const originalSend = res.json;
            
            res.json = async function(data) {
                try {
                    if (res.statusCode < 400) {
                        const actionId = req.params.id || data?.id || data?.action?.id;
                        
                        if (actionId) {
                            await pool.query(`
                                INSERT INTO action_history 
                                (action_id, user_id, action_type, changes, performed_at)
                                VALUES ($1, $2, $3, $4, NOW())
                            `, [
                                actionId,
                                req.user.id,
                                actionType,
                                JSON.stringify({
                                    method: req.method,
                                    path: req.path,
                                    body: req.body || {},
                                    query: req.query || {}
                                })
                            ]);
                        }
                    }
                } catch (error) {
                    console.error('Erreur log action:', error);
                }
                
                originalSend.call(this, data);
            };
            
            next();
        };
    }
};

module.exports = rbac;
