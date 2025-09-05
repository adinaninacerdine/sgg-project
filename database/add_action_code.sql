-- Ajouter la colonne action_code si elle n'existe pas
ALTER TABLE actions 
ADD COLUMN IF NOT EXISTS action_code VARCHAR(20) UNIQUE;

-- Fonction pour générer l'ID alphanumérique
CREATE OR REPLACE FUNCTION generate_action_code() 
RETURNS VARCHAR AS $$
DECLARE
    year_part VARCHAR;
    seq_part VARCHAR;
    new_code VARCHAR;
    max_seq INTEGER;
BEGIN
    year_part := TO_CHAR(CURRENT_DATE, 'YYYY');
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(action_code FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO max_seq
    FROM actions
    WHERE action_code LIKE 'ACT-' || year_part || '-%';
    
    seq_part := LPAD(max_seq::VARCHAR, 3, '0');
    new_code := 'ACT-' || year_part || '-' || seq_part;
    
    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Mettre à jour les actions existantes
UPDATE actions 
SET action_code = 'ACT-2025-' || LPAD(id::VARCHAR, 3, '0')
WHERE action_code IS NULL;

-- Trigger pour les nouvelles actions
CREATE OR REPLACE FUNCTION set_action_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.action_code IS NULL THEN
        NEW.action_code := generate_action_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_action_code ON actions;
CREATE TRIGGER trigger_set_action_code
BEFORE INSERT ON actions
FOR EACH ROW
EXECUTE FUNCTION set_action_code();

-- Créer la table d'historique si elle n'existe pas
CREATE TABLE IF NOT EXISTS action_history (
    id SERIAL PRIMARY KEY,
    action_id INTEGER REFERENCES actions(id),
    user_id INTEGER REFERENCES users(id),
    action_type VARCHAR(50),
    changes JSONB,
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
