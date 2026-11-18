CREATE TABLE guardian_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance text NOT NULL,
  previous_state text,
  current_state text NOT NULL,
  checked_at timestamptz NOT NULL,
  last_incoming_at timestamptz
);
CREATE INDEX guardian_events_instance_id_idx ON guardian_events(instance, id DESC);
