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


  it("unwraps anchor tags because links are not supported in the editor", () => {
    expect(
      sanitizeNotesHtml('<p><a href="https://evil.example">click</a></p>'),
    ).toBe("<p>click</p>");
    expect(
      sanitizeNotesHtml('<p><a href="javascript:alert(1)">x</a></p>'),
    ).toBe("<p>x</p>");
    expect(
      sanitizeNotesHtml('<p><a href="https://ok" target="_blank" rel="noopener">safe</a></p>'),
    ).toBe("<p>safe</p>");
  });

  it("keeps underline and other formatting tags", () => {
    expect(sanitizeNotesHtml("<p><u>under</u><em>em</em><strong>b</strong></p>")).toBe(
      "<p><u>under</u><em>em</em><strong>b</strong></p>",
    );
  });

  it("strips event-handler and unsafe style attrs from surviving tags", () => {
    const result = sanitizeNotesHtml(
      '<p onclick="alert(1)" style="color:red"><u data-x="1">hi</u></p>',
    );
    expect(result).toBe("<p><u>hi</u></p>");
    expect(result).not.toMatch(/onclick|style|data-x|href|color/i);
  });

  it("preserves safe text-align styles and strips unsafe CSS", () => {
    expect(
      sanitizeNotesHtml('<p style="text-align: center">aligned</p>'),
    ).toBe('<p style="text-align: center">aligned</p>');
    expect(
      sanitizeNotesHtml('<p style="text-align: right; color: red">x</p>'),
    ).toBe('<p style="text-align: right">x</p>');
    expect(
      sanitizeNotesHtml('<p style="background:url(javascript:alert(1))">x</p>'),
    ).toBe("<p>x</p>");
    expect(sanitizeNotesHtml('<p align="center">legacy</p>')).toBe(
      '<p align="center">legacy</p>',
    );
    expect(sanitizeNotesHtml('<p align="middle">nope</p>')).toBe("<p>nope</p>");
  });

  it("loads legacy plain text and existing HTML into the editor", () => {
    expect(notesToEditorContent("remember milk")).toBe("remember milk");
    expect(notesToEditorContent("<p><em>hi</em></p>")).toBe("<p><em>hi</em></p>");
    expect(notesToEditorContent("<p></p>")).toBe("");
  });
});
