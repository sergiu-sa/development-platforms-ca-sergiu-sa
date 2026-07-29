import { login } from "./api";
import { setToken, isLoggedIn, updateNavigation } from "./auth";

export function initLogin() {
  updateNavigation();

  if (isLoggedIn()) {
    window.location.href = "/index.html";
    return;
  }

  const form = document.getElementById("login-form") as HTMLFormElement;
  const errorMessage = document.getElementById("error-message") as HTMLElement;
  const successMessage = document.getElementById(
    "success-message"
  ) as HTMLElement;

  // api.js redirects here with ?expired=1 when a token stops being accepted.
  // Saying so beats dumping the user on a bare login form with no explanation.
  const params = new URLSearchParams(window.location.search);

  if (params.get("expired") === "1") {
    errorMessage.textContent =
      "Your session has expired. Please sign in again.";
    errorMessage.classList.remove("hidden");
  }

  // Only same-origin paths are honoured, so ?next= cannot be used to bounce
  // someone to another site after they sign in.
  function destinationAfterLogin() {
    const next = params.get("next");
    return next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/index.html";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement)
      .value;
    const submitBtn = form.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;

    // Clear previous messages
    errorMessage.textContent = "";
    errorMessage.classList.add("hidden");
    successMessage.textContent = "";
    successMessage.classList.add("hidden");

    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";

    const response = await login(email, password);

    if (response.success) {
      setToken(response.token);
      successMessage.textContent = "Login successful! Redirecting...";
      successMessage.classList.remove("hidden");

      setTimeout(() => {
        window.location.href = destinationAfterLogin();
      }, 1000);
    } else {
      errorMessage.textContent = response.message || "Login failed";
      errorMessage.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Login";
    }
  });
}
