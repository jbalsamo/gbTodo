import { describe, expect, it } from "vitest";
import {
  isNotesEmpty,
  notesToEditorContent,
  sanitizeNotesHtml,
} from "./notesHtml";

describe("notes HTML helpers", () => {
  it("stores sanitized HTML and maps empty/whitespace to null", () => {
    expect(sanitizeNotesHtml("<p>hello</p>")).toBe("<p>hello</p>");
    expect(sanitizeNotesHtml("<p></p>")).toBeNull();
    expect(sanitizeNotesHtml("<p><br></p>")).toBeNull();
    expect(sanitizeNotesHtml("   ")).toBeNull();
    expect(sanitizeNotesHtml("")).toBeNull();
    expect(sanitizeNotesHtml(null)).toBeNull();
  });

  it("strips unsafe tags while keeping formatting", () => {
    const result = sanitizeNotesHtml(
      '<p><strong>ok</strong><script>alert(1)</script><img src=x onerror=alert(2)></p>',
    );
    expect(result).toBe("<p><strong>ok</strong></p>");
    expect(result).not.toMatch(/script|onerror|img/i);
  });

  it("treats HTML-only empty notes as empty for the collapsed indicator", () => {
    expect(isNotesEmpty(null)).toBe(true);
    expect(isNotesEmpty("")).toBe(true);
    expect(isNotesEmpty("<p></p>")).toBe(true);
    expect(isNotesEmpty("<p> </p>")).toBe(true);
    expect(isNotesEmpty("<p><br></p>")).toBe(true);
    expect(isNotesEmpty("<p>note</p>")).toBe(false);
  });

  it("loads legacy plain text and existing HTML into the editor", () => {
    expect(notesToEditorContent("remember milk")).toBe("remember milk");
    expect(notesToEditorContent("<p><em>hi</em></p>")).toBe("<p><em>hi</em></p>");
    expect(notesToEditorContent("<p></p>")).toBe("");
  });
});
