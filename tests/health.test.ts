/**
 * Health check tests.
 *
 * The endpoint's job is not "is Postgres up". It is "can this deployment
 * actually serve /api/wire", and the gap between those two questions is three
 * days of a dead homepage: SELECT 1 passes against a database missing every
 * column the wire selects.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { get } from "./helpers/request.js";
import { createSchema, closeDatabase } from "./helpers/db.js";
import { LEGACY_STORIES, inThrowawaySchema } from "./helpers/schema-sandbox.js";
import { pool } from "../src/db/connection.js";
import { checkWireSchema } from "../src/modules/wire/wire.columns.js";

beforeAll(createSchema);
afterAll(closeDatabase);

describe("GET /api/health", () => {
  it("reports healthy when the database has every column the wire needs", async () => {
    const response = await get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("healthy");
    expect(response.body.database).toBe("connected");
    expect(response.body.schema).toBe("ok");
    expect(typeof response.body.timestamp).toBe("string");
  });
});

describe("the wire schema probe", () => {
  it("passes against a database built from db/schema.sql", async () => {
    const check = await checkWireSchema(pool);

    expect(check.ok).toBe(true);
    expect(check.detail).toBeUndefined();
  });

  // The phase 1 failure, reproduced: the table exists and holds rows, the
  // connection is fine, and the columns the wire selects are simply absent.
  it("names the missing column when the table predates the wire expansion", async () => {
    const check = await inThrowawaySchema("probe_legacy", async (client) => {
      await client.query(LEGACY_STORIES);
      return checkWireSchema(client);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42703");
    expect(check.detail).toMatch(/column .* does not exist/);
  });

  // A Neon branch created but never given db/schema.sql. This is the failure
  // phase 5 newly makes possible, because it adds a database.
  it("reports a missing table when the schema was never applied at all", async () => {
    const check = await inThrowawaySchema("probe_empty", (client) =>
      checkWireSchema(client)
    );

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42P01");
    expect(check.detail).toMatch(/stories/);
  });

  // storeStories writes these two and the wire never selects them, so they
  // are the columns most likely to be left out of a probe. A database missing
  // one serves every read and fails every refresh - and refreshIfNeeded
  // swallows refresh failures, so nothing would say why the wire went quiet.
  it("covers the columns the wire writes but never reads", async () => {
    const check = await inThrowawaySchema("probe_write", async (client) => {
      await client.query(
        "CREATE TABLE stories AS SELECT * FROM public.stories WHERE false"
      );
      await client.query("ALTER TABLE stories DROP COLUMN fetched_at");
      return checkWireSchema(client);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42703");
    expect(check.detail).toMatch(/fetched_at/);
  });
});
