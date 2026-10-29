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
  reference: { type: "single", amountType: "fixed" },
  amount: 150.5,
  objective: { step: "notice", expect: "OK" },
  tags: ["smoke"],
};

const supermarket = loadIntegration("supermarket");

const entriesOf = (reference: object, amount: number | number[] = 150.5) =>
  casesFor(supermarket, [{ ...valid, reference, amount } as never]);

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
    const [entry] = casesFor(supermarket, [valid as never]);
    expect(entry?.name).toBe("F01-01__supermarket__single-fixed");
  });

  it("makes one test per value of each list", () => {
    const names = entriesOf({
      type: ["single", "recurring"],
      amountType: ["fixed", "open"],
      expiresOn: [null, "2099-12-31"],
    }).map((entry) => entry.variation);
    expect(names).toEqual([
      "single-fixed",
      "single-fixed-2099-12-31",
      "single-open",
      "single-open-2099-12-31",
      "recurring-fixed",
      "recurring-fixed-2099-12-31",
      "recurring-open",
      "recurring-open-2099-12-31",
    ]);
  });

  it("creates a fixed reference with what is paid, and an open one without an amount", () => {
    const [fixed, open] = entriesOf({
      type: "single",
      amountType: ["fixed", "open"],
      expiresOn: "2099-12-31",
    });
    expect(fixed?.reference).toEqual({
      type: "single",
      amountType: "fixed",
      amount: 150.5,
      expiresOn: "2099-12-31",
    });
    expect(open?.reference).toEqual({
      type: "single",
      amountType: "open",
      expiresOn: "2099-12-31",
    });
  });

  it("makes one test per amount when the case lists them, and names it", () => {
    const entries = entriesOf(
      { type: "single", amountType: "fixed", amount: 150.5 },
      [150.49, 150.51],
    );
    expect(entries.map((entry) => [entry.variation, entry.amount])).toEqual([
      ["single-fixed-150.49", 150.49],
      ["single-fixed-150.51", 150.51],
    ]);
    expect(entries.map((entry) => entry.reference?.amount)).toEqual([
      150.5, 150.5,
    ]);
  });

  it("creates each fixed reference with its own amount when the case does not say another", () => {
    const entries = entriesOf(
      { type: "single", amountType: "fixed" },
      [1, 10000],
    );
    expect(entries.map((entry) => entry.reference?.amount)).toEqual([1, 10000]);
  });

  it("lets a fixed reference be worth something else than what is paid", () => {
    const [entry] = entriesOf(
      { type: "single", amountType: "fixed", amount: 150.5 },
      150.51,
    );
    expect(entry?.reference?.amount).toBe(150.5);
  });

  it("pays twice with the same sequence or a new one, and says it in the name", () => {
    const twice = {
      ...valid,
      flow: "payment-twice",
      secondSequence: ["same", "new"],
      objective: { step: "second-payment", expect: "R-102" },
    };
    expect(
      casesFor(supermarket, [twice as never]).map((entry) => [
        entry.name,
        entry.secondSequence,
      ]),
    ).toEqual([
      ["F01-01__supermarket__single-fixed-same-sequence", "same"],
      ["F01-01__supermarket__single-fixed-new-sequence", "new"],
    ]);
  });

  it("tries each code nobody created, and names the test after it", () => {
    const unknown = {
      id: "F02-01",
      title: "A code nobody created is not found",
      flow: "unknown-reference",
      code: ["0000000000000", "00000000000000"],
      amount: 150.5,
      objective: { step: "request", expect: "R-101" },
      tags: [],
    };
    expect(
      casesFor(supermarket, [unknown as never]).map((entry) => [
        entry.name,
        entry.code,
        entry.reference,
      ]),
    ).toEqual([
      ["F02-01__supermarket__0000000000000", "0000000000000", undefined],
      ["F02-01__supermarket__00000000000000", "00000000000000", undefined],
    ]);
  });

  it("takes a code only in the flow that pays an unknown reference, and a reference in the rest", () => {
    const message = "the unknown-reference flow takes a code and no reference";
    expect(() =>
      casesFor(supermarket, [{ ...valid, code: "123" } as never]),
    ).toThrow(message);
    expect(() =>
      casesFor(supermarket, [{ ...valid, flow: "unknown-reference" } as never]),
    ).toThrow(message);
  });

  it("makes one test per state a transition starts from, and names it", () => {
    const transition = {
      ...valid,
      flow: "transition",
      from: ["active", "paid"],
      objective: { step: "cancel", expect: "OK" },
    };
    expect(
      casesFor(supermarket, [transition as never]).map((entry) => [
        entry.name,
        entry.from,
      ]),
    ).toEqual([
      ["F01-01__supermarket__single-fixed-from-active", "active"],
      ["F01-01__supermarket__single-fixed-from-paid", "paid"],
    ]);
  });

  it("checks the states a transition can start from", () => {
    const transition = {
      ...valid,
      flow: "transition",
      objective: { step: "view", expect: "OK" },
    };
    expect(() => casesFor(supermarket, [transition as never])).toThrow(
      "F01-01: from goes with the transition flow",
    );
    expect(() =>
      casesFor(supermarket, [{ ...valid, from: "active" } as never]),
    ).toThrow("F01-01: from goes with the transition flow");
    expect(() =>
      casesFor(supermarket, [
        { ...transition, from: ["active", "expired"] } as never,
      ]),
    ).toThrow("F01-01: an expired reference goes in a case of its own");
    expect(() =>
      casesFor(supermarket, [{ ...transition, from: "expired" } as never]),
    ).toThrow("F01-01: an expired reference needs its expiresOn");
    expect(() =>
      casesFor(supermarket, [
        {
          ...transition,
          from: "paid",
          reference: { type: "recurring", amountType: "fixed" },
        } as never,
      ]),
    ).toThrow("F01-01: a recurring reference stays active when it is paid");
  });

  it("takes each way of calling of 8.9 with the step it fits", () => {
    const calling = (objective: object) =>
      casesFor(supermarket, [{ ...valid, objective } as never]);
    expect(
      calling({ step: "create", expect: 401, caller: "no-token" }),
    ).toHaveLength(1);
    expect(
      calling({ step: "token", expect: 401, caller: "wrong-key" }),
    ).toHaveLength(1);
    expect(() => calling({ step: "token", expect: "OK" })).toThrow(
      "F01-01: the token step goes with a wrong key",
    );
    expect(() =>
      calling({ step: "create", expect: 401, caller: "wrong-key" }),
    ).toThrow("F01-01: the token step goes with a wrong key");
    expect(() =>
      calling({ step: "inquiry", expect: 400, caller: "malformed-request" }),
    ).toThrow("F01-01: a malformed request goes with a step that sends a body");
  });

  it("takes another merchant only for an event of the merchant, from the config of its integration", () => {
    const byAnother = {
      ...valid,
      flow: "transition",
      from: "active",
      objective: { step: "view", expect: "R-101", caller: "another-merchant" },
    };
    expect(casesFor(supermarket, [byAnother as never])).toHaveLength(1);
    expect(() =>
      casesFor(supermarket, [
        {
          ...byAnother,
          objective: { ...byAnother.objective, caller: "merchant-typo" },
        } as never,
      ]),
    ).toThrow(
      "F01-01: its caller merchant-typo is not among the other merchants of supermarket",
    );
    expect(() =>
      casesFor(supermarket, [
        {
          ...valid,
          objective: {
            step: "notice",
            expect: "OK",
            caller: "another-merchant",
          },
        } as never,
      ]),
    ).toThrow("F01-01: another merchant goes with an event of the merchant");
  });

  it("takes the second sequence only with the flow that pays twice", () => {
    expect(() =>
      casesFor(supermarket, [{ ...valid, secondSequence: "same" } as never]),
    ).toThrow("F01-01: secondSequence goes with the payment-twice flow");
    expect(() =>
      casesFor(supermarket, [{ ...valid, flow: "payment-twice" } as never]),
    ).toThrow("F01-01: secondSequence goes with the payment-twice flow");
  });

  it("fails an objective that is not a step of its flow", () => {
    const secondPayment = {
      ...valid,
      objective: { step: "second-payment", expect: "R-102" },
    };
    expect(() => casesFor(supermarket, [secondPayment as never])).toThrow(
      "F01-01: the payment flow of supermarket has no second-payment step",
    );
  });

  it("sends a fixed reference without its amount when the case says null", () => {
    const [entry] = entriesOf({
      type: "single",
      amountType: "fixed",
      amount: null,
    });
    expect(entry?.reference).toEqual({ type: "single", amountType: "fixed" });
  });

  it("sends an open reference with an amount only from a case that expects the 400 of the creation", () => {
    const mistake = {
      ...valid,
      reference: { type: "single", amountType: "open", amount: 150.5 },
      objective: { step: "create", expect: 400 },
    };
    const [entry] = casesFor(supermarket, [mistake as never]);
    expect(entry?.reference).toEqual({
      type: "single",
      amountType: "open",
      amount: 150.5,
    });
  });

  it("fails an amount on an open reference, which PayRef would reject", () => {
    expect(() =>
      entriesOf({ type: "single", amountType: "open", amount: 150.5 }),
    ).toThrow("F01-01: reference.amount is only for a fixed reference");
  });

  it("fails a list that repeats a value", () => {
    expect(() =>
      entriesOf({ type: ["single", "single"], amountType: "fixed" }),
    ).toThrow("F01-01__supermarket__single-fixed comes out twice");
  });

  it("fails a time without its offset, which would be read in another zone", () => {
    const noOffset = { ...valid, time: "2026-11-15T23:59:59" };
    expect(() => loadCatalog(catalogWith({ "f06.json": [noOffset] }))).toThrow(
      /time/,
    );
    const withOffset = { ...valid, time: "2026-11-15T23:59:59-06:00" };
    expect(loadCatalog(catalogWith({ "f06.json": [withOffset] }))).toEqual([
      withOffset,
    ]);
  });

  it("fails a date that is not a date", () => {
    const wrongDate = {
      ...valid,
      reference: { ...valid.reference, expiresOn: "2099-13-01" },
    };
    expect(() => loadCatalog(catalogWith({ "f01.json": [wrongDate] }))).toThrow(
      /reference\.expiresOn/,
    );
  });

  it("keeps the real catalog valid", () => {
    const names = casesFor(supermarket).map((entry) => entry.name);
    expect(names).toContain("F01-01__supermarket__single-fixed");
    expect(names).toContain("F01-01__supermarket__recurring-open-2099-12-31");
  });

  it("says which integrations exist when one does not", () => {
    expect(() => loadIntegration("bank")).toThrow(
      'There is no integration "bank". The ones there are: supermarket',
    );
  });
});
