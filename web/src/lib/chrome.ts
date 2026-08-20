/**
 * The site's bar and footer, built in TypeScript.
 *
 * Five pages write these in static HTML, and that is right for them: they paint their frame before a line of JavaScript runs.
 * A **server-composed** page cannot. `/u/:username` is served as a document whose body is nothing but an empty `#root`, so anything it wants on screen has to be built here and painted by its entry.
 *
 * It lives in `lib/` rather than in a feature module because it is site furniture, not briefings furniture.
 * The first version put it in `web/src/briefing/profile.ts`, where the next server-composed page would have had to import the curator page to get a nav bar.
 *
 * **Not folded onto the five static copies**, deliberately. Those pages would then paint their bar only after their bundle ran, trading a real property - a frame that survives a failed or slow script - for the removal of duplication. That is a bad trade and it is logged as such rather than left to look like an oversight.
 */

/** Which way out the bar offers, and where it points. */
export interface ChromeOptions {
  /** Defaults to the wire, which is where every page's way out leads. */
  backHref?: string;
  backLabel?: string;
  /** The shelf link, shown on pages that are not themselves the shelf. */
  briefings?: boolean;
}

/**
 * The bar.
 *
 * `#nav-login`, `#nav-user` and `#nav-logout` are the ids `lib/auth.ts`'s `updateNavigation()` fills in, so a page that paints this must call it **afterwards** - the elements do not exist until then.
 *
 * `#nav-user` carries no `href` here. `updateNavigation()` either writes `/u/<username>` or removes the attribute outright, so a static one would only ever be a placeholder that reads like a real destination.
 */
export function chromeMarkup(options: ChromeOptions = {}): string {
  const {
    backHref = "/index.html",
    backLabel = "Back to the wire",
    briefings = true,
  } = options;

  return (
    `<div class="deskbar">` +
    `<a href="/index.html" class="word">Lede<b>.</b></a>` +
    `<a href="${backHref}" class="btn m deskbar-back">` +
    `<span aria-hidden="true">&larr;</span>` +
    `<span>${backLabel}</span></a>` +
    (briefings
      ? `<a href="/briefings.html" class="btn m deskbar-briefings">Briefings</a>`
      : "") +
    `<nav class="top-nav m" aria-label="Account">` +
    // All three start hidden, exactly as the static pages declare them.
    // `updateNavigation()` reveals the right pair. It runs immediately after this is painted today, so nothing flashes;
    //  but a page that ever returns between the two would otherwise show a signed-out visitor a Log out button, and `lib/auth.ts` states the rule outright:
    //  the markup has to declare a starting state.
    `<a href="/login.html" id="nav-login" class="nav-link" hidden>Log in</a>` +
    `<a id="nav-user" class="nav-link top-nav-user" hidden></a>` +
    `<button id="nav-logout" class="nav-link" type="button" hidden>Log out</button>` +
    `</nav></div>`
  );
}

/** The footer, and one of the two places `-30-` is allowed to appear. */
export function footMarkup(): string {
  return (
    `<footer class="foot m quiet">` +
    `<span>Lede</span>` +
    `<span>Stories &copy; Guardian News &amp; Media</span>` +
    `<span aria-hidden="true">-30-</span>` +
    `</footer>`
  );
}
