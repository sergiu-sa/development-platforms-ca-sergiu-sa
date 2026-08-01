import "../styles/app.css";
import { getWire } from "../lib/api";
import { updateNavigation } from "../lib/auth";
import { renderWire } from "../wire/render";

async function loadWire(): Promise<void> {
  const container = document.getElementById("wire-container");
  if (!container) return;

  const response = await getWire();
  renderWire(container, response, new Date());
}

function initWire(): void {
  updateNavigation();
  loadWire();
}

document.addEventListener("DOMContentLoaded", initWire);
