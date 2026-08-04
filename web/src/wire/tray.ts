/**
 * The tray: what is on the reader's desk, pinned to the bottom of the page
 * from the moment they save anything.
 *
 * It is the running record of the session, which is why it lists the stories
 * as slugs rather than just counting them - a number tells you how many you
 * kept, a column of slugs tells you what you kept. Each chip removes its own
 * story, so anything saved by accident can come straight back off without
 * hunting for the row it came from.
 *
 * There is deliberately no call to action for a signed-in reader yet. `/desk`
 * is phase 7, and a blue button leading nowhere would be the most prominent
 * thing on the page and also the only broken one. The signed-out reader does
 * get one, because sign-in exists and is exactly what they need next.
 */

import { escapeHtml } from "../lib/html";
import { isLoggedIn } from "../lib/auth";
import { slugIndex } from "../lib/slug";
import { BUTTON_FACES } from "./row";
import type { DeckStore } from "./store";

/**
 * Where a signed-out reader lands, and where they come back to.
 *
 * Encoded because `safeNext()` on the other end reads the raw parameter, and
 * a bare "/" is what it will allow through.
 */
const SIGN_IN_HREF = "/login.html?next=%2F";

export function mountTray(store: DeckStore): void {
  const tray = document.getElementById("tray");
  const count = document.getElementById("tray-n");
  const chips = document.getElementById("tray-chips");
  const cta = document.getElementById("tray-cta");
  if (!tray || !count || !chips) return;

  // Read once at mount. A reader who signs in navigates, and the page they
  // land back on mounts this again.
  if (cta) {
    cta.innerHTML = isLoggedIn()
      ? ""
      : `<a class="btn btn-blue m" href="${SIGN_IN_HREF}">` +
        `Sign in to keep these</a>`;
  }

  const slugs = slugIndex(store.get().stories);
  // What the desk held last time it was drawn. A skip, an undo of a skip and
  // a re-decision all notify without changing it, and rebuilding the chips
  // then measuring the tray forces a layout of the whole document - once per
  // keypress, over a page holding twenty rows of photographs.
  let drawn: string | null = null;

  store.subscribe((state) => {
    const saved = state.stories.filter(
      (story) => state.decisions.get(story.id) === "saved"
    );
    const key = saved.map((story) => story.id).join(",");
    if (key === drawn) return;
    drawn = key;

    tray.hidden = saved.length === 0;
    count.textContent = String(saved.length);

    const face = BUTTON_FACES.save.on;
    chips.innerHTML = saved
      .map((story) => {
        const slug = escapeHtml(slugs.get(story.id) ?? "");
        return (
          `<span class="tray-chip m" data-story-id="${Number(story.id)}">` +
          `${slug}<button type="button" data-act="clear" ` +
          `aria-label="${face.aria(slug)}">${face.label}</button></span>`
        );
      })
      .join("");

    // The toast has to sit above the tray, and the tray's height is not a
    // constant: it wraps to two lines at 390 and changes again when the
    // sign-in call to action is present. Publishing the measured height beats
    // a magic number in the stylesheet that is only right at one width.
    //
    // Through the CSSOM rather than a style attribute - the attribute is what
    // the CSP blocks, and `setProperty` is not subject to it at all.
    document.documentElement.style.setProperty(
      "--tray-h",
      tray.hidden ? "0px" : `${tray.offsetHeight}px`
    );
  });

  chips.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("[data-act='clear']")) return;

    const id = Number(
      target.closest<HTMLElement>(".tray-chip")?.dataset.storyId
    );
    if (Number.isInteger(id)) store.clear(id);
  });
}
