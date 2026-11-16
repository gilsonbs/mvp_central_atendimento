ALTER TABLE attendance_events ALTER COLUMN actor_id DROP NOT NULL;
CREATE TABLE whatsapp_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 instance text NOT NULL,
 provider_message_id text NOT NULL,
 attendance_id uuid NOT NULL REFERENCES attendances(id),
 body text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(instance,provider_message_id)
);
CREATE INDEX whatsapp_messages_attendance ON whatsapp_messages(attendance_id,id);
