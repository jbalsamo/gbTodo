import DOMPurify from "dompurify";

/**
 * Notes are stored in public.todos.notes as sanitized HTML (not plain text).
 * Empty / whitespace-only content (including empty tags like `<p></p>`) is stored as null.
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
  "A",
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

const ALLOWED_ATTR: Record<string, Set<string>> = {
  A: new Set(["href", "target", "rel"]),
};

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
  "a",
];

const DOMPURIFY_ATTR = ["href", "target", "rel"];

function dropUnsafeHref(el: Element) {
  const href = el.getAttribute("href") ?? "";
  if (!/^(https?:|mailto:|#)/i.test(href)) {
    el.removeAttribute("href");
  }
  if (el.getAttribute("target") === "_blank") {
    el.setAttribute("rel", "noopener noreferrer");
  }
}

/** Allowlist walker — works in the browser and in happy-dom (DOMPurify does not). */
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

    for (const attr of Array.from(el.attributes)) {
      const allowed = ALLOWED_ATTR[tag];
      if (!allowed || !allowed.has(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name);
      }
    }
    if (tag === "A") dropUnsafeHref(el);
    sanitizeElement(el);
    child = next;
  }
}

function purifyIfReliable(html: string): string {
  if (typeof window === "undefined" || !DOMPurify.isSupported) return html;
  const probe = DOMPurify.sanitize("<p>x</p>", { ALLOWED_TAGS: ["p"] });
  // happy-dom's HTML pipeline is incompatible with DOMPurify (drops `<p>`, keeps `<script>`).
  if (!probe.includes("<p>")) return html;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOMPURIFY_TAGS,
    ALLOWED_ATTR: DOMPURIFY_ATTR,
  });
}

/**
 * Sanitize notes HTML for safe storage/display.
 * Empty or whitespace-only content (including empty tags like `<p></p>`) → null.
 */
export function sanitizeNotesHtml(
  html: string | null | undefined,
): string | null {
  if (html == null) return null;
  const cleaned = purifyIfReliable(sanitizeWithAllowlist(html)).trim();
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
