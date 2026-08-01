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
  window.location.href = "/index.html";
}

export function updateNavigation() {
  const loggedIn = isLoggedIn();
  const user = getUser();

  const loginLink = document.getElementById("nav-login");
  const registerLink = document.getElementById("nav-register");
  const logoutBtn = document.getElementById("nav-logout");
  const userLabel = document.getElementById("nav-user-email");

  // Visibility is the `hidden` attribute rather than an inline style. The
  // markup has to declare a starting state, and a style="display:none" in HTML
  // is parsed as an inline style - which style-src 'self' blocks, so every nav
  // element would render at once before this ran. `hidden` is honoured by the
  // UA stylesheet and needs no CSP allowance.
  if (loginLink) loginLink.hidden = loggedIn;
  if (registerLink) registerLink.hidden = loggedIn;
  if (logoutBtn) {
    logoutBtn.hidden = !loggedIn;
    logoutBtn.onclick = logout;
  }

  if (userLabel) {
    userLabel.hidden = !loggedIn;
    // Fall back to the email for tokens issued before usernames existed.
    if (loggedIn && user) {
      userLabel.textContent = user.username || user.email;
    }
  }
}

// Update navigation on load
document.addEventListener("DOMContentLoaded", updateNavigation);
