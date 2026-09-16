import DOMPurify from "dompurify";

/**
 * Notes are stored in public.todos.notes as sanitized HTML (not plain text).
 * Empty / whitespace-only content (including empty tags like `<p></p>`) is stored as null.
 *
 * Links are not supported in the TipTap editor (`link: false`), so `<a>` is not allowlisted.
 * TipTap TextAlign stores alignment as `style="text-align: …"` on paragraphs/headings.
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
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
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
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

const SAFE_TEXT_ALIGN = new Set(["left", "center", "right", "justify"]);

/** Keep only safe `text-align` declarations from a style attribute. */
export function sanitizeStyleAttr(style: string): string | null {
  const kept: string[] = [];
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed
      .slice(colon + 1)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (prop === "text-align" && SAFE_TEXT_ALIGN.has(value)) {
      kept.push(`text-align: ${value}`);
    }
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

function sanitizeAlignAttr(value: string): string | null {
  const v = value.trim().toLowerCase();
  return SAFE_TEXT_ALIGN.has(v) ? v : null;
}

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

    // Only safe text-align style / align attr survive on block tags.
    const safeStyle = el.getAttribute("style")
      ? sanitizeStyleAttr(el.getAttribute("style")!)
      : null;
    const safeAlign = el.getAttribute("align")
      ? sanitizeAlignAttr(el.getAttribute("align")!)
      : null;
    for (const attr of Array.from(el.attributes)) {
      el.removeAttribute(attr.name);
    }
    if (safeStyle) {
      el.setAttribute("style", safeStyle);
    }
    if (safeAlign) {
      el.setAttribute("align", safeAlign);
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
    const cleaned = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: DOMPURIFY_TAGS,
      ALLOWED_ATTR: ["style", "align"],
    });
    // DOMPurify may leave unsafe CSS; re-walk to keep only text-align / align.
    return sanitizeWithAllowlist(cleaned);
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
