import "../styles/app.css";
import { getWire } from "../lib/api";
import { updateNavigation } from "../lib/auth";
import { renderWire } from "../wire/render";

// The clock rail scrubber: "now" at the top, then ticks back through the
// day, evenly spaced. It is decorative context alongside the real per-story
// <time> elements, not the only place a timestamp appears, so it is hidden
// from the accessibility tree rather than duplicating that information.
const RAIL_HOURS_AGO = [0, 1, 3, 6, 12];

function renderClockRail(rail: HTMLElement, now: Date): void {
  const steps = RAIL_HOURS_AGO.length - 1;

  rail.innerHTML = RAIL_HOURS_AGO.map((hoursAgo, i) => {
    const isNow = hoursAgo === 0;
    const tickTime = new Date(now.getTime() - hoursAgo * 3_600_000);
    const label = tickTime.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const top = (i / steps) * 100;
    const cls = isNow ? "wire-tick wire-tick-now" : "wire-tick";

    return `<div class="${cls}" style="top:${top}%">${label}${
      isNow ? "<br />now" : ""
    }</div>`;
  }).join("");
}

async function loadWire(): Promise<void> {
  const container = document.getElementById("wire-container");
  if (!container) return;

  const now = new Date();

  const rail = document.getElementById("wire-rail");
  if (rail) renderClockRail(rail, now);

  const response = await getWire();
  renderWire(container, response, now);
}

function initWire(): void {
  updateNavigation();
  loadWire();
}

document.addEventListener("DOMContentLoaded", initWire);
