const API_BASE = "";

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

    return response.json();
  } catch (error) {
    return { success: false, message: "Network error. Please try again." };
  }
}

export async function getArticles() {
  return apiRequest("/articles");
}

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

export async function register(email, password) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export { apiRequest, API_BASE };
