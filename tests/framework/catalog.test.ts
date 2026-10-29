import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { casesFor, loadCatalog } from "../../framework/payments/catalog.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import { temporaryDirectory } from "./builders.ts";

// A typo fails when the catalog loads, before anything runs, and says where (HU-03).

const valid = {
  id: "F01-01",
  title: "A single reference with a fixed amount is paid",
  flow: "payment",
  reference: { type: "single", amountType: "fixed", amount: 150.5 },
  objective: { step: "notice", expect: "OK" },
  tags: ["smoke"],
};

function catalogWith(files: Record<string, unknown[]>): URL {
  const directory = temporaryDirectory();
  for (const [name, cases] of Object.entries(files)) {
    writeFileSync(join(directory, name), JSON.stringify(cases));
  }
  return pathToFileURL(`${directory}/`);
}

describe("the catalog", () => {
  it("loads a valid case", () => {
    expect(loadCatalog(catalogWith({ "f01.json": [valid] }))).toEqual([valid]);
  });

  it("fails a misspelled field, and says which file and which field", () => {
    const { objective, ...rest } = valid;
    const typo = { ...rest, objetive: objective };
    expect(() => loadCatalog(catalogWith({ "f01-typo.json": [typo] }))).toThrow(
      /f01-typo\.json is not valid[\s\S]*objetive/,
    );
  });

  it("fails a misspelled optional field, which would otherwise be ignored", () => {
    const typo = { ...valid, check: ["reference-paid"] };
    expect(() => loadCatalog(catalogWith({ "f01.json": [typo] }))).toThrow(
      /Unrecognized key: "check"/,
    );
  });

  it("fails a code that does not exist", () => {
    const wrongCode = {
      ...valid,
      objective: { step: "notice", expect: "R-1O3" },
    };
    expect(() => loadCatalog(catalogWith({ "f01.json": [wrongCode] }))).toThrow(
      /objective\.expect/,
    );
  });

  it("fails an objective that the flow does not have", () => {
    const reversal = {
      ...valid,
      objective: { step: "reversal", expect: "OK" },
    };
    expect(() => loadCatalog(catalogWith({ "f01.json": [reversal] }))).toThrow(
      /objective\.step/,
    );
  });

  it("fails a case that is in the catalog twice", () => {
    expect(() =>
      loadCatalog(catalogWith({ "a.json": [valid], "b.json": [valid] })),
    ).toThrow("The case F01-01 is in the catalog twice");
  });

  it("fails a file that is not JSON", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "broken.json"), "[{ id: F01 }");
    expect(() => loadCatalog(pathToFileURL(`${directory}/`))).toThrow(
      /broken\.json could not be read/,
    );
  });

  it("names each test with its case, its integration and its variation", () => {
    const supermarket = loadIntegration("supermarket");
    const [entry] = casesFor(supermarket, [valid as never]);
    expect(entry?.name).toBe("F01-01__supermarket__single-fixed");
  });

  it("keeps the real catalog valid", () => {
    const names = casesFor(loadIntegration("supermarket")).map(
      (entry) => entry.name,
    );
    expect(names).toContain("F01-01__supermarket__single-fixed");
  });

  it("says which integrations exist when one does not", () => {
    expect(() => loadIntegration("bank")).toThrow(
      'There is no integration "bank". The ones there are: supermarket',
    );
  });
});
