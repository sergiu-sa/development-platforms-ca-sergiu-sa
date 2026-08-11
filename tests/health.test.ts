/**
 * Health check tests.
 *
 * The endpoint's job is not "is Postgres up".
 * It is "can this deploymentactually serve /api/wire", and the gap between those two questions is three days of a dead homepage:
 * SELECT 1 passes against a database missing every
 * column the wire selects.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { get } from "./helpers/request.js";
import { createSchema, closeDatabase } from "./helpers/db.js";
import {
  LEGACY_STORIES,
  cloneTables,
  inThrowawaySchema,
} from "./helpers/schema-sandbox.js";
import { pool } from "../src/db/connection.js";
import { checkSchema } from "../src/db/schema-probe.js";
import { WIRE_PROBE } from "../src/modules/wire/wire.columns.js";
import { DESK_PROBE } from "../src/modules/desk/desk.columns.js";
import {
  BRIEFINGS_PROBE,
  BRIEFING_ITEMS_PROBE,
} from "../src/modules/briefings/briefings.columns.js";

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
  // The phase 1 failure, reproduced: the table exists and holds rows, the connection is fine, and the columns the wire selects are simply absent.
  it("names the missing column when the table predates the wire expansion", async () => {
    const check = await inThrowawaySchema("probe_legacy", async (client) => {
      await client.query(LEGACY_STORIES);
      return checkSchema(client, [WIRE_PROBE, DESK_PROBE]);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42703");
    expect(check.detail).toMatch(/column .* does not exist/);
  });

  // A Neon branch created but never given db/schema.sql.
  // This is the failure phase 5 newly makes possible, because it adds a database.
  it("reports a missing table when the schema was never applied at all", async () => {
    const check = await inThrowawaySchema("probe_empty", (client) =>
      checkSchema(client, [WIRE_PROBE, DESK_PROBE])
    );

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42P01");
    expect(check.detail).toMatch(/stories/);
  });

  // storeStories writes these two and the wire never selects them, so they are the columns most likely to be left out of a probe.
  // A database missing one serves every read and fails every refresh
  //  - and refreshIfNeeded swallows refresh failures, so nothing would say why the wire went quiet.
  it("covers the columns the wire writes but never reads", async () => {
    const check = await inThrowawaySchema("probe_write", async (client) => {
      await cloneTables(client, "stories");
      await client.query("ALTER TABLE stories DROP COLUMN fetched_at");
      return checkSchema(client, [WIRE_PROBE, DESK_PROBE]);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42703");
    expect(check.detail).toMatch(/fetched_at/);
  });

  // The reason the probe stopped being wire-only.
  // A deployment that never got phase 6's table serves a working homepage:
  // the deck deals, every decision repaints, and the writes fail into a sync that swallows failures by/ design.
  // Nothing on screen, nothing in the response, and
  //  - until this case existed -
  // "schema":"ok" from the endpoint whose whole job is to say otherwise.
  it("reports a missing saved_stories even when stories is perfect", async () => {
    const check = await inThrowawaySchema("probe_desk", async (client) => {
      await cloneTables(client, "stories");
      return checkSchema(client, [WIRE_PROBE, DESK_PROBE]);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42P01");
    expect(check.detail).toMatch(/saved_stories/);
  });

  // Phase 8's tables.
  // Both have been on the deployed databases since the Postgres migration, so nothing was missing when they gained endpoints
  //  - but nothing had ever asked, either, which is the same position phase 6 was in the day before it found out.
  it("reports a missing briefings table", async () => {
    const check = await inThrowawaySchema("probe_briefings", async (client) => {
      await cloneTables(client, "stories", "saved_stories");
      return checkSchema(client, [
        WIRE_PROBE,
        DESK_PROBE,
        BRIEFINGS_PROBE,
        BRIEFING_ITEMS_PROBE,
      ]);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42P01");
    expect(check.detail).toMatch(/briefings/);
  });

  it("reports a briefing_items that is the wrong shape", async () => {
    const check = await inThrowawaySchema("probe_items", async (client) => {
      await cloneTables(
        client,
        "stories",
        "saved_stories",
        "briefings",
        "briefing_items"
      );
      await client.query("ALTER TABLE briefing_items DROP COLUMN position");
      return checkSchema(client, [
        WIRE_PROBE,
        DESK_PROBE,
        BRIEFINGS_PROBE,
        BRIEFING_ITEMS_PROBE,
      ]);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42703");
    expect(check.detail).toMatch(/position/);
  });

  it("reports a saved_stories that is the wrong shape", async () => {
    const check = await inThrowawaySchema("probe_desk_thin", async (client) => {
      await cloneTables(client, "stories", "saved_stories");
      await client.query("ALTER TABLE saved_stories DROP COLUMN decided_at");
      return checkSchema(client, [WIRE_PROBE, DESK_PROBE]);
    });

    expect(check.ok).toBe(false);
    expect(check.code).toBe("42703");
    expect(check.detail).toMatch(/decided_at/);
  });
});
