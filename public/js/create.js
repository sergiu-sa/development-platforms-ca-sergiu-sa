import { createArticle } from "./api.js";
import { isLoggedIn, updateNavigation } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
  updateNavigation();

  // Redirect to login if not authenticated
  if (!isLoggedIn()) {
    window.location.href = "/login.html";
    return;
  }

  const form = document.getElementById("create-form");
  const errorMessage = document.getElementById("error-message");
  const successMessage = document.getElementById("success-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = document.getElementById("title").value;
    const body = document.getElementById("body").value;
    const category = document.getElementById("category").value;
    const submitBtn = form.querySelector('button[type="submit"]');

    // Clear previous messages
    errorMessage.textContent = "";
    errorMessage.classList.add("hidden");
    successMessage.textContent = "";
    successMessage.classList.add("hidden");

    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = "Publishing...";

    const response = await createArticle(title, body, category);

    if (response.success) {
      successMessage.textContent = "Article published! Redirecting...";
      successMessage.classList.remove("hidden");

      setTimeout(() => {
        window.location.href = "/index.html";
      }, 1500);
    } else {
      errorMessage.textContent = response.message || "Failed to create article";
      errorMessage.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Publish Article";
    }
  });
});
