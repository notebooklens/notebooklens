import { describe, expect, it } from "vitest";

import { computeLineDiff } from "./code-diff";

describe("computeLineDiff", () => {
  it.each<[string, string, Array<[string | null, string | null]>]>([
    ["a\nb", "new\na\nb", [[null, "new"], ["a", "a"], ["b", "b"]]],
    ["a\nb", "a\nnew\nb", [["a", "a"], [null, "new"], ["b", "b"]]],
    ["a\nb", "a\nb\nnew", [["a", "a"], ["b", "b"], [null, "new"]]],
  ])("aligns inserted lines in %j against %j", (base, head, expected) => {
    const result = computeLineDiff(base, head);
    expect(result.alignedRows.map(({ base: before, head: after }) => [before?.content ?? null, after?.content ?? null])).toEqual(expected);
    const reversed = computeLineDiff(head, base);
    expect(reversed.alignedRows.map(({ base: before, head: after }) => [after?.content ?? null, before?.content ?? null])).toEqual(expected);
  });

  it("pairs unequal replacement runs without shifting the next unchanged anchor", () => {
    const result = computeLineDiff("first\nold\nlast", "first\nnew\nextra\nlast");
    expect(result.alignedRows.map(({ base, head }) => [base?.lineNumber ?? null, head?.lineNumber ?? null])).toEqual([
      [1, 1], [2, 2], [null, 3], [3, 4],
    ]);
    expect(result.alignedRows[1].base?.status).toBe("removed");
    expect(result.alignedRows[1].head?.status).toBe("added");
    expect(result.alignedRows[3].base?.content).toBe("last");
    expect(computeLineDiff("first\nnew\nextra\nlast", "first\nold\nlast").alignedRows[2]).toEqual({
      base: { content: "extra", lineNumber: 3, status: "removed" }, head: null,
    });
  });

  it("keeps separate replacement runs on their own side of unchanged anchors", () => {
    const result = computeLineDiff("old-a\nold-b\nanchor\nold-c\nend", "new-a\nanchor\nnew-b\nnew-c\nend");
    expect(result.alignedRows.map(({ base, head }) => [base?.content ?? null, head?.content ?? null])).toEqual([
      ["old-a", "new-a"], ["old-b", null], ["anchor", "anchor"],
      ["old-c", "new-b"], [null, "new-c"], ["end", "end"],
    ]);
  });

  it("preserves every line and aligns only equal unchanged anchors across repeated-line combinations", () => {
    const sources: Array<string | null> = [null, "", "a", "b", " ", "\t"];
    for (const first of ["a", "b", ""]) {
      for (const second of ["a", "b", ""]) {
        for (const third of ["a", "b", ""]) {
          sources.push([first, second, third].join("\n"));
        }
      }
    }
    for (const before of sources) {
      for (const after of sources) {
        const result = computeLineDiff(before, after);
        expect(result.alignedRows.flatMap(({ base }) => base ? [base] : [])).toEqual(result.baseLines);
        expect(result.alignedRows.flatMap(({ head }) => head ? [head] : [])).toEqual(result.headLines);
        for (const { base, head } of result.alignedRows) {
          expect(base !== null || head !== null).toBe(true);
          if (base?.status === "unchanged" || head?.status === "unchanged") {
            expect(base?.status).toBe("unchanged");
            expect(head?.status).toBe("unchanged");
            expect(base?.content).toBe(head?.content);
          }
        }
      }
    }
  });

  it("retains whitespace and distinguishes actual blank lines from absent rows", () => {
    const result = computeLineDiff("a\n\nb", "a\n \n\nb");
    expect(result.alignedRows[1]).toEqual({ base: null, head: { lineNumber: 2, content: " ", status: "added" } });
    expect(result.alignedRows[2]).toEqual({
      base: { lineNumber: 2, content: "", status: "unchanged" },
      head: { lineNumber: 3, content: "", status: "unchanged" },
    });
  });

  it.each([[null, null], [null, ""], ["", null], ["", ""]])("keeps empty and absent sources free of phantom lines (%j, %j)", (base, head) => {
    expect(computeLineDiff(base, head).alignedRows).toEqual([]);
  });

  it("uses absent-side placeholders for a wholly added or removed source", () => {
    expect(computeLineDiff(null, "a\n").alignedRows).toEqual([
      { base: null, head: { lineNumber: 1, content: "a", status: "added" } },
      { base: null, head: { lineNumber: 2, content: "", status: "added" } },
    ]);
    expect(computeLineDiff("a", null).alignedRows).toEqual([
      { base: { lineNumber: 1, content: "a", status: "removed" }, head: null },
    ]);
  });

  it("bounds actual table allocation including its sentinel row and column", () => {
    const lines = Array.from({ length: 500 }, () => "line").join("\n");
    expect(computeLineDiff(lines, lines).bounded).toBe(false);
    const shorter = Array.from({ length: 499 }, () => "line").join("\n");
    expect(computeLineDiff(shorter, shorter).bounded).toBe(true);
  });

  it("pads unequal fallback sides without inventing matching lines", () => {
    const base = Array.from({ length: 600 }, (_, i) => `old-${i}`).join("\n");
    const head = Array.from({ length: 700 }, (_, i) => `new-${i}`).join("\n");
    const result = computeLineDiff(base, head);
    expect(result.bounded).toBe(false);
    expect(result.alignedRows).toHaveLength(700);
    expect(result.alignedRows[600]).toEqual({
      base: null, head: { lineNumber: 601, content: "new-600", status: "unchanged" },
    });
    expect(result.alignedRows.flatMap((row) => row.base ? [row.base] : [])).toEqual(result.baseLines);
    expect(result.alignedRows.flatMap((row) => row.head ? [row.head] : [])).toEqual(result.headLines);
  });

  it("marks every line unchanged when base and head are identical", () => {
    const result = computeLineDiff("a\nb\nc", "a\nb\nc");

    expect(result.bounded).toBe(true);
    expect(result.baseLines.every((line) => line.status === "unchanged")).toBe(true);
    expect(result.headLines.every((line) => line.status === "unchanged")).toBe(true);
    expect(result.baseLines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
  });

  it("marks a single changed line as removed on base and added on head", () => {
    const result = computeLineDiff("a\nb\nc", "a\nB\nc");

    expect(result.baseLines.map((line) => line.status)).toEqual(["unchanged", "removed", "unchanged"]);
    expect(result.headLines.map((line) => line.status)).toEqual(["unchanged", "added", "unchanged"]);
  });

  it("marks appended lines as added without disturbing unchanged lines", () => {
    const result = computeLineDiff("a\nb", "a\nb\nc\nd");

    expect(result.baseLines.map((line) => line.status)).toEqual(["unchanged", "unchanged"]);
    expect(result.headLines.map((line) => line.status)).toEqual(["unchanged", "unchanged", "added", "added"]);
  });

  it("marks removed lines as removed without disturbing unchanged lines", () => {
    const result = computeLineDiff("a\nb\nc\nd", "a\nd");

    expect(result.baseLines.map((line) => line.status)).toEqual(["unchanged", "removed", "removed", "unchanged"]);
    expect(result.headLines.map((line) => line.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("treats null source as no lines", () => {
    const result = computeLineDiff(null, "a\nb");

    expect(result.baseLines).toEqual([]);
    expect(result.headLines.map((line) => line.content)).toEqual(["a", "b"]);
  });

  it("falls back to unhighlighted full text when line counts exceed the bound", () => {
    const base = Array.from({ length: 600 }, (_, i) => `base-${i}`).join("\n");
    const head = Array.from({ length: 600 }, (_, i) => `head-${i}`).join("\n");

    const result = computeLineDiff(base, head);

    expect(result.bounded).toBe(false);
    expect(result.baseLines).toHaveLength(600);
    expect(result.headLines).toHaveLength(600);
    expect(result.baseLines.every((line) => line.status === "unchanged")).toBe(true);
  });

  it("assigns sequential 1-based line numbers per side", () => {
    const result = computeLineDiff("x\ny", "x\nZ\ny");

    expect(result.baseLines.map((line) => line.lineNumber)).toEqual([1, 2]);
    expect(result.headLines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
  });
});
