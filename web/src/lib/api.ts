// The server mounts everything it owns under /api, matching how Vercel serves
// the Hono app alongside these static files on the same origin.
const API_BASE = "/api";

/**
 * Validates a `?next=` value before it is used as a post-login redirect.
 *
 * Only a same-origin absolute path is safe. `//evil.com` is protocol-relative
 * and keeps the current scheme while switching host. `/\evil.com` reaches the
 * same result through a different door: several browsers fold a leading
 * backslash into a path/authority separator for special schemes (http/https),
 * so "/\" resolves the same way "//" does and "evil.com" is read as the host -
 * a naive `startsWith("/") && !startsWith("//")` check misses this entirely.
 * Rejecting a second "/" or "\" immediately after the first slash closes both
 * doors at once.
 *
 * A tab, newline or carriage return is rejected wherever it appears in the
 * string, not just at the ends: the URL Standard strips ASCII tab and newline
 * from anywhere in a URL before parsing it, so a value that looks like a safe
 * single-slash path here - e.g. "/\n/evil.com" - can still resolve to
 * "//evil.com" once the browser removes the embedded character during
 * navigation.
 *
 * `next` normally arrives already url-decoded, via `URLSearchParams.get()`, so
 * a percent-encoded attack (`%2f%2fevil.com`) is what this function actually
 * sees as `//evil.com` - already covered above. It is still safe if some
 * future caller passes the raw, undecoded value directly: that value doesn't
 * literally start with "/", so it falls through to the same-origin default
 * rather than being decoded (and potentially over-decoded) here.
 */
export function safeNext(next: string | null): string {
  if (!next) return "/";
  if (/[\t\n\r]/.test(next)) return "/";
  return /^\/[^/\\]/.test(next) ? next : "/";
}

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

  // Everything this tab remembers goes with the token, for exactly the reason
  // logout() clears it: this lands the reader on the sign-in form, and whoever
  // signs in there next has their session folded onto their desk. Without this
  // an expired token is the open door that logout closed - person A's reading
  // filed onto person B's account, and disclosed to them.
  try {
    sessionStorage.clear();
  } catch {
    /* nothing to protect if the store is unavailable */
  }

  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search
  );

  window.location.href = `/login.html?expired=1&next=${returnTo}`;
}

export interface ApiResult {
  /**
   * The HTTP status, or 0 when the request never got an answer.
   *
   * Most callers only care whether the body says success. The desk's
   * background sync needs more than that: it has to tell "the server refused
   * this" from "we could not reach the server", because the first must never
   * be retried and the second must be. A 404 retried forever would poison the
   * queue behind it.
   */
  status: number;
  body: any;
}

async function request(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
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
        status: response.status,
        body: {
          success: false,
          message: "Your session has expired. Please sign in again.",
        },
      };
    }

    // Must be awaited here, not returned as a pending promise. Without the
    // await, a non-JSON body (a 404 page, a proxy error, a gateway timeout)
    // rejects outside this try/catch and the caller never sees a result.
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return {
      status: 0,
      body: { success: false, message: "Network error. Please try again." },
    };
  }
}

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  return (await request(endpoint, options)).body;
}

export async function getWire({
  section,
  page,
}: { section?: string; page?: number } = {}) {
  const params = new URLSearchParams();
  if (section) params.set("section", section);
  if (page) params.set("page", String(page));

  const query = params.toString();
  return apiRequest(`/wire${query ? `?${query}` : ""}`);
}

/**
 * Everything the signed-in reader has decided, saved and skipped alike.
 *
 * `compact` because this builds a storyId-to-state map and never looks at a
 * story body. The full form carries one per decision, and the desk grows with
 * every card triaged rather than every card kept, so asking for it here would
 * make the homepage slower for exactly the readers who use the site most.
 */
export async function getDesk() {
  return apiRequest("/desk?view=compact");
}

export async function putDeskDecision(
  storyId: number,
  state: "saved" | "skipped"
): Promise<ApiResult> {
  return request(`/desk/${storyId}`, {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

export async function deleteDeskDecision(storyId: number): Promise<ApiResult> {
  return request(`/desk/${storyId}`, { method: "DELETE" });
}

/** Folds a signed-out session into the account, in one request. */
export async function mergeDesk(
  entries: { storyId: number; state: "saved" | "skipped" }[]
) {
  return apiRequest("/desk", {
    method: "PUT",
    body: JSON.stringify({ entries }),
  });
}

export async function login(email: string, password: string) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(
  email: string,
  username: string,
  password: string
) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
}
