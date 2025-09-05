const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const { checkActionPermission, logAction } = require("../middleware/permissions");
const router = express.Router();

// Récupérer toutes les actions

// Route pour visualiser une action (lecture seule)
router.get('/:id/view', authenticateToken, logAction('viewed'), async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT a.*, a.action_code as id_display,
                    u.name as created_by_name,
                    TO_CHAR(a.created_at, 'DD/MM/YYYY HH24:MI') as created_at_formatted
             FROM actions a
             LEFT JOIN users u ON a.created_by = u.id
             WHERE a.id = $1 OR a.action_code = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Action non trouvée' });
        }

        const action = result.rows[0];
        
        // Vérifier les permissions
        const userId = req.user.id;
        let canRead = req.user.is_super_admin || req.user.role === 'admin';
        
        if (!canRead) {
            const ministryResult = await pool.query(
                'SELECT id FROM ministries WHERE name = $1',
                [action.ministry]
            );
            
            if (ministryResult.rows.length > 0) {
                const permResult = await pool.query(
                    'SELECT can_view_actions FROM user_ministry_permissions WHERE user_id = $1 AND ministry_id = $2',
                    [userId, ministryResult.rows[0].id]
                );
                canRead = permResult.rows.length > 0 && permResult.rows[0].can_view_actions;
            }
        }
        
        if (!canRead) {
            return res.status(403).json({ error: 'Permission refusée' });
        }

        res.json(action);
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { ministry, status, responsible } = req.query;
        let query = 'SELECT * FROM actions WHERE 1=1';
        const params = [];
        let paramCount = 0;

        // Filtres optionnels
        if (ministry) {
            paramCount++;
            query += ` AND ministry = $${paramCount}`;
            params.push(ministry);
        }

        if (status) {
            paramCount++;
            query += ` AND status = $${paramCount}`;
            params.push(status);
        }

        if (responsible) {
            paramCount++;
            query += ` AND responsible = $${paramCount}`;
            params.push(responsible);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('Erreur récupération actions:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des actions' });
    }
});

// Récupérer une action par ID
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM actions WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Action non trouvée' });
        }

        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Erreur récupération action:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de l\'action' });
    }
});

// Créer une nouvelle action
router.post('/', authenticateToken, [
    body('ministry').notEmpty().withMessage('Le ministère est requis'),
    body('action_title').notEmpty().withMessage('Le titre est requis'),
    body('responsible').notEmpty().withMessage('Le responsable est requis'),
    body('priority').isIn(['basse', 'moyenne', 'haute']).withMessage('Priorité invalide'),
    body('status').isIn(['nouveau', 'en-cours', 'termine', 'en-retard']).withMessage('Statut invalide'),
    body('start_date').isISO8601().withMessage('Date de début invalide'),
    body('end_date').isISO8601().withMessage('Date de fin invalide')
], async (req, res) => {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        ministry,
        action_title,
        description,
        responsible,
        priority,
        start_date,
        end_date,
        status,
        stakeholders
    } = req.body;

    try {
        // Vérifier que la date de fin est après la date de début
        if (new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
        }

        const result = await pool.query(
            `INSERT INTO actions 
            (ministry, action_title, description, responsible, priority, start_date, end_date, status, stakeholders, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                ministry,
                action_title,
                description || null,
                responsible,
                priority,
                start_date,
                end_date,
                status,
                stakeholders || [],
                req.user.id
            ]
        );

        res.status(201).json({
            message: 'Action créée avec succès',
            action: result.rows[0]
        });

        console.log(`✅ Nouvelle action créée: ${action_title}`);

    } catch (error) {
        console.error('Erreur création action:', error);
        res.status(500).json({ error: 'Erreur lors de la création de l\'action' });
    }
});

// Mettre à jour une action
router.put('/:id', authenticateToken, [
    body('priority').optional().isIn(['basse', 'moyenne', 'haute']),
    body('status').optional().isIn(['nouveau', 'en-cours', 'termine', 'en-retard']),
    body('start_date').optional().isISO8601(),
    body('end_date').optional().isISO8601()
], async (req, res) => {
    const { id } = req.params;
    const {
        ministry,
        action_title,
        description,
        responsible,
        priority,
        start_date,
        end_date,
        status,
        stakeholders
    } = req.body;

    try {
        // Vérifier que l'action existe
        const checkAction = await pool.query(
            'SELECT * FROM actions WHERE id = $1',
            [id]
        );

        if (checkAction.rows.length === 0) {
            return res.status(404).json({ error: 'Action non trouvée' });
        }

        // Vérifier les dates si elles sont fournies
        if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
        }

        // Construire la requête de mise à jour dynamiquement
        const updates = [];
        const values = [];
        let paramCount = 0;

        if (ministry !== undefined) {
            paramCount++;
            updates.push(`ministry = $${paramCount}`);
            values.push(ministry);
        }

        if (action_title !== undefined) {
            paramCount++;
            updates.push(`action_title = $${paramCount}`);
            values.push(action_title);
        }

        if (description !== undefined) {
            paramCount++;
            updates.push(`description = $${paramCount}`);
            values.push(description);
        }

        if (responsible !== undefined) {
            paramCount++;
            updates.push(`responsible = $${paramCount}`);
            values.push(responsible);
        }

        if (priority !== undefined) {
            paramCount++;
            updates.push(`priority = $${paramCount}`);
            values.push(priority);
        }

        if (start_date !== undefined) {
            paramCount++;
            updates.push(`start_date = $${paramCount}`);
            values.push(start_date);
        }

        if (end_date !== undefined) {
            paramCount++;
            updates.push(`end_date = $${paramCount}`);
            values.push(end_date);
        }

        if (status !== undefined) {
            paramCount++;
            updates.push(`status = $${paramCount}`);
            values.push(status);
        }

        if (stakeholders !== undefined) {
            paramCount++;
            updates.push(`stakeholders = $${paramCount}`);
            values.push(stakeholders);
        }

        // Ajouter updated_at
        updates.push('updated_at = CURRENT_TIMESTAMP');

        // Ajouter l'ID à la fin
        paramCount++;
        values.push(id);

        const query = `UPDATE actions SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        
        const result = await pool.query(query, values);

        res.json({
            message: 'Action mise à jour avec succès',
            action: result.rows[0]
        });

        console.log(`✅ Action mise à jour: ID ${id}`);

    } catch (error) {
        console.error('Erreur mise à jour action:', error);
        res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'action' });
    }
});

// Supprimer une action
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM actions WHERE id = $1 RETURNING id, action_title',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Action non trouvée' });
        }

        res.json({ 
            message: 'Action supprimée avec succès',
            deleted: result.rows[0]
        });

        console.log(`✅ Action supprimée: ${result.rows[0].action_title}`);

    } catch (error) {
        console.error('Erreur suppression action:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression de l\'action' });
    }
});

// Obtenir les statistiques
router.get('/stats/overview', authenticateToken, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'termine' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'en-cours' THEN 1 END) as in_progress,
                COUNT(CASE WHEN status = 'nouveau' THEN 1 END) as new,
                COUNT(CASE WHEN end_date < CURRENT_DATE AND status != 'termine' THEN 1 END) as overdue
            FROM actions
        `);

        const byMinistry = await pool.query(`
            SELECT 
                ministry,
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'termine' THEN 1 END) as completed
            FROM actions
            GROUP BY ministry
            ORDER BY total DESC
        `);

        const byPriority = await pool.query(`
            SELECT 
                priority,
                COUNT(*) as count
            FROM actions
            GROUP BY priority
        `);

        const upcomingDeadlines = await pool.query(`
            SELECT 
                id,
                action_title,
                responsible,
                end_date
            FROM actions
            WHERE status != 'termine'
                AND end_date >= CURRENT_DATE
                AND end_date <= CURRENT_DATE + INTERVAL '7 days'
            ORDER BY end_date ASC
            LIMIT 5
        `);

        res.json({
            overview: stats.rows[0],
            byMinistry: byMinistry.rows,
            byPriority: byPriority.rows,
            upcomingDeadlines: upcomingDeadlines.rows
        });

    } catch (error) {
        console.error('Erreur statistiques:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

// Export des actions en CSV (bonus)
router.get('/export/csv', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                ministry as "Ministère",
                action_title as "Titre",
                description as "Description",
                responsible as "Responsable",
                priority as "Priorité",
                TO_CHAR(start_date, 'DD/MM/YYYY') as "Date Début",
                TO_CHAR(end_date, 'DD/MM/YYYY') as "Date Fin",
                status as "Statut"
            FROM actions
            ORDER BY created_at DESC
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
        res.setHeader('Content-Disposition', 'attachment; filename="actions_export.csv"');
        res.send('\ufeff' + csv); // BOM pour Excel

    } catch (error) {
        console.error('Erreur export CSV:', error);
        res.status(500).json({ error: 'Erreur lors de l\'export' });
    }
});

// Route simplifiée pour les stats du dashboard
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'termine' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'en-cours' THEN 1 END) as in_progress,
                COUNT(CASE WHEN status = 'nouveau' THEN 1 END) as new,
                COUNT(CASE WHEN end_date < CURRENT_DATE AND status != 'termine' THEN 1 END) as overdue
            FROM actions
        `);

        res.json(stats.rows[0]);

    } catch (error) {
        console.error('Erreur statistiques:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

module.exports = router;
