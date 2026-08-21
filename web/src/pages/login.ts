import "../styles/app.css";
import { login, safeNext } from "../lib/api";
import { setToken, isLoggedIn, updateNavigation } from "../lib/auth";
import { migrateSessionToAccount } from "../wire/sync";

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

  // An expired session gets its own band rather than the error slot.
  //
  // It used to be shown as an error, which it is not: the reader typed nothing wrong, a token simply ran out.
  // The band says so in the machine's colour and leaves the error slot for what the server refuses, so the two cannot appear as one paragraph contradicting itself.
  if (params.get("expired") === "1") {
    const expired = document.getElementById("expired-notice");
    if (expired) expired.hidden = false;
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

      // Anything triaged while signed out belongs to the reader who just proved who they are, so it goes onto their desk before they land back on the wire.
      //
      // Bounded, because this sits in front of the redirect.
      // A cold function and a cold database can both be slow at once, and `fetch` has no timeout of its own, so an unbounded await leaves the button reading "Signing in..." for as long as the request takes;
      // while the token is already stored and the reader is, in fact, signed in.
      //
      // Giving up on the wait does not give up on the migration:
      // the pending flag is raised before the attempt and only lowered once the server confirms, so the homepage finishes the job on arrival.
      await Promise.race([
        migrateSessionToAccount(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);

      // Only a same-origin path is honoured, so ?next= cannot be used to bounce someone to another site after they sign in.
      window.location.href = safeNext(params.get("next"));
    } else {
      showError(response.message || "Login failed");
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
}

document.addEventListener("DOMContentLoaded", initLogin);
