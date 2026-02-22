-- ============================================================
-- Jamstack E-Commerce — Neon PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS & ACCOUNTS
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,                      -- NULL for OAuth-only users
  full_name     TEXT,
  avatar_url    TEXT,
  stripe_customer_id TEXT UNIQUE,
  email_verified BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,         -- bcrypt of the JWT or opaque token
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_user_id    ON sessions(user_id);

-- ============================================================
-- CATALOG
-- ============================================================

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  parent_id   UUID REFERENCES categories(id),
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  short_description TEXT,
  category_id      UUID REFERENCES categories(id),
  price_cents      INT NOT NULL CHECK (price_cents >= 0),
  compare_at_cents INT CHECK (compare_at_cents >= 0),
  currency         CHAR(3) DEFAULT 'USD',
  stripe_price_id  TEXT,                   -- Stripe Price object ID
  images           JSONB DEFAULT '[]',     -- [{url, alt, width, height}]
  tags             TEXT[] DEFAULT '{}',
  metadata         JSONB DEFAULT '{}',
  is_active        BOOLEAN DEFAULT TRUE,
  is_featured      BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_slug       ON products(slug);
CREATE INDEX idx_products_category   ON products(category_id);
CREATE INDEX idx_products_is_active  ON products(is_active);
CREATE INDEX idx_products_tags       ON products USING GIN(tags);

CREATE TABLE variants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,             -- e.g. "Blue / Large"
  options       JSONB DEFAULT '{}',        -- {"color":"Blue","size":"Large"}
  price_cents   INT,                       -- NULL inherits product price
  stripe_price_id TEXT,
  stock_qty     INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  weight_grams  INT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_variants_product  ON variants(product_id);
CREATE INDEX idx_variants_sku      ON variants(sku);

-- ============================================================
-- CARTS
-- ============================================================

CREATE TABLE carts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  session_token   TEXT,                    -- for anonymous carts
  stripe_session_id TEXT,
  metadata        JSONB DEFAULT '{}',
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_carts_user_id       ON carts(user_id);
CREATE INDEX idx_carts_session_token ON carts(session_token);

CREATE TABLE cart_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id     UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  variant_id  UUID REFERENCES variants(id),
  quantity    INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_cents INT NOT NULL,               -- snapshot at add-to-cart time
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cart_id, product_id, variant_id)
);

CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);

-- ============================================================
-- ORDERS
-- ============================================================

CREATE TYPE order_status AS ENUM (
  'pending', 'payment_processing', 'paid', 'fulfilling',
  'shipped', 'delivered', 'cancelled', 'refunded'
);

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  status              order_status DEFAULT 'pending',
  stripe_session_id   TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  subtotal_cents      INT NOT NULL,
  tax_cents           INT DEFAULT 0,
  shipping_cents      INT DEFAULT 0,
  discount_cents      INT DEFAULT 0,
  total_cents         INT NOT NULL,
  currency            CHAR(3) DEFAULT 'USD',
  shipping_address    JSONB,               -- {line1, city, state, zip, country}
  billing_address     JSONB,
  customer_email      TEXT NOT NULL,
  customer_name       TEXT,
  notes               TEXT,
  metadata            JSONB DEFAULT '{}',
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id              ON orders(user_id);
CREATE INDEX idx_orders_status               ON orders(status);
CREATE INDEX idx_orders_stripe_payment_intent ON orders(stripe_payment_intent_id);
CREATE INDEX idx_orders_created_at           ON orders(created_at DESC);

CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  variant_id  UUID REFERENCES variants(id),
  sku         TEXT,
  product_name TEXT NOT NULL,             -- snapshot
  variant_name TEXT,
  quantity    INT NOT NULL,
  unit_price_cents INT NOT NULL,
  total_cents INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================
-- WEBHOOK LOG (for idempotency)
-- ============================================================

CREATE TABLE stripe_webhook_events (
  id            TEXT PRIMARY KEY,          -- Stripe event ID (idempotency key)
  type          TEXT NOT NULL,
  processed_at  TIMESTAMPTZ DEFAULT NOW(),
  payload       JSONB,
  error         TEXT
);

-- ============================================================
-- TRIGGERS — auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_variants_updated_at BEFORE UPDATE ON variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_carts_updated_at    BEFORE UPDATE ON carts    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cart_items_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at   BEFORE UPDATE ON orders   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SEED: categories + sample products
-- ============================================================

INSERT INTO categories (slug, name, description) VALUES
  ('apparel',      'Apparel',      'Clothing and wearables'),
  ('accessories',  'Accessories',  'Bags, belts, and extras'),
  ('footwear',     'Footwear',     'Shoes and boots');

INSERT INTO products (slug, name, short_description, category_id, price_cents, compare_at_cents, is_featured, images) VALUES
  ('obsidian-hoodie', 'Obsidian Hoodie',
   'Heavyweight fleece, dropped shoulders, enzyme wash.',
   (SELECT id FROM categories WHERE slug='apparel'),
   9800, 12900, TRUE,
   '[{"url":"/images/obsidian-hoodie.jpg","alt":"Obsidian Hoodie"}]'),

  ('ash-cargo-pant', 'Ash Cargo Pant',
   'Six-pocket ripstop with adjustable hem.',
   (SELECT id FROM categories WHERE slug='apparel'),
   12500, NULL, TRUE,
   '[{"url":"/images/ash-cargo.jpg","alt":"Ash Cargo Pant"}]'),

  ('matte-tote', 'Matte Utility Tote',
   'Water-resistant 900D nylon, internal organiser.',
   (SELECT id FROM categories WHERE slug='accessories'),
   6500, NULL, FALSE,
   '[{"url":"/images/matte-tote.jpg","alt":"Matte Utility Tote"}]');
