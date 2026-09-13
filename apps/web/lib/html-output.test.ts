import { describe, expect, it } from "vitest";

import { buildSandboxedHtmlDocument, stripScriptTags } from "./html-output";

describe("stripScriptTags", () => {
  it("removes a script element with a body", () => {
    expect(stripScriptTags('<p>hi</p><script>alert(1)</script><p>bye</p>')).toBe("<p>hi</p><p>bye</p>");
  });

  it("removes a self-closing or unterminated script tag", () => {
    expect(stripScriptTags('<div></div><script src="x.js">')).toBe("<div></div>");
  });

  it("leaves ordinary markup untouched", () => {
    const html = "<table><tr><td>1</td></tr></table>";
    expect(stripScriptTags(html)).toBe(html);
  });

  it("is case-insensitive", () => {
    expect(stripScriptTags("<SCRIPT>evil()</SCRIPT><p>ok</p>")).toBe("<p>ok</p>");
  });
});

describe("buildSandboxedHtmlDocument", () => {
  it("embeds a strict CSP that blocks scripts and network fetches", () => {
    const doc = buildSandboxedHtmlDocument("<table><tr><td>1</td></tr></table>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<table><tr><td>1</td></tr></table>");
  });

  it("strips scripts even if the caller forgot to", () => {
    const doc = buildSandboxedHtmlDocument('<p>hi</p><script>fetch("https://evil.example")</script>');
    expect(doc).not.toContain("<script>");
    expect(doc).not.toContain("evil.example");
  });
});
