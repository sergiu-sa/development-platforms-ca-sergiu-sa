# News API

A news platform built with Hono, TypeScript, and Postgres.

## Description

Originally a Development Platforms course assignment — a REST API with user
registration, login, and article submission. It is now being rebuilt as a
portfolio project: a live news wire that signed-in users curate into published
**briefings**.

**Tech Stack:**

- **Framework:** Hono (TypeScript)
- **Database:** Postgres
- **Validation:** Zod
- **Authentication:** JWT
- **Tests:** Vitest against a real database, with CI on GitHub Actions

> **Status: mid-rebuild.** The `articles` feature has been removed and the
> briefings feature is not built yet, so the homepage feed is empty by design.
> Registration, login, and the API all work. The graded course submission is
> preserved at tag `v1.0-course-submission`.
>
> Design: `docs/superpowers/specs/2026-07-27-briefings-concept-design.md`

## Live Deployment

None currently. The original Railway deployment has been shut down; Vercel with
Neon Postgres is the next step.

## Setup

### You'll Need

- Node.js 22
- Postgres 16

### Steps

1. **Clone and install**

   ```bash
   git clone https://github.com/sergiu-sa/development-platforms-ca-sergiu-sa.git
   cd development-platforms-ca-sergiu-sa
   npm install
   ```

2. **Install and start Postgres**

   ```bash
   brew install postgresql@16
   brew services start postgresql@16
   ```

   Homebrew creates a superuser named after your macOS account, not `postgres`.
   Check with `whoami`.

3. **Create the databases**

   ```bash
   createdb news_api
   createdb news_api_test
   psql news_api -f db/schema.sql
   ```

4. **Set up your environment files**

   ```bash
   cp .env.example .env
   cp .env.test.example .env.test
   ```

   Edit both so `DATABASE_URL` uses your username, and set a `JWT_SECRET`:

   ```env
   DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/news_api
   PORT=3000
   JWT_SECRET=make_this_a_long_random_string
   ```

   `.env.test` must point at a database whose name ends in `_test` — the suite
   truncates every table and refuses to run otherwise.

5. **Start the server**

   ```bash
   npm run dev
   ```

6. **Check it works**

   ```bash
   curl localhost:3000/health
   ```

   Expected: `{"status":"healthy","database":"connected",...}`

## Scripts

```bash
npm run dev          # watch mode
npm run build        # compile to dist/
npm start            # run the build
npm test             # run the test suite
npm run test:watch   # tests in watch mode
npm run typecheck    # typecheck src and tests
npm run format       # apply Prettier
npm run format:check # verify formatting
```

## API Endpoints

### Anyone Can Use These

**GET /** - Home page (frontend)

**GET /health** - Check if database is connected

**POST /auth/register** - Create a new account

```json
{
  "email": "you@example.com",
  "username": "your_name",
  "password": "password123"
}
```

`username` is your public display name — 3-30 characters, letters, numbers,
hyphens and underscores. It is what appears on bylines, so email addresses are
never exposed publicly. Both email and username are unique case-insensitively.

**POST /auth/login** - Login and get a token

```json
{ "email": "you@example.com", "password": "password123" }
```

Returns a JWT valid for 7 days. Send it on protected routes as:

```env
Authorization: Bearer your_token_here
```

### Not Built Yet

The briefings endpoints (`/wire`, `/briefings`, `/curators/:username`) are
specified but not implemented. See the design spec.

## Database

Four tables, defined in `db/schema.sql`:

| Table            | Purpose                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `users`          | id, email, username, password_hash, created_at                                                         |
| `stories`        | cached wire items — external_id, title, summary, url, section, thumbnail_url, published_at, fetched_at |
| `briefings`      | id, author_id, title, intro, slug, status, published_at, timestamps                                    |
| `briefing_items` | id, briefing_id, story_id, note, position                                                              |

`stories`, `briefings` and `briefing_items` exist but have no endpoints yet.

Three constraints carry guarantees, each covered by tests in
`tests/schema.test.ts`:

- `briefing_items.story_id` is `ON DELETE RESTRICT`, so a story referenced by a
  briefing can never be pruned from the cache
- `UNIQUE (briefing_id, position)` is `DEFERRABLE`, so items can be reordered
  inside a transaction
- `LOWER()` unique indexes on `users.email` and `users.username` — Postgres
  compares case-sensitively, unlike the MySQL collation this replaced

`database-schema.sql` and `database-export.sql` are MySQL artefacts retained
from the course submission. They are no longer used.

## Testing

```bash
npm test
```

Tests run against a real Postgres database rather than mocks, driving the app
through `app.fetch()` so no server is started. They require `.env.test` to point
at a database whose name ends in `_test`; the suite refuses to run otherwise,
which is what stops a missing config from wiping your development data.

## Project Structure

```txt
├── db/
│   ├── schema.sql               # Postgres schema - single source of truth
│   └── migrations/              # Historical MySQL migrations
├── database-schema.sql          # Retained MySQL artefact from the course
├── database-export.sql          # Retained MySQL export for grading
├── package.json
├── tsconfig.json                # Build config (src only)
├── tsconfig.check.json          # Typecheck config (src + tests)
├── vitest.config.ts
│
├── src/                         # Backend (TypeScript)
│   ├── app.ts                   # Builds the Hono app, does not listen
│   ├── index.ts                 # Validates env, starts the server
│   ├── config/
│   │   └── env.ts               # The only file that reads process.env
│   ├── db/
│   │   └── connection.ts        # Postgres connection pool
│   ├── middleware/
│   │   └── auth.ts              # JWT authentication
│   └── modules/
│       └── auth/
│           ├── auth.route.ts    # Login & register endpoints
│           └── auth.schema.ts   # Validation schemas
│
├── tests/
│   ├── auth.test.ts             # Registration, login, validation
│   ├── schema.test.ts           # Database constraint behaviour
│   └── helpers/
│       ├── db.ts                # Schema setup, reset, _test safety rail
│       └── request.ts           # Drives app.fetch() without a server
│
└── public/                      # Frontend (served as static files)
    ├── index.html               # Home page - feed pending rebuild
    ├── login.html               # Login form
    ├── register.html            # Registration form
    ├── create.html              # Legacy, pending rebuild
    ├── css/
    │   └── styles.css
    └── js/
        ├── api.js               # API request helper
        ├── auth.js              # Token management
        ├── articles.js          # Feed rendering
        ├── login.js             # Login form handler
        ├── register.js          # Register form handler
        └── create.js            # Legacy, pending rebuild
```

## Motivation

_Written for the original course submission, kept as a record of that stage._

I chose Option 1 because I wanted to properly understand how a backend works instead of using a service like Supabase. I already had some experience working with APIs from the frontend, but the internal flow of authentication, database access, and request handling was still unclear to me. This assignment felt like a good opportunity for me to get a better grasp of what actually happens on the server side.

Working with a relational database was also valuable. Designing the schema, setting up foreign key relationships, and using SQL JOINs to link articles with their authors helped me better understand how backend data is structured and queried in real applications. Using MySQL Workbench made this easier to reason about and gave me a clearer overview of how everything fits together.

The most challenging part of the project was deployment. Deploying a backend-only API to Railway was something I had never done before and involved a lot of trial and error. Handling environment variables, configuring the database connection, and debugging token-related issues in production took significant time. After successfully deploying the backend API, I later added a frontend as an extra step.

For testing, I chose Thunder Client instead of Postman. The tools are very similar, but I wanted to try something different and keep everything inside VS Code. This did not affect the project technically, but it helped me get comfortable using alternative tools for the same tasks.

Although a frontend was not required, I added a simple one to visualise the API and prepare the project for my portfolio. Comparing this approach to using Supabase, building a custom API gave me more control and a clearer understanding of how authentication, data access, and deployment work.

## License

Originally a course assignment for the Development Platforms module, now
continued as a personal project.
