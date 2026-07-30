import "../styles/app.css";
import { register } from "../lib/api";
import { isLoggedIn, updateNavigation } from "../lib/auth";

function initRegister(): void {
  updateNavigation();

  if (isLoggedIn()) {
    window.location.href = "/index.html";
    return;
  }

  const form = document.getElementById("register-form") as HTMLFormElement;
  const errorMessage = document.getElementById("error-message") as HTMLElement;
  const successMessage = document.getElementById(
    "success-message"
  ) as HTMLElement;

  function showError(message: string): void {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
  }

  function clearMessages(): void {
    errorMessage.textContent = "";
    errorMessage.classList.add("hidden");
    successMessage.textContent = "";
    successMessage.classList.add("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (document.getElementById("email") as HTMLInputElement).value;
    const username = (document.getElementById("username") as HTMLInputElement)
      .value;
    const password = (document.getElementById("password") as HTMLInputElement)
      .value;
    const confirmPassword = (
      document.getElementById("confirm-password") as HTMLInputElement
    ).value;
    const submitBtn = form.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;

    clearMessages();

    if (password !== confirmPassword) {
      showError("Passwords do not match");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";

    const response = await register(email, username, password);

    if (response.success) {
      successMessage.textContent = "Account created. Redirecting to login…";
      successMessage.classList.remove("hidden");

      setTimeout(() => {
        window.location.href = "/login.html";
      }, 1200);
    } else {
      showError(response.message || "Registration failed");
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    }
  });
}

document.addEventListener("DOMContentLoaded", initRegister);
