const express = require('express');
const pool = require('../config/database');

const router = express.Router();

// Récupérer tous les ministères (route publique)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, abbrev, description FROM ministries ORDER BY name ASC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur récupération ministères:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des ministères' });
    }
});

// Récupérer un ministère par ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT * FROM ministries WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ministère non trouvé' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erreur récupération ministère:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
});

module.exports = router;
