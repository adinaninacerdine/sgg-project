# 🏛️ SGG - Système de Gestion des Actions Ministérielles

## 🚀 Démarrage Rapide

### Prérequis
- Node.js (v14+)
- PostgreSQL (v12+)
- Python 3 (pour servir le frontend)

### Installation

1. **Installer les prérequis**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm postgresql postgresql-contrib python3

# macOS
brew install node postgresql python3

# Windows
# Télécharger depuis les sites officiels
```

2. **Lancer l'application**
```bash
./start.sh
```

3. **Accéder à l'application**
- Frontend: http://localhost:8080
- API: http://localhost:3000/api
- Compte test: admin@sgg.km / Admin@2025

### Structure du Projet
```
sgg-project/
├── backend/          # API Node.js/Express
├── frontend/         # Interface HTML/JS
├── database/         # Scripts SQL
└── start.sh         # Script de démarrage
```

### Commandes Utiles

**Démarrer le backend uniquement:**
```bash
cd backend && npm start
```

**Démarrer le frontend uniquement:**
```bash
cd frontend && python3 -m http.server 8080
```

**Réinitialiser la base de données:**
```bash
sudo -u postgres psql -c "DROP DATABASE sgg_db;"
sudo -u postgres psql -f database/schema.sql
```

### Dépannage

**PostgreSQL ne démarre pas:**
```bash
sudo service postgresql restart
```

**Port déjà utilisé:**
```bash
# Trouver le processus
lsof -i :3000  # ou :8080
# Tuer le processus
kill -9 [PID]
```

**Erreur de connexion à la base:**
- Vérifier que PostgreSQL est démarré
- Vérifier les identifiants dans backend/.env
- Vérifier que l'utilisateur sgg_user existe

### 📞 Support
Pour toute question, consultez la documentation complète.
