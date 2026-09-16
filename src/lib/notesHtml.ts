import DOMPurify from "dompurify";

/**
 * Notes are stored in public.todos.notes as sanitized HTML (not plain text).
 * Empty / whitespace-only content (including empty tags like `<p></p>`) is stored as null.
 *
 * Links are not supported in the TipTap editor (`link: false`), so `<a>` is not allowlisted.
 */

const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
]);

const DROP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "NOSCRIPT",
  "TEMPLATE",
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "SVG",
  "MATH",
  "FORM",
  "INPUT",
  "BUTTON",
  "TEXTAREA",
  "SELECT",
]);

const DOMPURIFY_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
];

/** Allowlist walker — happy-dom fallback when DOMPurify is unreliable. */
function sanitizeWithAllowlist(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  sanitizeElement(root);
  return root.innerHTML;
}

function sanitizeElement(parent: Element) {
  let child = parent.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === Node.COMMENT_NODE) {
      parent.removeChild(child);
      child = next;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      if (child.nodeType !== Node.TEXT_NODE) {
        parent.removeChild(child);
      }
      child = next;
      continue;
    }

    const el = child as Element;
    const tag = el.tagName;
    if (DROP_TAGS.has(tag)) {
      parent.removeChild(el);
      child = next;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      const firstMoved = el.firstChild;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      child = firstMoved ?? next;
      continue;
    }

    // No attributes are allowlisted for notes markup (no links).
    for (const attr of Array.from(el.attributes)) {
      el.removeAttribute(attr.name);
    }
    sanitizeElement(el);
    child = next;
  }
}

function isDomPurifyReliable(): boolean {
  if (typeof window === "undefined" || !DOMPurify.isSupported) return false;
  const probe = DOMPurify.sanitize("<p>x</p>", { ALLOWED_TAGS: ["p"] });
  // happy-dom's HTML pipeline is incompatible with DOMPurify (drops `<p>`, keeps `<script>`).
  return probe.includes("<p>");
}

/** Prefer DOMPurify when reliable; fall back to the allowlist walker in happy-dom. */
function sanitizeHtml(html: string): string {
  if (isDomPurifyReliable()) {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: DOMPURIFY_TAGS,
      ALLOWED_ATTR: [],
    });
  }
  return sanitizeWithAllowlist(html);
}

/**
 * Sanitize notes HTML for safe storage/display.
 * Empty or whitespace-only content (including empty tags like `<p></p>`) → null.
 */
export function sanitizeNotesHtml(
  html: string | null | undefined,
): string | null {
  if (html == null) return null;
  const cleaned = sanitizeHtml(html).trim();
  if (cleaned === "" || isNotesEmpty(cleaned)) return null;
  return cleaned;
}

/** True when notes have no meaningful text (treats `<p></p>` / whitespace as empty). */
export function isNotesEmpty(html: string | null | undefined): boolean {
  if (html == null) return true;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "";
}

/** Prepare stored notes for TipTap: sanitize HTML, or pass plain text through. */
export function notesToEditorContent(notes: string | null | undefined): string {
  if (notes == null || notes.trim() === "") return "";
  // Plain-text legacy notes (no tags) load as-is; TipTap wraps in a paragraph.
  if (!/<[a-z][\s\S]*>/i.test(notes)) {
    return notes;
  }
  return sanitizeNotesHtml(notes) ?? "";
}
