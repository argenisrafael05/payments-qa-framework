import type { OperationTemplate } from "../../engine/http.ts";
import { businessCodes } from "../codes.ts";

// How to read PayRef's core contract (3.1): the defaults of the API and what each operation
// adds. Every standard integration shares it. Its codes are already PayRef's, so the
// dictionary translates each one to itself.
const codes = Object.fromEntries(businessCodes.map((code) => [code, code]));

function operation(details: {
  requires: string[];
  repeatable: boolean;
  secrets?: OperationTemplate["secrets"];
}): OperationTemplate {
  return {
    businessStatus: 200,
    codeField: "code",
    success: { code: "OK", requires: details.requires },
    codes,
    stateField: "status",
    secrets: details.secrets,
    repeatable: details.repeatable,
  };
}

export const coreApi = {
  token: operation({
    requires: ["token"],
    repeatable: true,
    secrets: { request: ["key"], response: ["token"] },
  }),
  createReference: operation({ requires: ["reference"], repeatable: false }),
  viewReference: operation({
    requires: ["reference", "status"],
    repeatable: true,
  }),
  cancelReference: operation({ requires: ["reference"], repeatable: false }),
  inquiry: operation({ requires: ["reference"], repeatable: true }),
  // A payment is a success only with its folio and its authorization.
  payment: operation({
    requires: ["folio", "authorization"],
    repeatable: false,
  }),
};
