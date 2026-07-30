/**
 * Some models stream their internal channel format into the visible text
 * instead of into reasoning parts — you see markers like `<|channel|>`,
 * `<|start|>assistant`, or a bare `thought` line before the real answer.
 * That is a provider/model artifact, not something the user should read, so
 * the experience layer strips the known markers before rendering.
 *
 * Deliberately conservative: it removes only well-known control tokens and
 * never rewrites ordinary prose. Anything unrecognized is shown as-is rather
 * than silently swallowed.
 */

const CHANNEL_NAME = "thought|thinking|analysis|commentary|final";

/**
 * A whole channel header with its name: `<|channel|>analysis<|message|>`.
 * Matched first so the channel NAME goes with the token rather than being
 * left glued to the text ("analysisFilter to Milan").
 */
const CHANNEL_HEADER = new RegExp(
  `<\\|?channel\\|?>\\s*(?:${CHANNEL_NAME})?\\s*(?:<\\|?message\\|?>)?`,
  "gi",
);

/** Any remaining lone control token: `<|start|>`, `<|end|>`, `<|return|>` … */
const CONTROL_TOKEN = /<\|?(?:channel|start|end|message|return|constrain|call)\|?>/gi;

/** A bare channel label sitting on its own line. */
const CHANNEL_LABEL_LINE = new RegExp(`^[ \\t]*(?:${CHANNEL_NAME})[ \\t]*$`, "gim");

export function sanitizeModelText(text: string): string {
  return text
    .replace(CHANNEL_HEADER, "")
    .replace(CONTROL_TOKEN, "")
    .replace(CHANNEL_LABEL_LINE, "");
}

/** True when a chunk is nothing but control noise, so it need not be shown. */
export function isOnlyControlNoise(text: string): boolean {
  return text.length > 0 && sanitizeModelText(text).trim().length === 0;
}

/** Collapse the blank lines that stripping can leave behind. */
export function tidyModelText(text: string): string {
  return sanitizeModelText(text).replace(/\n{3,}/g, "\n\n").trimStart();
}
