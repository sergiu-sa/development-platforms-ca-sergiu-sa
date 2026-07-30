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

  if (loginLink) loginLink.style.display = loggedIn ? "none" : "block";
  if (registerLink) registerLink.style.display = loggedIn ? "none" : "block";
  if (logoutBtn) {
    logoutBtn.style.display = loggedIn ? "block" : "none";
    logoutBtn.onclick = logout;
  }

  if (userLabel) {
    userLabel.style.display = loggedIn ? "block" : "none";
    // Fall back to the email for tokens issued before usernames existed.
    if (loggedIn && user) {
      userLabel.textContent = user.username || user.email;
    }
  }
}

// Update navigation on load
document.addEventListener("DOMContentLoaded", updateNavigation);
