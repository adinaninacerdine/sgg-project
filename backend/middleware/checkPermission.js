const jwt = require('jsonwebtoken');

const checkPermission = (resource, action) => {
    return (req, res, next) => {
        try {
            // Récupérer le token
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'Token manquant' });
            }

            // Décoder le token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            
            // Admin a tous les droits
            if (decoded.role === 'admin') {
                return next();
            }
            
            // Vérifier les permissions spécifiques
            const permissions = decoded.permissions || {};
            const resourcePerms = permissions[resource] || {};
            
            let hasPermission = false;
            switch(action) {
                case 'read':
                    hasPermission = resourcePerms.read === true;
                    break;
                case 'write':
                    hasPermission = resourcePerms.write === true;
                    break;
                case 'update':
                    hasPermission = resourcePerms.update === true;
                    break;
                case 'delete':
                    hasPermission = resourcePerms.delete === true;
                    break;
            }
            
            if (!hasPermission) {
                return res.status(403).json({ 
                    error: 'Permission refusée',
                    required: `${action} sur ${resource}`
                });
            }
            
            next();
        } catch (error) {
            console.error('Erreur vérification permission:', error);
            res.status(401).json({ error: 'Token invalide' });
        }
    };
};

module.exports = checkPermission;
