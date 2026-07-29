import { register } from "./api";
import { isLoggedIn, updateNavigation } from "./auth";

export function initRegister() {
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

    // Clear previous messages
    errorMessage.textContent = "";
    errorMessage.classList.add("hidden");
    successMessage.textContent = "";
    successMessage.classList.add("hidden");

    // Validate passwords match
    if (password !== confirmPassword) {
      errorMessage.textContent = "Passwords do not match";
      errorMessage.classList.remove("hidden");
      return;
    }

    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account...";

    const response = await register(email, username, password);

    if (response.success) {
      successMessage.textContent = "Account created! Redirecting to login...";
      successMessage.classList.remove("hidden");

      setTimeout(() => {
        window.location.href = "/login.html";
      }, 1500);
    } else {
      errorMessage.textContent = response.message || "Registration failed";
      errorMessage.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Register";
    }
  });
}
