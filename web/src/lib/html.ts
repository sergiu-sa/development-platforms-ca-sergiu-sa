/**
 * The textContent round-trip escapes &, < and > but leaves quotes alone, which
 * is fine for text nodes and not fine for attribute values. Wire content is
 * interpolated into innerHTML, some of it inside src/href/datetime, so quotes
 * are escaped too rather than keeping two near-identical helpers.
 */
export function escapeHtml(text: string | null | undefined): string {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Only http(s) links are rendered as links. The wire's contents come from a
 * third party and a "javascript:" href is script execution.
 */
export function safeUrl(url: string | null | undefined): string | null {
  return /^https?:\/\//i.test(url ?? "") ? (url as string) : null;
}
