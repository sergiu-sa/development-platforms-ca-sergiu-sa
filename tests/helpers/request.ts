/**
 * Thin wrapper over app.fetch() so tests read as HTTP calls rather than Request construction.
 * No server is started.
 */

import { app } from "../../src/app.js";

export interface ApiResponse<T = Record<string, any>> {
  status: number;
  body: T;
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function toApiResponse(response: Response): Promise<ApiResponse> {
  const text = await response.text();

  // Non-JSON bodies (static files, empty responses) should not blow up a test.
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { raw: text } };
  }
}

/**
 * A route that answers with a document rather than JSON.
 *
 * `get` would fold an HTML body into `{ raw }` and throw the headers away, which is no use to a page whose whole job is its content type and its meta tags.
 * Headers are passed through rather than built, because the one thing worth varying here is the forwarded host.
 */
export async function getDocument(
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; html: string; contentType: string | null }> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, { method: "GET", headers })
  );

  return {
    status: response.status,
    html: await response.text(),
    contentType: response.headers.get("content-type"),
  };
}

export async function get(path: string, token?: string): Promise<ApiResponse> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "GET",
      headers: buildHeaders(token),
    })
  );

  return toApiResponse(response);
}

/**
 * The three body-carrying verbs differ by one string, so they are made rather than written out.
 *  The fourth is a line.
 */
function sendsJson(method: "POST" | "PUT" | "PATCH") {
  return async function send(
    path: string,
    body: unknown,
    token?: string
  ): Promise<ApiResponse> {
    const response = await app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers: buildHeaders(token),
        body: JSON.stringify(body),
      })
    );

    return toApiResponse(response);
  };
}

export const post = sendsJson("POST");
export const put = sendsJson("PUT");
export const patch = sendsJson("PATCH");

/**
 * HEAD, which carries no body by definition.
 *
 * Worth having: Hono re-dispatches HEAD through the GET handler chain, so a route can answer GET correctly and HEAD wrongly, and nothing else in the suite would notice.
 */
export async function head(path: string, token?: string): Promise<ApiResponse> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "HEAD",
      headers: buildHeaders(token),
    })
  );

  return toApiResponse(response);
}

/** `delete` is a reserved word, hence the shortened name. */
export async function del(path: string, token?: string): Promise<ApiResponse> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "DELETE",
      headers: buildHeaders(token),
    })
  );

  return toApiResponse(response);
}

/** Registers a user and returns their login token plus id. */
export async function registerAndLogin(
  email: string,
  username = email.split("@")[0],
  password = "password123"
): Promise<{ token: string; userId: number; username: string }> {
  const registration = await post("/api/auth/register", {
    email,
    username,
    password,
  });
  const login = await post("/api/auth/login", { email, password });

  return {
    token: login.body.token,
    userId: registration.body.user.id,
    username,
  };
}
