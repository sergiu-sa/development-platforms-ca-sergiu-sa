function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token: string) {
  localStorage.setItem("token", token);
}

function removeToken() {
  localStorage.removeItem("token");
}

export function isLoggedIn() {
  return getToken() !== null;
}

/**
 * The signed-in curator's public name, or null.
 *
 * Read from the token's payload, which is decoded but **not verified** here - the browser has no secret to verify it with. So this may only ever decide what a page shows its own user, never what it is allowed to do.
 * Every real check happens on the server against the same token, verified.
 */
export function currentUsername(): string | null {
  return getUser()?.username ?? null;
}

function getUser() {
  const token = getToken();
  if (!token) return null;

  try {
    const payload = token.split(".")[1];
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function logout() {
  removeToken();

  // Everything this tab remembers about the reader goes with the token.
  // sessionStorage survives a same-tab navigation, so without this the deck would restore the previous reader's saved and skipped stories to whoever uses the browser next.
  //
  // Cleared wholesale rather than by key, for two reasons: `lib` must not import from `wire`, and anything a later phase decides to keep here is covered without anyone having to remember to add it.
  //
  // Deliberately NOT done on login.
  // Phase 6 migrates an anonymous session into the account on first sign-in, which is a designed feature rather than a leak - and clearing at logout is what stops that feature adopting somebody else's session.
  sessionStorage.clear();

  window.location.href = "/index.html";
}

export function updateNavigation() {
  const loggedIn = isLoggedIn();
  const user = getUser();

  const loginLink = document.getElementById("nav-login");
  const registerLink = document.getElementById("nav-register");
  const logoutBtn = document.getElementById("nav-logout");
  const userLabel = document.getElementById("nav-user");

  // Visibility is the `hidden` attribute rather than an inline style.
  // The markup has to declare a starting state, and a style="display:none" in HTML is parsed as an inline style;
  //  which style-src 'self' blocks, so every nav element would render at once before this ran.
  // `hidden` is honoured by the UA stylesheet and needs no CSP allowance.
  if (loginLink) loginLink.hidden = loggedIn;
  if (registerLink) registerLink.hidden = loggedIn;
  if (logoutBtn) {
    logoutBtn.hidden = !loggedIn;
    logoutBtn.onclick = logout;
  }

  if (userLabel) {
    // `getUser()` returns null on a payload that will not decode while `isLoggedIn()` is still true, because the token string exists.
    // Hiding on both leaves an empty anchor out of the tab order instead of in it.
    userLabel.hidden = !loggedIn || !user;
    // Fall back to the email for tokens issued before usernames existed.
    if (loggedIn && user) {
      userLabel.textContent = user.username || user.email;

      // Since phase 11 this label is the way to your own shelf.
      //
      // Only when there is a real username to link to: the fallback above can put an email on screen, and an email in an href would build an address for a curator who cannot exist.
      // Such a token keeps the label and loses the link, which is the right way round - the name still shows.
      if (userLabel instanceof HTMLAnchorElement) {
        if (user.username) {
          userLabel.href = `/u/${encodeURIComponent(user.username)}`;
        } else {
          userLabel.removeAttribute("href");
        }
      }
    }
  }
}

// Update navigation on load
document.addEventListener("DOMContentLoaded", updateNavigation);
