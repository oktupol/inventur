import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const initialSchema: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

    // Master data: loaded by the administrator, only read by the application.
    await sql`CREATE SCHEMA IF NOT EXISTS master_data`.execute(db);
    await sql`
      CREATE TABLE master_data.article (
        id           BIGSERIAL     PRIMARY KEY,
        description  TEXT          NOT NULL,
        ean          TEXT          NULL,
        price_net    NUMERIC(12,2) NOT NULL,
        price_gross  NUMERIC(12,2) NOT NULL,
        category     TEXT          NULL
      )`.execute(db);
    await sql`
      CREATE TABLE master_data.article_number (
        article_id  BIGINT NOT NULL REFERENCES master_data.article(id) ON DELETE CASCADE,
        number      TEXT   NOT NULL,
        PRIMARY KEY (article_id, number)
      )`.execute(db);
    // Search indexes: prefix search on EAN and article number (case-insensitive
    // for article numbers), substring search on the description via trigrams.
    await sql`CREATE INDEX article_ean_idx ON master_data.article (ean text_pattern_ops)`.execute(
      db,
    );
    await sql`
      CREATE INDEX article_description_trgm_idx
        ON master_data.article USING gin (lower(description) gin_trgm_ops)`.execute(db);
    await sql`
      CREATE INDEX article_number_number_idx
        ON master_data.article_number (lower(number) text_pattern_ops)`.execute(db);

    // Inventory: owned by the application.
    await sql`CREATE SCHEMA IF NOT EXISTS inventory`.execute(db);
    await sql`
      CREATE TABLE inventory.stocktake (
        id           BIGSERIAL   PRIMARY KEY,
        name         TEXT        NOT NULL,
        status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
        started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at  TIMESTAMPTZ NULL,
        CHECK ((status = 'finished') = (finished_at IS NOT NULL))
      )`.execute(db);
    // At most one active stocktake.
    await sql`
      CREATE UNIQUE INDEX stocktake_single_active_idx
        ON inventory.stocktake ((true)) WHERE status = 'active'`.execute(db);

    await sql`
      CREATE TABLE inventory.work_area (
        id            BIGSERIAL   PRIMARY KEY,
        stocktake_id  BIGINT      NOT NULL REFERENCES inventory.stocktake(id) ON DELETE CASCADE,
        name          TEXT        NOT NULL,
        description   TEXT        NULL,
        status        TEXT        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'closed')),
        closed_at     TIMESTAMPTZ NULL,
        UNIQUE (stocktake_id, name)
      )`.execute(db);

    await sql`
      CREATE TABLE inventory.workstation (
        id            BIGSERIAL   PRIMARY KEY,
        name          TEXT        NOT NULL UNIQUE,
        token         TEXT        NOT NULL UNIQUE,
        work_area_id  BIGINT      NULL REFERENCES inventory.work_area(id) ON DELETE SET NULL,
        last_seen_at  TIMESTAMPTZ NULL
      )`.execute(db);

    await sql`
      CREATE TABLE inventory.employee (
        id              BIGSERIAL   PRIMARY KEY,
        stocktake_id    BIGINT      NOT NULL REFERENCES inventory.stocktake(id) ON DELETE CASCADE,
        name            TEXT        NOT NULL,
        workstation_id  BIGINT      NULL REFERENCES inventory.workstation(id) ON DELETE SET NULL,
        UNIQUE (stocktake_id, name)
      )`.execute(db);
    await sql`CREATE INDEX employee_workstation_idx ON inventory.employee (workstation_id)`.execute(
      db,
    );

    // article_id has no foreign key: master data may be replaced, while the
    // entry keeps its snapshot. A workstation that has created entries cannot
    // be deleted (ON DELETE RESTRICT).
    await sql`
      CREATE TABLE inventory.entry (
        id              BIGSERIAL     PRIMARY KEY,
        stocktake_id    BIGINT        NOT NULL REFERENCES inventory.stocktake(id) ON DELETE CASCADE,
        work_area_id    BIGINT        NOT NULL REFERENCES inventory.work_area(id),
        article_id      BIGINT        NULL,
        is_manual       BOOLEAN       NOT NULL,
        input           TEXT          NOT NULL,
        description     TEXT          NOT NULL,
        ean             TEXT          NULL,
        category        TEXT          NULL,
        price_net       NUMERIC(12,2) NULL,
        price_gross     NUMERIC(12,2) NOT NULL,
        serial_number   TEXT          NULL,
        quantity        INTEGER       NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        workstation_id  BIGINT        NOT NULL REFERENCES inventory.workstation(id) ON DELETE RESTRICT,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        deleted_at      TIMESTAMPTZ   NULL,
        CHECK (is_manual = (article_id IS NULL)),
        CHECK (NOT is_manual OR (category IS NULL AND price_net IS NULL))
      )`.execute(db);
    await sql`
      CREATE INDEX entry_work_area_idx ON inventory.entry (work_area_id, created_at)`.execute(db);
    await sql`
      CREATE INDEX entry_stocktake_article_idx
        ON inventory.entry (stocktake_id, article_id)`.execute(db);
    await sql`CREATE INDEX entry_workstation_idx ON inventory.entry (workstation_id)`.execute(db);

    // Employees assigned to the workstation when the entry was created. An
    // employee who has created entries cannot be deleted (ON DELETE RESTRICT).
    await sql`
      CREATE TABLE inventory.entry_employee (
        entry_id     BIGINT NOT NULL REFERENCES inventory.entry(id) ON DELETE CASCADE,
        employee_id  BIGINT NOT NULL REFERENCES inventory.employee(id) ON DELETE RESTRICT,
        PRIMARY KEY (entry_id, employee_id)
      )`.execute(db);
    await sql`
      CREATE INDEX entry_employee_employee_idx ON inventory.entry_employee (employee_id)`.execute(
      db,
    );

    await sql`
      CREATE TABLE inventory.checkpoint (
        id              BIGSERIAL   PRIMARY KEY,
        work_area_id    BIGINT      NOT NULL REFERENCES inventory.work_area(id) ON DELETE CASCADE,
        number          INTEGER     NOT NULL CHECK (number >= 1),
        workstation_id  BIGINT      NULL REFERENCES inventory.workstation(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (work_area_id, number)
      )`.execute(db);

    await sql`
      CREATE TABLE inventory.pairing (
        id              BIGSERIAL   PRIMARY KEY,
        workstation_id  BIGINT      NOT NULL REFERENCES inventory.workstation(id) ON DELETE CASCADE,
        one_time_code   TEXT        NOT NULL,
        qr_token        TEXT        NOT NULL UNIQUE,
        valid_until     TIMESTAMPTZ NOT NULL,
        device_token    TEXT        NULL UNIQUE,
        paired_at       TIMESTAMPTZ NULL
      )`.execute(db);
  },
};
