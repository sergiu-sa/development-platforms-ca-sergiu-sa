/**
 * Whether a given database needs an encrypted connection.
 *
 * Split out from connection.ts so it can be reused without that module's side
 * effect of building a pool from .env. scripts/apply-schema.ts connects to a
 * database chosen on the command line and needs the same decision.
 */

import type pg from "pg";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Local Postgres runs unencrypted; hosted Postgres (Neon) requires encryption.
 *
 * Reads the host out of the address rather than searching the whole string, so
 * a password containing "@" or the word "localhost" cannot flip the decision.
 * An address it cannot parse falls back to requiring encryption, so a typo
 * fails safe rather than sending a password in the clear.
 */
export function sslForConnection(url: string): pg.PoolConfig["ssl"] {
  try {
    const { hostname } = new URL(url);
    return LOCAL_HOSTS.includes(hostname)
      ? false
      : { rejectUnauthorized: true };
  } catch {
    return { rejectUnauthorized: true };
  }
}
