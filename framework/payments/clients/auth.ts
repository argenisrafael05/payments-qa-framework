import type { Exchange, Http } from "../../engine/http.ts";
import { coreApi } from "../policies/core.ts";

// The auth is the same for every caller: a key goes in and a token comes out.
export function requestToken(http: Http, key: string): Promise<Exchange> {
  return http.call(coreApi.token, {
    method: "POST",
    path: "/auth/token",
    body: { key },
  });
}
