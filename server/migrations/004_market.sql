-- backpack_ragnarok -- server/migrations/004_market.sql
-- REQ-0064: schema for the Market (player-to-player barter in lrdst).
-- Mirrors 002_schedule.sql/003_gacha.sql's conventions exactly: one
-- jsonb `doc` column per table holding the entire document verbatim
-- ("id + doc in, id + doc out"), plus the columns the hot-path queries
-- need as real indexed columns.
--
-- Three tables (see server/storage.cjs's market roots):
--   market_listings(listing_id, seller_id, state, doc, created_at)
--     -- one row per listing. seller_id and state are real columns
--     (browse = WHERE state, mine = WHERE seller_id) even though the
--     files backend filters in-service today -- cheap now, saves a
--     migration the moment listing volume warrants pushing the filter
--     into SQL.
--   market_furnace(entry_id, doc, burned_at)
--     -- APPEND-ONLY burn ledger, one row per settlement (law 2: the
--     furnace burns only when a trade settles). Never updated, never
--     deleted; burned_at is a real column for REQ-0066's seasonal
--     windowing (WHERE burned_at >= season start).
--   market_dex_history(item_id, doc)
--     -- rolling last-5 settled prices per content item id (the Dex
--     price anchor; full REQ-0052 dex-card integration reads this same
--     root later).
--
-- Apply as the postgres superuser (same invocation as 001..003):
--   docker exec -i supabase-db psql -U postgres < server/migrations/004_market.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS market_listings (
  listing_id text PRIMARY KEY,
  seller_id  text NOT NULL,
  state      text NOT NULL,
  doc        jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_listings_seller_id_idx ON market_listings (seller_id);
CREATE INDEX IF NOT EXISTS market_listings_state_idx ON market_listings (state);

CREATE TABLE IF NOT EXISTS market_furnace (
  entry_id   text PRIMARY KEY,
  doc        jsonb NOT NULL,
  burned_at  timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_furnace_burned_at_idx ON market_furnace (burned_at);

CREATE TABLE IF NOT EXISTS market_dex_history (
  item_id    text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON market_listings TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_furnace TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_dex_history TO backpack;
-- No sequences to grant (all PKs are caller-supplied text ids).
