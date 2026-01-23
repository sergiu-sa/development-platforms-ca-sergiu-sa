# News API

A REST API for a news platform built with Hono, TypeScript, and MySQL.

## Description

This project is a backend API that allows users to register, login, and manage news articles. It demonstrates fundamental concepts of building secure, authenticated APIs.

**Tech Stack:**

- **Framework:** Hono (TypeScript)
- **Database:** MySQL
- **Validation:** Zod
- **Authentication:** JWT

### Built for Development Platforms Course

## Live Deployment

**Live API:** https://development-platforms-ca-sergiu-sa-production.up.railway.app

### Quick Test

- **Health Check:** [GET /health](https://development-platforms-ca-sergiu-sa-production.up.railway.app/health)
- **View Articles:** [GET /articles](https://development-platforms-ca-sergiu-sa-production.up.railway.app/articles)
- **Home Page:** [GET /](https://development-platforms-ca-sergiu-sa-production.up.railway.app/)

### Test the Full API

Use Thunder Client, Postman, or curl to test all endpoints:

```bash
# Register a new user
curl -X POST https://development-platforms-ca-sergiu-sa-production.up.railway.app/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Login and get token
curl -X POST https://development-platforms-ca-sergiu-sa-production.up.railway.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Create an article (use the token from login)
curl -X POST https://development-platforms-ca-sergiu-sa-production.up.railway.app/articles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"title":"Test Article","body":"Article content here","category":"Tech"}'
```

---

## Deployment Details

- **Platform:** Railway
- **Database:** MySQL (managed by Railway)
- **Region:** US-West
- **Status:** Active

---

## Setup

### You'll Need

- Node.js
- MySQL installed and running
- MySQL Workbench

### Steps

1. **Clone and install**

   ```bash
   git clone <https://github.com/sergiu-sa/development-platforms-ca-sergiu-sa.git>
   cd development-platforms-ca-sergiu-sa
   npm install
   ```

2. **Set up your environment file**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and fill in your MySQL password:

   ```env
   MYSQLHOST=localhost
   MYSQLPORT=3306
   MYSQLUSER=root
   MYSQLPASSWORD=your_password_here
   MYSQLDATABASE=news_api
   PORT=3000
   JWT_SECRET=make_this_a_long_random_string
   ```

3. **Create the database**
   - Open MySQL Workbench
   - Run the `database-schema.sql` file (it creates everything for you)

4. **Start the server**

   ```bash
   npm run dev
   ```

5. **Check it works**

   Go to `http://localhost:3000/` - you should see the home page with articles!

## API Endpoints

### Anyone Can Use These

**GET /** - Home page (frontend)

**GET /health** - Check if database is connected

**POST /auth/register** - Create a new account

```json
{ "email": "you@example.com", "password": "password123" }
```

**POST /auth/login** - Login and get a token

```json
{ "email": "you@example.com", "password": "password123" }
```

**GET /articles** - See all articles

### Need To Be Logged In

**POST /articles** - Create a new article

```json
{
  "title": "My Article",
  "body": "Article content goes here...",
  "category": "Tech"
}
```

Categories: Tech, Sports, Politics, Entertainment, Business, Other

Don't forget to add the token in the header:

```env
Authorization: Bearer your_token_here
```

## Database

Two tables:

**users** - id, email, password_hash, created_at

**articles** - id, title, body, category, submitted_by, created_at

Articles link to users through `submitted_by` (which user wrote it).

## Testing

Use Thunder Client (VS Code extension) or Postman:

1. Register a user
2. Login (save the token you get back)
3. Try getting articles (works without token)
4. Try creating an article (needs token in header)

## Project Structure

```txt
├── database-schema.sql          # Database setup script (run this first)
├── database-export.sql          # Full database export for grading
├── package.json
├── tsconfig.json
│
├── src/                         # Backend (TypeScript)
│   ├── index.ts                 # Server entry point
│   ├── config/
│   │   └── env.ts               # Environment validation
│   ├── db/
│   │   └── connection.ts        # MySQL connection pool
│   ├── middleware/
│   │   └── auth.ts              # JWT authentication
│   └── modules/
│       ├── auth/
│       │   ├── auth.route.ts    # Login & register endpoints
│       │   └── auth.schema.ts   # Validation schemas
│       └── articles/
│           ├── articles.route.ts
│           └── articles.schema.ts
│
└── public/                      # Frontend (served as static files)
    ├── index.html               # Home page - article list
    ├── login.html               # Login form
    ├── register.html            # Registration form
    ├── create.html              # Create article (auth required)
    ├── css/
    │   └── styles.css
    └── js/
        ├── api.js               # API request helper
        ├── auth.js              # Token management
        ├── articles.js          # Article display
        ├── login.js             # Login form handler
        ├── register.js          # Register form handler
        └── create.js            # Create article handler
```

## Motivation

I chose Option 1 because I wanted to properly understand how a backend works instead of using a service like Supabase. I already had some experience working with APIs from the frontend, but the internal flow of authentication, database access, and request handling was still unclear to me. This assignment felt like a good opportunity for me to get a better grasp of what actually happens on the server side.

Working with a relational database was also valuable. Designing the schema, setting up foreign key relationships, and using SQL JOINs to link articles with their authors helped me better understand how backend data is structured and queried in real applications. Using MySQL Workbench made this easier to reason about and gave me a clearer overview of how everything fits together.

The most challenging part of the project was deployment. Deploying a backend-only API to Railway was something I had never done before and involved a lot of trial and error. Handling environment variables, configuring the database connection, and debugging token-related issues in production took significant time. After successfully deploying the backend API, I later added a frontend as an extra step.

For testing, I chose Thunder Client instead of Postman. The tools are very similar, but I wanted to try something different and keep everything inside VS Code. This did not affect the project technically, but it helped me get comfortable using alternative tools for the same tasks.

Although a frontend was not required, I added a simple one to visualise the API and prepare the project for my portfolio. Comparing this approach to using Supabase, building a custom API gave me more control and a clearer understanding of how authentication, data access, and deployment work.

## License

Course assignment for Development Platforms module.
