import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../../framework/payments/catalog.ts";

// The matrix is written by hand, in Spanish, and this keeps it from falling behind the
// catalog: every case is in it, every row has its case, and the HU match the tags.

const matrix = readFileSync(
  new URL("../../docs/test-matrix.md", import.meta.url),
  "utf8",
);

const rows = matrix
  .split("\n")
  .filter((line) => /^\| [A-Z0-9]+-\d+ /.test(line))
  .map((line) => line.split("|").map((cell) => cell.trim()));

const stories = (cell: string | undefined) =>
  (cell ?? "")
    .split(",")
    .map((story) => story.trim().toLowerCase())
    .filter((story) => story !== "")
    .sort();

describe("the matrix of cases", () => {
  const cases = loadCatalog();

  it("has a row for every case of the catalog, and no row without its case", () => {
    expect(rows.map((row) => row[1]).sort()).toEqual(
      cases.map((item) => item.id).sort(),
    );
  });

  it("gives each case the same HU as its tags", () => {
    for (const item of cases) {
      const row = rows.find((cells) => cells[1] === item.id);
      expect(stories(row?.[5]), item.id).toEqual(
        item.tags.filter((tag) => /^hu-\d+$/.test(tag)).sort(),
      );
    }
  });
});
