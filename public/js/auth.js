export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function removeToken() {
  localStorage.removeItem("token");
}

export function isLoggedIn() {
  return getToken() !== null;
}

export function getUser() {
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

export function logout() {
  removeToken();
  window.location.href = "/index.html";
}

export function updateNavigation() {
  const loggedIn = isLoggedIn();
  const user = getUser();

  const loginLink = document.getElementById("nav-login");
  const registerLink = document.getElementById("nav-register");
  const createLink = document.getElementById("nav-create");
  const logoutBtn = document.getElementById("nav-logout");
  const userEmail = document.getElementById("nav-user-email");

  if (loginLink) loginLink.style.display = loggedIn ? "none" : "block";
  if (registerLink) registerLink.style.display = loggedIn ? "none" : "block";
  if (createLink) createLink.style.display = loggedIn ? "block" : "none";
  if (logoutBtn) {
    logoutBtn.style.display = loggedIn ? "block" : "none";
    logoutBtn.onclick = logout;
  }

  if (userEmail) {
    userEmail.style.display = loggedIn ? "block" : "none";
    if (loggedIn && user) {
      userEmail.textContent = user.email;
    }
  }
}

// Update navigation on load
document.addEventListener("DOMContentLoaded", updateNavigation);
