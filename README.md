# News API

A REST API for a news platform built with Hono, TypeScript, and MySQL.

## Description

This project is a backend API that allows users to register, login, and manage news articles. It demonstrates fundamental concepts of building secure, authenticated APIs.

**Tech Stack:**

- **Framework:** Hono (TypeScript)
- **Database:** MySQL
- **Validation:** Zod
- **Authentication:** JWT (JSON Web Tokens)

Built for the **Development Platforms Course Assignment**.

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
├── db/connection.ts   # Database connection
├── routes/
│   ├── auth.ts        # Register & login
│   └── articles.ts    # Get & create articles
├── middleware/auth.ts # Checks if user is logged in
└── schemas/           # Validates incoming data
```

## License

Course assignment for Development Platforms module.
