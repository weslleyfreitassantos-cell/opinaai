ALTER TABLE surveys ADD COLUMN IF NOT EXISTS preview_token VARCHAR(43);
CREATE UNIQUE INDEX IF NOT EXISTS surveys_preview_token_idx ON surveys(preview_token) WHERE preview_token IS NOT NULL;
