// The server mounts everything it owns under /api, matching how Vercel serves
// the Hono app alongside these static files on the same origin.
const API_BASE = "/api";

/**
 * Sends the user to login after their session has stopped being valid.
 *
 * Tokens last 7 days and nothing refreshes them, so expiry is a routine event
 * rather than an edge case. Without this the page just silently stops working:
 * requests 401, callers see a generic failure, and the nav still claims the
 * user is signed in. Clearing the token first is what makes updateNavigation()
 * tell the truth on the next page.
 */
function handleExpiredSession() {
  localStorage.removeItem("token");

  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search
  );

  window.location.href = `/login.html?expired=1&next=${returnTo}`;
}

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

    // A 401 while carrying a token means the token was rejected - expired,
    // revoked or malformed. The /auth/ routes are excluded because there a 401
    // means "wrong password", which must show an inline error rather than
    // bounce the user somewhere.
    if (response.status === 401 && token && !endpoint.startsWith("/auth/")) {
      handleExpiredSession();
      return {
        success: false,
        message: "Your session has expired. Please sign in again.",
      };
    }

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
