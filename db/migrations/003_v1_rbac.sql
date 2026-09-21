CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('cashier', 'barista', 'admin')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS opened_by_user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS closed_by_user_id UUID REFERENCES users(id);

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS kitchen_status TEXT NOT NULL DEFAULT 'NEW'
        CHECK (kitchen_status IN ('NEW', 'PREPARING', 'READY', 'DONE', 'CANCELLED'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username));

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_kitchen_status ON orders(kitchen_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_by_user ON orders(created_by_user_id);

UPDATE orders
SET kitchen_status = CASE
    WHEN status = 'CANCELLED' THEN 'CANCELLED'
    ELSE 'DONE'
END
WHERE kitchen_status = 'NEW';
