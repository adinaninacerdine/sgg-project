#!/bin/bash

echo "🚀 Démarrage du système SGG"
echo "============================"

# Vérifier PostgreSQL
echo "🔍 Vérification de PostgreSQL..."
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL n'est pas installé!"
    echo "Installez PostgreSQL avec: sudo apt install postgresql postgresql-contrib"
    exit 1
fi

# Démarrer PostgreSQL si nécessaire
if ! pg_isready &> /dev/null; then
    echo "📦 Démarrage de PostgreSQL..."
    sudo service postgresql start
fi

# Créer la base de données si elle n'existe pas
echo "💾 Configuration de la base de données..."
sudo -u postgres psql << SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sgg_db') THEN
        CREATE DATABASE sgg_db;
    END IF;
END
\$\$;

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'sgg_user') THEN
        CREATE USER sgg_user WITH PASSWORD 'sgg_password_2025';
    END IF;
END
\$\$;

GRANT ALL PRIVILEGES ON DATABASE sgg_db TO sgg_user;
SQL

# Appliquer le schéma
echo "📋 Application du schéma de base de données..."
PGPASSWORD=sgg_password_2025 psql -h localhost -U sgg_user -d sgg_db -f database/schema.sql 2>/dev/null || true

# Démarrer le backend
echo "🚀 Démarrage du backend..."
cd backend
npm start &
BACKEND_PID=$!

# Démarrer le frontend
echo "🌐 Démarrage du frontend..."
cd ../frontend
python3 -m http.server 8080 &
FRONTEND_PID=$!

echo ""
echo "✅ Système SGG démarré avec succès!"
echo "===================================="
echo "📡 Backend API: http://localhost:3000/api"
echo "🌐 Frontend: http://localhost:8080"
echo "📧 Compte test: admin@sgg.km / Admin@2025"
echo ""
echo "Appuyez sur Ctrl+C pour arrêter les serveurs"

# Attendre et nettoyer à la fermeture
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
