import "../styles/app.css";
import { login, safeNext } from "../lib/api";
import { setToken, isLoggedIn, updateNavigation } from "../lib/auth";

function initLogin(): void {
  updateNavigation();

  if (isLoggedIn()) {
    window.location.href = "/index.html";
    return;
  }

  const form = document.getElementById("login-form") as HTMLFormElement;
  const errorMessage = document.getElementById("error-message") as HTMLElement;

  // api.ts redirects here with ?expired=1 when a token stops being accepted.
  // Saying so beats dumping the user on a bare login form with no explanation.
  const params = new URLSearchParams(window.location.search);

  function showError(message: string): void {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
  }

  function clearError(): void {
    errorMessage.textContent = "";
    errorMessage.classList.add("hidden");
  }

  if (params.get("expired") === "1") {
    showError("Your session has expired. Please sign in again.");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement)
      .value;
    const submitBtn = form.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;

    clearError();
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    const response = await login(email, password);

    if (response.success) {
      setToken(response.token);
      // Only a same-origin path is honoured, so ?next= cannot be used to
      // bounce someone to another site after they sign in.
      window.location.href = safeNext(params.get("next"));
    } else {
      showError(response.message || "Login failed");
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
}

document.addEventListener("DOMContentLoaded", initLogin);
