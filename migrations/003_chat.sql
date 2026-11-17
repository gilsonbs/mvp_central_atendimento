ALTER TABLE whatsapp_messages ADD COLUMN direction text NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming','outgoing'));
ALTER TABLE whatsapp_messages ADD COLUMN sender_id uuid REFERENCES users(id);
