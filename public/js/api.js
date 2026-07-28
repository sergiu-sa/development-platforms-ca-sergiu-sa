// The server mounts everything it owns under /api, matching how Vercel serves
// the Hono app alongside these static files on the same origin.
const API_BASE = "/api";

async function apiRequest(endpoint, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    // Must be awaited here, not returned as a pending promise. Without the
    // await, a non-JSON body (a 404 page, a proxy error, a gateway timeout)
    // rejects outside this try/catch and the caller never sees a result.
    return await response.json();
  } catch (error) {
    return { success: false, message: "Network error. Please try again." };
  }
}

export async function getWire({ section, page } = {}) {
  const params = new URLSearchParams();
  if (section) params.set("section", section);
  if (page) params.set("page", String(page));

  const query = params.toString();
  return apiRequest(`/wire${query ? `?${query}` : ""}`);
}

// Orphaned along with create.html, which the frontend rebuild replaces
// wholesale. Kept only so create.js still resolves its import.
export async function createArticle(title, body, category) {
  return apiRequest("/articles", {
    method: "POST",
    body: JSON.stringify({ title, body, category }),
  });
}

export async function login(email, password) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email, username, password) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
}

export { apiRequest, API_BASE };
