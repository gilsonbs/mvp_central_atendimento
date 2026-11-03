CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'seller')),
  available boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  last_assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  seller_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10),
  slot smallint CHECK (slot IN (1,2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  closed_at timestamptz,
  CHECK (
    (status = 'waiting' AND seller_id IS NULL AND slot IS NULL AND started_at IS NULL AND closed_at IS NULL) OR
    (status = 'active' AND seller_id IS NOT NULL AND slot IS NOT NULL AND started_at IS NOT NULL AND closed_at IS NULL) OR
    (status = 'closed' AND seller_id IS NOT NULL AND slot IS NULL AND started_at IS NOT NULL AND closed_at IS NOT NULL)
  )
);
-- Duas vagas únicas por vendedor protegem o limite mesmo fora da API.
CREATE UNIQUE INDEX seller_active_slots ON attendances(seller_id, slot) WHERE status = 'active';
CREATE UNIQUE INDEX customer_open_attendance ON attendances(customer_id) WHERE status IN ('waiting', 'active');
CREATE INDEX queue_order ON attendances(priority DESC, created_at, id) WHERE status = 'waiting';
CREATE TABLE attendance_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_id uuid NOT NULL REFERENCES attendances(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('queued', 'claimed', 'transferred', 'closed')),
  from_seller_id uuid REFERENCES users(id),
  to_seller_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
