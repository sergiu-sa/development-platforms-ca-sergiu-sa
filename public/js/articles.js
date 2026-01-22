import { getArticles } from "./api.js";
import { updateNavigation } from "./auth.js";

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getCategoryColor(category) {
  const colors = {
    Tech: "bg-blue-100 text-blue-800",
    Sports: "bg-green-100 text-green-800",
    Politics: "bg-red-100 text-red-800",
    Entertainment: "bg-purple-100 text-purple-800",
    Business: "bg-yellow-100 text-yellow-800",
    Other: "bg-gray-100 text-gray-800",
  };
  return colors[category] || colors.Other;
}

async function loadArticles() {
  const container = document.getElementById("articles-container");
  if (!container) return;

  const response = await getArticles();

  if (response.success) {
    if (response.articles.length === 0) {
      container.innerHTML = `
        <p class="text-gray-500 text-center py-8">No articles yet. Be the first to create one!</p>
      `;
      return;
    }

    container.innerHTML = response.articles
      .map(
        (article) => `
        <article class="card">
          <div class="flex justify-between items-start mb-3">
            <h2 class="text-xl font-semibold text-gray-800">${article.title}</h2>
            <span class="px-2 py-1 rounded text-xs font-medium ${getCategoryColor(article.category)}">
              ${article.category}
            </span>
          </div>
          <p class="text-gray-600 mb-4">
            ${article.body.length > 200 ? article.body.substring(0, 200) + "..." : article.body}
          </p>
          <div class="flex justify-between items-center text-sm text-gray-500">
            <span>By ${article.author_email || "Unknown"}</span>
            <span>${formatDate(article.created_at)}</span>
          </div>
        </article>
      `
      )
      .join("");
  } else {
    container.innerHTML = `
      <p class="error-message text-center py-8">Failed to load articles. Please try again later.</p>
    `;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateNavigation();
  loadArticles();
});
