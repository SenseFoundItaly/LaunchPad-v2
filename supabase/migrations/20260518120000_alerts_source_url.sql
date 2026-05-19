-- Add source_url to alerts so dashboard signals can link back to their origin.
ALTER TABLE alerts ADD COLUMN source_url TEXT DEFAULT NULL;
