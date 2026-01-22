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
- **API Info:** [GET /](https://development-platforms-ca-sergiu-sa-production.up.railway.app/)

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
   git clone <your-repo-url>
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
   - Run the `database.sql` file (it creates everything for you)

4. **Start the server**

   ```bash
   npm run dev
   ```

5. **Check it works**

   Go to `http://localhost:3000/` - you should see a welcome message!

## API Endpoints

### Anyone Can Use These

**GET /** - Welcome message

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
src/
├── index.ts
├── config/
│   └── env.ts
├── db/
│   └── connection.ts
├── middleware/
│   └── auth.ts
└── modules/
    ├── auth/
    │   ├── auth.route.ts
    │   └── auth.schema.ts
    └── articles/
        ├── articles.route.ts
        └── articles.schema.ts
```

## Motivation

I chose Option 1 because I wanted to properly understand how a backend works instead of relying on a managed service like Supabase. I already had some experience consuming APIs from the frontend, but the internal flow of authentication, database access, and request handling was still unclear to me. This assignment felt like the right opportunity to close that gap.

I also found working with a relational database valuable. Designing the schema, setting up foreign key relationships, and using SQL JOINs to link articles with their authors gave me a clearer understanding of how backend data is structured and queried in real applications. Using MySQL Workbench made this process more visual and easier to reason about.

The most challenging part of the project was deployment. Deploying only a backend API to Railway was something I had never done before, and it involved a lot of trial and error. Handling environment variables, configuring the database connection, and debugging token-related issues in production took significant time. In the end, this turned out to be one of the most useful parts of the project, because it forced me to understand how an application behaves outside of a local setup.

For testing, I chose Thunder Client instead of Postman. The functionality is similar, but I wanted to try a different tool and keep everything inside VS Code. This did not change the project technically, but it helped me get comfortable using alternative tools for the same workflow.

Although a frontend was not required for this assignment, I later added a simple frontend on a separate branch to visualize the API and prepare the project for my portfolio. I intentionally deployed only the API (main branch) to Railway, since my goal was to learn how to deploy and run a standalone backend service rather than deploying the frontend to Netlify.

Comparing this approach to using Supabase, the main advantage of building a custom API is control and understanding. It took more time, but it gave me a much clearer mental model of how authentication, data access, and deployment actually work. Supabase would have been faster, but for a course focused on development platforms and learning outcomes, building the backend myself was the better choice.

## License

Course assignment for Development Platforms module.
