ALTER TABLE calls ADD COLUMN IF NOT EXISTS rating INT CHECK (rating >= 1 AND rating <= 5);
