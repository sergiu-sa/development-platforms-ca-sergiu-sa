# The database

`schema.sql` is the only description of the schema. There are no migration files. The whole file is applied at once, it is safe to run repeatedly, and `tests/schema-drift.test.ts` proves both of those claims on every CI run.

## Nothing applies this file for you

Vercel builds and ships code. It never touches Postgres. There is no migration runner, no release step and no check at startup, so a new column reaches a database only when a person puts it there.

This has already gone wrong once. Nine columns were added in phase 1, declared correctly, and green in CI. Nobody applied the file to the hosted database, so `/api/wire` returned a 500 for three days and the live homepage was dead.
Three things hid it: `/api/health` only ran `SELECT 1`, which passes with the columns missing; CI builds a database from scratch every run, so it always had them; and a failed wire refresh is swallowed by design, so the logs said nothing obvious.

## Where the schema has to land

Each database is applied to separately. The test database looks after itself; the other three are yours, so adding a column means doing this three times.

| Database   | Where it lives           | How it gets the schema                   |
| ---------- | ------------------------ | ---------------------------------------- |
| local      | Postgres on your machine | `npm run db:apply -- .env`               |
| test       | Postgres on your machine | automatic, `createSchema()` in every run |
| preview    | Neon branch `preview`    | `npm run db:apply -- .env.preview`       |
| production | Neon default branch      | `npm run db:apply -- .env.production`    |

Fetch the address of a hosted database from Vercel rather than copying it by hand, so a password never enters your shell history:

```bash
vercel env pull .env.preview --environment=preview
npm run db:apply -- .env.preview
```

`.env*` is gitignored. The script refuses to run without an explicit target: a default would let a mistyped command re-apply to your laptop while reporting success, which looks identical to having updated the remote database.

## Adding a column means writing it twice

`CREATE TABLE IF NOT EXISTS` leaves an existing table completely untouched, so a database that already holds rows is only ever reached by `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Put every new column in **both** the table definition and an `ALTER`.

CI always builds from scratch and so never exercises the `ALTER` path. A one-sided edit is therefore invisible until production.
`tests/schema-drift.test.ts` applies the real file into an empty schema and over a legacy-shaped table and asserts the two converge; it is what catches this.

## Checking that it worked

`GET /api/health` reads the schema, not just the connection. It runs the same probe the apply script does, selecting every column the wire depends on with `LIMIT 0`. No rows are read, but a missing column still raises an error.

That includes the columns the wire _writes_ but never shows you. A database missing one of those serves every page correctly and fails every refresh, and refresh failures are swallowed on purpose, so the only symptom would be a wire that quietly stopped updating.

```js
{"status":"healthy","database":"connected","schema":"ok"}
```

A `503` with `"schema":"stale"` names the column that is missing. Check it against every deployment after any change to this file.
