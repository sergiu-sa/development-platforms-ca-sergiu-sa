/**
 * Thin wrapper over app.fetch() so tests read as HTTP calls rather than
 * Request construction. No server is started.
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

export async function get(path: string, token?: string): Promise<ApiResponse> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "GET",
      headers: buildHeaders(token),
    })
  );

  return toApiResponse(response);
}

export async function post(
  path: string,
  body: unknown,
  token?: string
): Promise<ApiResponse> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
    })
  );

  return toApiResponse(response);
}

/** Registers a user and returns their login token plus id. */
export async function registerAndLogin(
  email: string,
  password = "password123"
): Promise<{ token: string; userId: number }> {
  const registration = await post("/auth/register", { email, password });
  const login = await post("/auth/login", { email, password });

  return { token: login.body.token, userId: registration.body.user.id };
}
