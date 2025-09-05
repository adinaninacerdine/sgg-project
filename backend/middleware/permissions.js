// Middleware complémentaire pour les permissions
// Utilise le système existant de permissions booléennes

const pool = require('../config/database');

// Mapper les permissions booléennes vers les niveaux
const mapPermissionLevel = (permissions) => {
    const levels = [];
    if (permissions.can_view_actions) levels.push('read');
    if (permissions.can_create_actions) levels.push('write');
    if (permissions.can_edit_actions) levels.push('update');
    if (permissions.can_delete_actions) levels.push('delete');
    return levels;
};

// Vérifier les permissions de façon compatible
const checkActionPermission = (requiredPermission) => {
    return async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { id } = req.params;
            
            // Super admin a tous les droits
            if (req.user.is_super_admin) {
                return next();
            }
            
            // Admin a tous les droits
            if (req.user.role === 'admin') {
                return next();
            }
            
            // Récupérer l'action pour connaître le ministère
            let ministry;
            if (id) {
                const actionResult = await pool.query(
                    'SELECT ministry FROM actions WHERE id = $1 OR action_code = $1',
                    [id]
                );
                if (actionResult.rows.length > 0) {
                    ministry = actionResult.rows[0].ministry;
                }
            } else if (req.body.ministry) {
                ministry = req.body.ministry;
            }
            
            if (!ministry) {
                return res.status(400).json({ error: 'Ministère non identifié' });
            }
            
            // Récupérer l'ID du ministère
            const ministryResult = await pool.query(
                'SELECT id FROM ministries WHERE name = $1',
                [ministry]
            );
            
            if (ministryResult.rows.length === 0) {
                return res.status(404).json({ error: 'Ministère non trouvé' });
            }
            
            const ministryId = ministryResult.rows[0].id;
            
            // Vérifier les permissions
            const permResult = await pool.query(
                'SELECT * FROM user_ministry_permissions WHERE user_id = $1 AND ministry_id = $2',
                [userId, ministryId]
            );
            
            if (permResult.rows.length === 0) {
                return res.status(403).json({ 
                    error: 'Vous n\'avez pas accès à ce ministère' 
                });
            }
            
            const perms = permResult.rows[0];
            let hasPermission = false;
            
            switch(requiredPermission) {
                case 'read':
                    hasPermission = perms.can_view_actions;
                    break;
                case 'write':
                    hasPermission = perms.can_create_actions;
                    break;
                case 'update':
                    hasPermission = perms.can_edit_actions;
                    break;
                case 'delete':
                    hasPermission = perms.can_delete_actions;
                    break;
                default:
                    hasPermission = false;
            }
            
            if (!hasPermission) {
                return res.status(403).json({ 
                    error: `Permission refusée: ${requiredPermission}` 
                });
            }
            
            next();
        } catch (error) {
            console.error('Erreur vérification permissions:', error);
            res.status(500).json({ error: 'Erreur lors de la vérification des permissions' });
        }
    };
};

// Logger les actions
const logAction = (actionType) => {
    return async (req, res, next) => {
        const originalSend = res.json;
        
        res.json = async function(data) {
            try {
                if (res.statusCode < 400) {
                    const actionId = req.params.id || data?.action?.id || data?.id;
                    
                    if (actionId) {
                        // Vérifier si la table existe
                        const tableExists = await pool.query(`
                            SELECT EXISTS (
                                SELECT FROM information_schema.tables 
                                WHERE table_name = 'action_history'
                            );
                        `);
                        
                        if (tableExists.rows[0].exists) {
                            await pool.query(`
                                INSERT INTO action_history 
                                (action_id, user_id, action_type, changes)
                                VALUES ($1, $2, $3, $4)
                            `, [
                                actionId,
                                req.user.id,
                                actionType,
                                JSON.stringify(req.body || {})
                            ]);
                        }
                    }
                }
            } catch (error) {
                console.error('Erreur log action:', error);
            }
            
            originalSend.call(this, data);
        };
        
        next();
    };
};

module.exports = {
    checkActionPermission,
    logAction,
    mapPermissionLevel
};
