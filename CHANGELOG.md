# Changelog SGG v2.0

## [2.0.0] - 2024-09-05

### Ajouté
- 🔐 Système de permissions multi-niveaux (read, write, update, delete)
- 👁️ Modal de visualisation des actions (lecture seule)
- 🏷️ IDs alphanumériques pour les actions (ACT-2025-001)
- 📊 Dashboard interactif avec vignettes cliquables
- 📝 Historique des actions (audit trail)
- 🛡️ Middleware de vérification des permissions
- 🔒 Boutons désactivés selon les permissions

### Modifié
- Interface utilisateur avec séparation Voir/Modifier
- Routes API avec vérification des permissions
- Base de données avec nouveaux champs

### Sécurité
- Vérification des permissions à chaque action
- Logging de toutes les modifications
- Protection contre les accès non autorisés

## [1.0.0] - Version initiale
- Système de base avec permissions booléennes
- Gestion des actions ministérielles
- Authentification JWT
