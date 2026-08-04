/**
 * Tests for the schema-applying script's two dangerous decisions: which
 * database it picks, and what it prints about it.
 *
 * No database is touched here. These are the pure parts, and they are the
 * parts where being wrong is expensive - picking the wrong target defeats the
 * whole point of the script, and printing an unredacted address leaks a
 * production password into a terminal or a CI log.
 */

import { describe, it, expect } from "vitest";
import { resolveTarget, redactUrl } from "../scripts/apply-schema.js";

const NEON =
  "postgresql://owner:s3cr3t@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("resolveTarget", () => {
  it("takes an address given directly", () => {
    const target = resolveTarget(["--url", NEON]);

    expect(target.url).toBe(NEON);
    expect(target.source).toBe("--url");
  });

  it("reads DATABASE_URL out of a named env file", () => {
    const target = resolveTarget(
      [".env.preview"],
      () => `DATABASE_URL=${NEON}`
    );

    expect(target.url).toBe(NEON);
    expect(target.source).toBe(".env.preview");
  });

  // The whole reason the script exists. A default would send a mistyped
  // command at the local database while reporting success, which is
  // indistinguishable from having migrated Neon.
  it("refuses to guess a target when given nothing", () => {
    expect(() => resolveTarget([])).toThrow(/No target database/);
  });

  it("refuses when --url is given with no address", () => {
    expect(() => resolveTarget(["--url"])).toThrow(/no address/);
  });

  it("refuses an env file that does not set DATABASE_URL", () => {
    expect(() => resolveTarget([".env.empty"], () => "JWT_SECRET=abc")).toThrow(
      /does not set DATABASE_URL/
    );
  });
});

describe("redactUrl", () => {
  it("removes the password but keeps what identifies the database", () => {
    const printed = redactUrl(NEON);

    expect(printed).not.toContain("s3cr3t");
    expect(printed).toContain("ep-x-pooler.eu-central-1.aws.neon.tech");
    expect(printed).toContain("neondb");
    expect(printed).toContain("owner");
  });

  // pg accepts a password in the query string, where the URL parser reports
  // no password at all. Redacting only the userinfo would print this one in
  // full - which is exactly the accident this function exists to prevent.
  it("removes a password passed in the query string", () => {
    const printed = redactUrl(
      "postgresql://owner@ep-x-pooler.aws.neon.tech/neondb?password=s3cr3t&sslmode=require"
    );

    expect(printed).not.toContain("s3cr3t");
    expect(printed).toContain("sslmode=require");
    expect(printed).toContain("neondb");
  });

  it("handles an address with no password", () => {
    const printed = redactUrl("postgresql://localhost:5432/news_api");

    expect(printed).toContain("localhost");
    expect(printed).toContain("news_api");
  });

  // Fails closed: an address it cannot read must not be echoed back on the
  // chance that it is a malformed string with a real password inside it.
  it("prints nothing back when the address cannot be read", () => {
    const printed = redactUrl("this is not a url with hunter2 inside");

    expect(printed).toBe("(unreadable database address)");
  });
});
