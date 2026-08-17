import "../styles/app.css";
import { currentUsername, isLoggedIn, updateNavigation } from "../lib/auth";
import {
  addBriefingItem,
  createBriefing,
  deleteBriefing,
  getBriefing,
  getMyBriefings,
  removeBriefingItem,
  updateBriefing,
} from "../lib/api";
import {
  createBuilderTransport,
  createSaver,
  itemKey,
  type SaveStatus,
} from "../builder/save";
import {
  fileRefusal,
  moveItem,
  NOTE_MAX,
  removeItem,
  roomLeft,
  TITLE_MIN,
  type BuilderItem,
  type BuilderState,
  type MoveDirection,
} from "../builder/state";
import {
  addMarkup,
  bandMarkup,
  barMarkup,
  dangerMarkup,
  emptyMarkup,
  errorMarkup,
  factsMarkup,
  mastheadMarkup,
  SAVE_WORD,
  shelfMarkup,
  starterMarkup,
} from "../builder/view";
import { BUILDER_COPY as COPY } from "../builder/copy";
import { loadDeskStories, pickerMarkup } from "../builder/picker";
import type { Briefing } from "../briefing/types";
import type { DeskEntry } from "../desk/types";

/**
 * The briefing this page is for, or null for the page that starts one.
 *
 * A query parameter rather than a path segment. See the comment in build.html: a builder is never shared, so a pretty address buys nothing and costs four copies of one mapping.
 */
function slugFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get("b");
}

/**
 * How close to the limit the character count starts showing.
 *
 * A display choice rather than a rule, which is why it is here and not beside `NOTE_MAX` in the state module: the server has no opinion about it.
 * Standing visible from the first keystroke would put a number under every note on the page, counting down something nobody is near.
 */
const COUNT_FROM = 100;

function toState(briefing: Briefing): BuilderState {
  return {
    id: briefing.id,
    slug: briefing.slug,
    title: briefing.title,
    intro: briefing.intro ?? "",
    status: briefing.status,
    // The server orders by position, so the array order is the briefing's order
    // and position never has to be looked at again on this page.
    items: briefing.items.map((item) => ({
      id: item.id,
      storyId: item.storyId,
      note: item.note ?? "",
      story: item.story,
    })),
  };
}

/** Grows a writing surface to fit what is in it. Through the CSSOM, which is not subject to CSP; a style attribute would be. */
function grow(field: HTMLTextAreaElement): void {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

function growAll(root: ParentNode): void {
  root.querySelectorAll("textarea").forEach(grow);
}

async function mount(): Promise<void> {
  updateNavigation();

  const root = document.getElementById("root");
  const bar = document.getElementById("build-bar");
  if (!root || !bar) return;

  const slug = slugFromLocation();

  if (slug) {
    await mountBuilder(root, bar, slug);
  } else {
    await mountStarter(root);
  }
}

/**
 * The page with no briefing named: start one, and everything already written underneath.
 *
 * This listing is the only way back to a draft. Without it a briefing left half-written is reachable only by remembering its address, which is how somebody loses an afternoon of writing.
 */
async function mountStarter(root: HTMLElement): Promise<void> {
  const { status, body } = await getMyBriefings();

  // A 401 has already been handled by lib/api.ts, which cleared the token and
  // sent the reader to sign in. Anything else that failed is worth saying.
  if (status === 401) return;

  if (body?.success !== true) {
    root.innerHTML = errorMarkup(COPY.loadFailed);
    return;
  }

  root.innerHTML = starterMarkup() + shelfMarkup(body.briefings ?? []);
  growAll(root);

  const title = root.querySelector<HTMLTextAreaElement>("#starter-title");

  /**
   * One error line, reused.
   *
   * A live region rather than markup appended on each attempt, because the
   * second attempt must announce itself as well as the first, and appending
   * would leave a column of identical sentences.
   */
  function showStarterError(message: string): void {
    const line = root.querySelector<HTMLElement>("#starter-error");
    if (line) line.textContent = message;
  }

  root.addEventListener("input", (event) => {
    const field = event.target as HTMLElement;
    if (field instanceof HTMLTextAreaElement) grow(field);
  });

  root.addEventListener("click", async (event) => {
    if (!(event.target as HTMLElement).closest("[data-start]")) return;
    if (!title) return;

    const wanted = title.value.trim();
    const starting = root.querySelector<HTMLButtonElement>("[data-start]");

    // Not `fileRefusal`: that also wants a story, and a briefing being started
    // has none by definition. The only rule at this moment is the title, and
    // saying so here costs no request.
    if (wanted.length < TITLE_MIN) {
      showStarterError(COPY.titleTooShort(TITLE_MIN));
      title.focus();
      return;
    }

    if (starting) starting.disabled = true;

    const created = await createBriefing(wanted);

    if (created.body?.success !== true) {
      if (starting) starting.disabled = false;
      showStarterError(created.body?.message ?? COPY.loadFailed);
      return;
    }

    window.location.href = `/build.html?b=${encodeURIComponent(created.body.briefing.slug)}`;
  });
}

async function mountBuilder(
  root: HTMLElement,
  bar: HTMLElement,
  slug: string
): Promise<void> {
  const { status, body } = await getBriefing(slug);

  if (body?.success !== true) {
    // A draft belongs to its author and does not exist for anybody else, so a
    // 404 here is either somebody else's briefing or an expired session reading
    // as anonymous - `optionalAuth` folds the two together and there is no 401
    // to trigger the usual redirect. Asking a route that does answer 401 is what
    // tells them apart, and it is worth the extra request only on this branch.
    //
    // Only worth asking when a token was actually sent, and the guard is not an
    // optimisation. `lib/api.ts` redirects on a 401 only if the request carried a
    // token, so for a signed-out visitor the probe answers 401, redirects nobody,
    // and the early return below used to leave them on "Loading..." for ever -
    // which is what any shared builder URL does to somebody who is not signed in.
    if (status === 404 && isLoggedIn()) {
      const mine = await getMyBriefings();
      if (mine.status === 401) return;
    }

    root.innerHTML = errorMarkup(
      status === 0 ? COPY.loadFailed : COPY.notYours
    );
    return;
  }

  const briefing = body.briefing as Briefing;

  // A published briefing is readable by anyone, so this read succeeds for a slug
  // belonging to somebody else and would draw them a full editor over it. Every
  // write then answers 404 - `lockOwnBriefing` selects on id AND author_id - so
  // nothing can be changed, but the curator would type into it and lose the lot.
  //
  // Not a permission check: the token is decoded here, not verified, and the
  // server is what actually refuses. This only stops the page inviting work it
  // knows cannot be saved, and it answers exactly as it does for a slug that
  // never existed, which is the rule the whole module follows.
  if (briefing.author.username !== currentUsername()) {
    root.innerHTML = errorMarkup(COPY.notYours);
    return;
  }

  const state = toState(briefing);
  document.title = `${state.title} - Lede`;

  const saver = createSaver(createBuilderTransport(() => state));
  let deskEntries: DeskEntry[] | null = null;
  let pickerOpen = false;
  let confirmingDelete = false;

  bar.hidden = false;

  /**
   * What the bar's *structure* depends on: which controls it shows, and whether
   * it is carrying a reason the briefing cannot be filed. Deliberately not the
   * save state.
   */
  const barShape = () => `${state.status}|${fileRefusal(state) ?? ""}`;
  let barDrawn = "";

  /**
   * Redraws the bar only when its structure changed, then updates the save word
   * in place.
   *
   * Both halves matter and each was learned by measuring. Rewriting per
   * keystroke replaced the `aria-live` node every character, which is how a
   * screen reader ends up narrating the save state one letter at a time.
   * Folding the save word into the rewritten markup fixed that and broke
   * something worse: a keyboard user who had tabbed to File lost focus to the
   * document body a second later, when autosave finished and the button was
   * rebuilt underneath them.
   *
   * So the structure is redrawn rarely, and the word that changes often is
   * written into a node that stays put.
   */
  function paintBar(): void {
    const shape = barShape();

    if (shape !== barDrawn) {
      barDrawn = shape;
      bar.innerHTML = barMarkup(state, saver.status());
      return;
    }

    paintSave(saver.status());
  }

  function paintSave(saveStatus: SaveStatus): void {
    const label = bar.querySelector<HTMLElement>("#build-save");
    if (!label) return;

    label.dataset.state = saveStatus;
    // Words, not just a colour: the dot beside it is redundant with them.
    label.textContent = SAVE_WORD[saveStatus];
  }

  /**
   * Redraws the whole page from state.
   *
   * One code path rather than three adjustments, which is the lesson phase 7 paid for: removing a story changes the bands, the lede, the counts and whether it can be filed, and every separate patch of the DOM was a different thing somebody forgot.
   * Typing does not come through here - that would take the caret with it.
   */
  function render(focusSelector?: string): void {
    const now = new Date();

    root.innerHTML =
      mastheadMarkup(state) +
      (state.items.length === 0
        ? emptyMarkup()
        : state.items
            .map((item, index) =>
              bandMarkup(item, index, state.items.length, now)
            )
            .join("") + addMarkup(roomLeft(state))) +
      // Directly under the control that opened it. Below the delete control -
      // where it landed first - it read as a separate section of the page
      // rather than as the thing that had just been asked for.
      (pickerOpen ? `<div class="build-picker" id="picker"></div>` : "") +
      dangerMarkup(confirmingDelete);

    paintBar();
    growAll(root);
    state.items.forEach(paintCount);

    if (pickerOpen) paintPicker();

    // Focus is moved deliberately after every redraw, because the node that had
    // it is gone. Losing it drops a keyboard reader back to the top of the page.
    if (focusSelector) {
      root.querySelector<HTMLElement>(focusSelector)?.focus();
    }
  }

  /**
   * Whatever the server last refused, in the bar.
   *
   * One node whose text is rewritten, matching what the starter does with its own error line. The first version appended a paragraph per failure, so two refusals in a row stacked two of them into fixed-height furniture.
   */
  function showBarError(message: string): void {
    const line = bar.querySelector<HTMLElement>("#build-error");
    if (line) line.textContent = message;
  }

  function paintFacts(): void {
    const line = root.querySelector<HTMLElement>("#build-facts");
    if (line) line.innerHTML = factsMarkup(state);
  }

  function paintCount(item: BuilderItem): void {
    const label = root.querySelector<HTMLElement>(`[data-count="${item.id}"]`);
    if (!label) return;

    const left = NOTE_MAX - item.note.length;
    label.textContent = `${left} characters left`;
    // toggle rather than rewriting className, which invalidated style on every
    // keystroke whether or not the class had changed.
    label.classList.toggle("near", left <= COUNT_FROM);
  }

  function paintPicker(): void {
    const panel = root.querySelector<HTMLElement>("#picker");
    if (!panel) return;

    panel.innerHTML = pickerMarkup(
      deskEntries,
      new Set(state.items.map((item) => item.storyId)),
      roomLeft(state),
      new Date()
    );
  }

  // The bar carries the save state, so the saver repaints the bar.
  saver.subscribe(paintBar);

  root.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLTextAreaElement)) return;

    grow(field);

    if (field.id === "build-title") {
      state.title = field.value;
      saver.touch("briefing");
      // The bar carries the title's own consequence - whether it can be filed
      // yet - so it is repainted while the caret stays where it is. Only when
      // that sentence actually changes, which is at most once per edit: writing
      // the whole bar per keystroke would replace the aria-live node every
      // character and then put text in it, which is how a screen reader ends up
      // announcing the save state on every letter typed.
      paintBar();
      return;
    }

    if (field.id === "build-intro") {
      state.intro = field.value;
      saver.touch("briefing");
      return;
    }

    const band = field.closest<HTMLElement>("[data-band]");
    const item = state.items.find(
      (candidate) => String(candidate.id) === band?.dataset.band
    );
    if (!item) return;

    const wasBlank = item.note.trim() === "";
    item.note = field.value;
    paintCount(item);

    // "3 without a note" only moves when a note crosses between empty and not.
    // Every other keystroke leaves the line identical, and repainting it anyway
    // re-reduces every story on the page for nothing.
    if (wasBlank !== (item.note.trim() === "")) paintFacts();

    saver.touch(itemKey(item.id));
  });

  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;

    const move = target.closest<HTMLElement>("[data-move]");
    if (move) {
      const itemId = Number(move.dataset.item);
      const moved = moveItem(
        state.items,
        itemId,
        move.dataset.move as MoveDirection
      );

      if (moved === state.items) return;

      state.items = moved as BuilderItem[];
      saver.touch("order");
      // Focus follows the story rather than the position, or a second press
      // moves whatever has just landed under the cursor instead.
      render(`[data-band="${itemId}"] [data-move="${move.dataset.move}"]`);
      return;
    }

    const remove = target.closest<HTMLElement>("[data-remove]");
    if (remove) {
      await removeStory(Number(remove.dataset.remove));
      return;
    }

    if (target.closest("[data-add]")) {
      pickerOpen = true;
      if (deskEntries === null) deskEntries = await loadDeskStories();
      render("#picker .build-picker-close");
      return;
    }

    if (target.closest("[data-picker-close]")) {
      pickerOpen = false;
      render("[data-add]");
      return;
    }

    const pick = target.closest<HTMLElement>("[data-pick]");
    if (pick) {
      await addStory(Number(pick.dataset.pick));
      return;
    }

    if (target.closest("[data-delete-cancel]")) {
      confirmingDelete = false;
      render("[data-delete]");
      return;
    }

    if (target.closest("[data-delete]")) {
      // Two presses rather than a browser dialog: a confirm() blocks the page,
      // cannot be styled, and reads badly to a screen reader.
      if (!confirmingDelete) {
        confirmingDelete = true;
        render("[data-delete]");
        return;
      }

      const removed = await deleteBriefing(state.id);
      if (removed.body?.success === true) {
        window.location.href = "/build.html";
      }
    }
  });

  bar.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;

    if (target.closest("[data-file]")) {
      await setStatus("published");
      return;
    }

    if (target.closest("[data-withdraw]")) {
      await setStatus("draft");
    }
  });

  async function setStatus(next: "draft" | "published"): Promise<void> {
    // Anything still queued goes up first, or a briefing files with a title the
    // server has never been told about.
    await saver.flush();
    await saver.settled();

    const { body } = await updateBriefing(state.id, { status: next });

    if (body?.success !== true) {
      showBarError(body?.message ?? COPY.loadFailed);
      return;
    }

    state.status = next;
    render();
  }

  async function addStory(storyId: number): Promise<void> {
    const entry = deskEntries?.find(
      (candidate) => candidate.storyId === storyId
    );
    if (!entry) return;

    const { body } = await addBriefingItem(state.id, storyId);
    if (body?.success !== true) return;

    state.items = [
      ...state.items,
      { id: body.item.id, storyId, note: "", story: entry.story },
    ];

    render(`#note-${body.item.id}`);
  }

  /** Waits for the server, then redraws from what is left - the desk's rule, and for the same reason: the page must not show a story gone that is still there. */
  async function removeStory(itemId: number): Promise<void> {
    const { status: removeStatus, body } = await removeBriefingItem(
      state.id,
      itemId
    );

    // A 404 means it is already gone, which is the end state the press asked
    // for. Anything else that failed leaves the page as it is.
    if (body?.success !== true && removeStatus !== 404) {
      showBarError(body?.message ?? COPY.loadFailed);
      return;
    }

    const index = state.items.findIndex((item) => item.id === itemId);
    state.items = removeItem(state.items, itemId) as BuilderItem[];

    // The next story's Remove, or the one before it when the last was taken.
    const next = state.items[index] ?? state.items[index - 1];
    render(next ? `[data-band="${next.id}"] [data-remove]` : "[data-add]");
  }

  render();

  // Prose is worth more than a decision on the wire, so it does not wait for the
  // pause when the page is being left. `visibilitychange` rather than `unload`,
  // which does not fire reliably on a phone.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saver.flush();
  });
  window.addEventListener("pagehide", () => void saver.flush());
}

void mount();
