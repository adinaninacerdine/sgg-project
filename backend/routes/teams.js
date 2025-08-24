const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Récupérer tous les membres de l'équipe
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { ministry } = req.query;
        let query = 'SELECT * FROM team_members';
        const params = [];

        // Filtre optionnel par ministère
        if (ministry) {
            query += ' WHERE ministry = $1';
            params.push(ministry);
        }

        query += ' ORDER BY name ASC';

        const result = await pool.query(query, params);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('Erreur récupération équipe:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des membres' });
    }
});

// Récupérer un membre par ID
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM team_members WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Membre non trouvé' });
        }

        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Erreur récupération membre:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du membre' });
    }
});

// Ajouter un nouveau membre
router.post('/', authenticateToken, [
    body('name').notEmpty().trim().withMessage('Le nom est requis'),
    body('email').optional().isEmail().withMessage('Email invalide'),
    body('phone').optional().matches(/^[+\d\s\-()]+$/).withMessage('Numéro de téléphone invalide')
], async (req, res) => {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, position, ministry, email, phone, notes } = req.body;

    try {
        // Vérifier si un membre avec le même email existe déjà
        if (email) {
            const emailExists = await pool.query(
                'SELECT * FROM team_members WHERE email = $1',
                [email]
            );

            if (emailExists.rows.length > 0) {
                return res.status(400).json({ error: 'Un membre avec cet email existe déjà' });
            }
        }

        const result = await pool.query(
            `INSERT INTO team_members 
            (name, position, ministry, email, phone, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, position || null, ministry || null, email || null, phone || null, notes || null]
        );

        res.status(201).json({
            message: 'Membre ajouté avec succès',
            member: result.rows[0]
        });

        console.log(`✅ Nouveau membre ajouté: ${name}`);

    } catch (error) {
        console.error('Erreur ajout membre:', error);
        res.status(500).json({ error: 'Erreur lors de l\'ajout du membre' });
    }
});

// Mettre à jour un membre
router.put('/:id', authenticateToken, [
    body('email').optional().isEmail().withMessage('Email invalide'),
    body('phone').optional().matches(/^[+\d\s\-()]+$/).withMessage('Numéro de téléphone invalide')
], async (req, res) => {
    const { id } = req.params;
    const { name, position, ministry, email, phone, notes } = req.body;

    try {
        // Vérifier que le membre existe
        const checkMember = await pool.query(
            'SELECT * FROM team_members WHERE id = $1',
            [id]
        );

        if (checkMember.rows.length === 0) {
            return res.status(404).json({ error: 'Membre non trouvé' });
        }

        // Vérifier l'unicité de l'email si modifié
        if (email && email !== checkMember.rows[0].email) {
            const emailExists = await pool.query(
                'SELECT * FROM team_members WHERE email = $1 AND id != $2',
                [email, id]
            );

            if (emailExists.rows.length > 0) {
                return res.status(400).json({ error: 'Un autre membre utilise déjà cet email' });
            }
        }

        // Construire la requête de mise à jour dynamiquement
        const updates = [];
        const values = [];
        let paramCount = 0;

        if (name !== undefined) {
            paramCount++;
            updates.push(`name = $${paramCount}`);
            values.push(name);
        }

        if (position !== undefined) {
            paramCount++;
            updates.push(`position = $${paramCount}`);
            values.push(position);
        }

        if (ministry !== undefined) {
            paramCount++;
            updates.push(`ministry = $${paramCount}`);
            values.push(ministry);
        }

        if (email !== undefined) {
            paramCount++;
            updates.push(`email = $${paramCount}`);
            values.push(email);
        }

        if (phone !== undefined) {
            paramCount++;
            updates.push(`phone = $${paramCount}`);
            values.push(phone);
        }

        if (notes !== undefined) {
            paramCount++;
            updates.push(`notes = $${paramCount}`);
            values.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune modification fournie' });
        }

        // Ajouter l'ID à la fin
        paramCount++;
        values.push(id);

        const query = `UPDATE team_members SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        
        const result = await pool.query(query, values);

        res.json({
            message: 'Membre mis à jour avec succès',
            member: result.rows[0]
        });

        console.log(`✅ Membre mis à jour: ID ${id}`);

    } catch (error) {
        console.error('Erreur mise à jour membre:', error);
        res.status(500).json({ error: 'Erreur lors de la mise à jour du membre' });
    }
});

// Supprimer un membre
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    try {
        // Vérifier si le membre est responsable d'actions
        const checkActions = await pool.query(
            'SELECT COUNT(*) as count FROM actions WHERE responsible = (SELECT name FROM team_members WHERE id = $1)',
            [id]
        );

        if (checkActions.rows[0].count > 0) {
            return res.status(400).json({ 
                error: `Ce membre est responsable de ${checkActions.rows[0].count} action(s). Veuillez d'abord réassigner ces actions.` 
            });
        }

        const result = await pool.query(
            'DELETE FROM team_members WHERE id = $1 RETURNING id, name',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Membre non trouvé' });
        }

        res.json({ 
            message: 'Membre supprimé avec succès',
            deleted: result.rows[0]
        });

        console.log(`✅ Membre supprimé: ${result.rows[0].name}`);

    } catch (error) {
        console.error('Erreur suppression membre:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression du membre' });
    }
});

// Obtenir les statistiques par membre
router.get('/stats/performance', authenticateToken, async (req, res) => {
    try {
        const memberStats = await pool.query(`
            SELECT 
                tm.id,
                tm.name,
                tm.position,
                tm.ministry,
                COUNT(a.id) as total_actions,
                COUNT(CASE WHEN a.status = 'termine' THEN 1 END) as completed_actions,
                COUNT(CASE WHEN a.status = 'en-cours' THEN 1 END) as in_progress_actions,
                COUNT(CASE WHEN a.end_date < CURRENT_DATE AND a.status != 'termine' THEN 1 END) as overdue_actions,
                CASE 
                    WHEN COUNT(a.id) > 0 
                    THEN ROUND((COUNT(CASE WHEN a.status = 'termine' THEN 1 END)::NUMERIC / COUNT(a.id)) * 100, 2)
                    ELSE 0 
                END as completion_rate
            FROM team_members tm
            LEFT JOIN actions a ON tm.name = a.responsible
            GROUP BY tm.id, tm.name, tm.position, tm.ministry
            ORDER BY total_actions DESC
        `);

        const topPerformers = await pool.query(`
            SELECT 
                tm.name,
                tm.ministry,
                COUNT(CASE WHEN a.status = 'termine' THEN 1 END) as completed_count
            FROM team_members tm
            LEFT JOIN actions a ON tm.name = a.responsible
            GROUP BY tm.name, tm.ministry
            HAVING COUNT(CASE WHEN a.status = 'termine' THEN 1 END) > 0
            ORDER BY completed_count DESC
            LIMIT 5
        `);

        res.json({
            memberStats: memberStats.rows,
            topPerformers: topPerformers.rows
        });

    } catch (error) {
        console.error('Erreur statistiques équipe:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

// Récupérer les responsables uniques (pour les listes déroulantes)
router.get('/list/responsables', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT name, ministry 
            FROM team_members 
            ORDER BY name ASC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error('Erreur récupération responsables:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des responsables' });
    }
});

// Import en masse de membres (CSV)
router.post('/import', authenticateToken, async (req, res) => {
    const { members } = req.body;

    if (!Array.isArray(members)) {
        return res.status(400).json({ error: 'Format invalide. Un tableau de membres est attendu.' });
    }

    const imported = [];
    const errors = [];

    for (const member of members) {
        try {
            // Validation basique
            if (!member.name) {
                errors.push({ member, error: 'Nom requis' });
                continue;
            }

            // Vérifier l'unicité de l'email
            if (member.email) {
                const emailExists = await pool.query(
                    'SELECT * FROM team_members WHERE email = $1',
                    [member.email]
                );

                if (emailExists.rows.length > 0) {
                    errors.push({ member, error: 'Email déjà utilisé' });
                    continue;
                }
            }

            const result = await pool.query(
                `INSERT INTO team_members 
                (name, position, ministry, email, phone, notes)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *`,
                [
                    member.name,
                    member.position || null,
                    member.ministry || null,
                    member.email || null,
                    member.phone || null,
                    member.notes || null
                ]
            );

            imported.push(result.rows[0]);

        } catch (error) {
            errors.push({ member, error: error.message });
        }
    }

    res.json({
        message: `Import terminé: ${imported.length} membres ajoutés, ${errors.length} erreurs`,
        imported: imported,
        errors: errors
    });

    console.log(`✅ Import en masse: ${imported.length} membres ajoutés`);
});

// Export des membres en CSV
router.get('/export/csv', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                name as "Nom",
                position as "Position",
                ministry as "Ministère",
                email as "Email",
                phone as "Téléphone",
                notes as "Notes"
            FROM team_members
            ORDER BY name ASC
        `);

        // Créer le CSV
        const headers = Object.keys(result.rows[0] || {}).join(',');
        const rows = result.rows.map(row => 
            Object.values(row).map(val => 
                val !== null && val !== undefined ? `"${String(val).replace(/"/g, '""')}"` : '""'
            ).join(',')
        );

        const csv = [headers, ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="equipe_export.csv"');
        res.send('\ufeff' + csv); // BOM pour Excel

    } catch (error) {
        console.error('Erreur export CSV:', error);
        res.status(500).json({ error: 'Erreur lors de l\'export' });
    }
});

module.exports = router;
