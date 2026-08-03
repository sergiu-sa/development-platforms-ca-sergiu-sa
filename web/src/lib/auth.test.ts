// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setToken, updateNavigation } from "./auth";

/**
 * A token for alice@example.com / alice, signed with nothing in particular -
 * `getUser()` only base64-decodes the payload, it does not verify. The API is
 * the real authorization boundary.
 */
const token = (payload: Record<string, unknown>) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

function nav(): void {
  document.body.innerHTML = `
    <a id="nav-login" href="/login.html">Log in</a>
    <span id="nav-user" hidden></span>
    <button id="nav-logout" type="button" hidden>Log out</button>
  `;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  nav();
});

describe("updateNavigation", () => {
  it("shows the username, never the email, when one is present", () => {
    setToken(
      token({ userId: 1, email: "alice@example.com", username: "alice" })
    );
    updateNavigation();

    const label = document.getElementById("nav-user")!;
    expect(label.textContent).toBe("alice");
    expect(document.body.textContent).not.toContain("alice@example.com");
  });

  it("falls back to the email for a token issued before usernames existed", () => {
    setToken(token({ userId: 1, email: "alice@example.com" }));
    updateNavigation();

    expect(document.getElementById("nav-user")!.textContent).toBe(
      "alice@example.com"
    );
  });

  it("swaps the controls around when signed in", () => {
    setToken(token({ userId: 1, username: "alice" }));
    updateNavigation();

    expect(document.getElementById("nav-login")!.hidden).toBe(true);
    expect(document.getElementById("nav-logout")!.hidden).toBe(false);
  });

  it("survives a token that is not decodable", () => {
    setToken("not.a.jwt");
    expect(() => updateNavigation()).not.toThrow();
  });
});

describe("logout", () => {
  it("takes the reader's deck session with the token", () => {
    // sessionStorage survives a same-tab navigation, so without this the next
    // person to use the browser inherits the last reader's saved stories - and
    // phase 6 would then migrate them onto the wrong account.
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: {
        set href(url: string) {
          assign(url);
        },
      },
      writable: true,
      configurable: true,
    });

    setToken(token({ userId: 1, username: "alice" }));
    sessionStorage.setItem(
      "lede.deck.v1",
      '{"v":1,"decisions":{"7":"saved"},"dealt":12}'
    );
    updateNavigation();

    document.getElementById("nav-logout")!.click();

    expect(localStorage.getItem("token")).toBeNull();
    expect(sessionStorage.getItem("lede.deck.v1")).toBeNull();
    expect(assign).toHaveBeenCalledWith("/index.html");
  });
});
