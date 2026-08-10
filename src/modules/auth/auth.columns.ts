/**
 * The columns registering and signing in depend on.
 *
 * Neither of these tables has ever been missing from a deployed database, so unlike the wire's list this one is not written from experience.
 * It is here so that the probe list in src/db/probes.ts can cover every table db/schema.sql creates, which is what lets the guard over that list have no exceptions;
 * and a guard with an exceptions list is one edit away from having one more.
 *
 * auth_attempts is the interesting one.
 * The rate limiter fails open on a database error by design, so a deployment missing this table logs in perfectly and silently enforces no limit at all.
 *
 * Runtime-import free, like the other column files.
 */

import type { TableProbe } from "../../db/schema-probe.js";

export const USERS_PROBE: TableProbe = {
  table: "users",
  columns: ["id", "email", "username", "password_hash", "created_at"],
};

export const AUTH_ATTEMPTS_PROBE: TableProbe = {
  table: "auth_attempts",
  columns: ["id", "scope", "identifier", "attempted_at"],
};
