/**
 * Every table this application needs a database to have.
 *
 * The list existed twice before this file did;
 * once in src/app.ts for /api/health and once in scripts/apply-schema.ts for the report it prints after applying the schema;
 * which is the same duplication that has already cost this project a three-day outage in a different pair of files.
 * A table added to one and forgotten in the other would leave the check that is supposed to catch a missing table unable to see it.
 *
 * Each module still owns the knowledge of which of its columns matter;
 * this only composes them. tests/schema-probes.test.ts asserts that every table db/schema.sql creates appears here, so the next table cannot be added' without a probe.
 *
 * Runtime-import free, like the column files it collects, so the apply script can read it while pointed at a different database.
 */

import type { TableProbe } from "./schema-probe.js";
import {
  AUTH_ATTEMPTS_PROBE,
  USERS_PROBE,
} from "../modules/auth/auth.columns.js";
import { WIRE_PROBE, WIRE_SYNC_PROBE } from "../modules/wire/wire.columns.js";
import { DESK_PROBE } from "../modules/desk/desk.columns.js";
import {
  BRIEFINGS_PROBE,
  BRIEFING_ITEMS_PROBE,
} from "../modules/briefings/briefings.columns.js";

export const SCHEMA_PROBES: readonly TableProbe[] = [
  USERS_PROBE,
  AUTH_ATTEMPTS_PROBE,
  WIRE_PROBE,
  WIRE_SYNC_PROBE,
  DESK_PROBE,
  BRIEFINGS_PROBE,
  BRIEFING_ITEMS_PROBE,
];
