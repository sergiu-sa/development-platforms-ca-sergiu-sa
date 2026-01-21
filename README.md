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
   PORT=3000
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_password_here
   DB_NAME=news_api
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

```md
src/
├── index.ts           # Main server file
├── config/env.ts      # Environment validation
├── db/connection.ts   # Database connection
├── routes/
│   ├── auth.ts        # Register & login
│   └── articles.ts    # Get & create articles
├── middleware/auth.ts # Checks if user is logged in
└── schemas/           # Validates incoming data
```

## License

Course assignment for Development Platforms module.
