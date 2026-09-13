/**
 * Line-level diff between a cell's base and head source, used to render
 * line numbers and added/removed highlighting for code cells. Pure and
 * side-effect free so it can run during server rendering.
 */

export type DiffLineStatus = "unchanged" | "added" | "removed";

export type DiffLine = {
  /** 1-based line number on the side this line belongs to. */
  lineNumber: number;
  content: string;
  status: DiffLineStatus;
};

export type AlignedDiffRow = {
  /** Null is an alignment placeholder, never an empty source line. */
  base: DiffLine | null;
  head: DiffLine | null;
};

export type LineDiffResult = {
  baseLines: DiffLine[];
  headLines: DiffLine[];
  /** Shared display rows. In the unbounded fallback these are positional, not matching anchors. */
  alignedRows: AlignedDiffRow[];
  /** False when the inputs were too large for line-level diffing; both sides are still shown in full, unhighlighted. */
  bounded: boolean;
};

/** Caps the O(base * head) LCS table so a huge generated cell cannot exhaust the renderer. */
const MAX_DIFF_CELLS = 250_000;

export function computeLineDiff(base: string | null, head: string | null): LineDiffResult {
  const baseLines = splitLines(base);
  const headLines = splitLines(head);

  if ((baseLines.length + 1) * (headLines.length + 1) > MAX_DIFF_CELLS) {
    const baseOps: DiffLine[] = baseLines.map((content, index) => ({ lineNumber: index + 1, content, status: "unchanged" }));
    const headOps: DiffLine[] = headLines.map((content, index) => ({ lineNumber: index + 1, content, status: "unchanged" }));
    return {
      baseLines: baseOps,
      headLines: headOps,
      alignedRows: pairLines(baseOps, headOps),
      bounded: false,
    };
  }

  const lcs = buildLcsTable(baseLines, headLines);
  const { baseOps, headOps } = backtrack(baseLines, headLines, lcs);

  const numberedBase = baseOps.map((op, index) => ({
    lineNumber: index + 1,
    content: op.content,
    status: op.status,
  }));
  const numberedHead = headOps.map((op, index) => ({
    lineNumber: index + 1,
    content: op.content,
    status: op.status,
  }));
  return {
    baseLines: numberedBase,
    headLines: numberedHead,
    alignedRows: alignLines(numberedBase, numberedHead),
    bounded: true,
  };
}

function pairLines(base: DiffLine[], head: DiffLine[]): AlignedDiffRow[] {
  return Array.from({ length: Math.max(base.length, head.length) }, (_, index) => ({
    base: base[index] ?? null,
    head: head[index] ?? null,
  }));
}

/** Pair each changed run before the next unchanged anchor in linear time. */
function alignLines(base: DiffLine[], head: DiffLine[]): AlignedDiffRow[] {
  const rows: AlignedDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length || j < head.length) {
    const startBase = i;
    const startHead = j;
    while (i < base.length && base[i].status !== "unchanged") i += 1;
    while (j < head.length && head[j].status !== "unchanged") j += 1;
    const runLength = Math.max(i - startBase, j - startHead);
    for (let offset = 0; offset < runLength; offset += 1) {
      rows.push({
        base: startBase + offset < i ? base[startBase + offset] : null,
        head: startHead + offset < j ? head[startHead + offset] : null,
      });
    }
    if (i < base.length || j < head.length) {
      rows.push({ base: base[i] ?? null, head: head[j] ?? null });
      if (i < base.length) i += 1;
      if (j < head.length) j += 1;
    }
  }
  return rows;
}

function splitLines(value: string | null): string[] {
  if (value === null || value.length === 0) {
    return [];
  }
  return value.split("\n");
}

function buildLcsTable(baseLines: string[], headLines: string[]): Uint32Array[] {
  const rows = baseLines.length + 1;
  const cols = headLines.length + 1;
  const table = new Array<Uint32Array>(rows);
  for (let i = 0; i < rows; i += 1) {
    table[i] = new Uint32Array(cols);
  }
  for (let i = baseLines.length - 1; i >= 0; i -= 1) {
    for (let j = headLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        baseLines[i] === headLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function backtrack(
  baseLines: string[],
  headLines: string[],
  lcs: Uint32Array[],
): {
  baseOps: Array<{ content: string; status: DiffLineStatus }>;
  headOps: Array<{ content: string; status: DiffLineStatus }>;
} {
  const baseOps: Array<{ content: string; status: DiffLineStatus }> = [];
  const headOps: Array<{ content: string; status: DiffLineStatus }> = [];

  let i = 0;
  let j = 0;
  while (i < baseLines.length && j < headLines.length) {
    if (baseLines[i] === headLines[j]) {
      baseOps.push({ content: baseLines[i], status: "unchanged" });
      headOps.push({ content: headLines[j], status: "unchanged" });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      baseOps.push({ content: baseLines[i], status: "removed" });
      i += 1;
    } else {
      headOps.push({ content: headLines[j], status: "added" });
      j += 1;
    }
  }
  while (i < baseLines.length) {
    baseOps.push({ content: baseLines[i], status: "removed" });
    i += 1;
  }
  while (j < headLines.length) {
    headOps.push({ content: headLines[j], status: "added" });
    j += 1;
  }

  return { baseOps, headOps };
}
