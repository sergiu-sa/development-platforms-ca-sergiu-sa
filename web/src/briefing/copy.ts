/**
 * Words and links more than one briefing surface has to agree on.
 *
 * The same shape `wire/copy.ts` takes, and for the same reason: the way back to the wire was stated in six places across two modules before this existed, and two dead ends had already ended up with byte-identical prose written twice.
 * Retitling the wire or moving its path should be one edit.
 */

/** Where a dead end sends the reader. */
export const WIRE_HREF = "/index.html";
export const WIRE_CTA = "Read the wire";

/**
 * What a failed request says.
 *
 * Shared by the reading view and the shelf because they fail the same way and should not describe it differently.
 * It states what happened and what to do, it does not apologise, and it does not blame the reader.
 */
export const FAILED = "The connection failed. Reload to try again.";
