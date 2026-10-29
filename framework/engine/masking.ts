// The masking of RNF-05: the credentials are hidden and the business identifiers stay
// visible. The judge always reads the original, and only the copy in the evidence is masked.

export const hidden = "[hidden]";

export function maskHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    masked[name] =
      name.toLowerCase() === "authorization"
        ? value.replace(/^(\w+\s+)?.*$/, `$1${hidden}`)
        : value;
  }
  return masked;
}

// A JSON body is kept as JSON, with its secret fields hidden. Anything else stays as it came,
// because a body that is not JSON is evidence too.
export function maskBody(
  body: string | undefined,
  secrets: readonly string[] = [],
): unknown {
  if (body === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }
  const masked: Record<string, unknown> = { ...parsed };
  for (const field of secrets) {
    if (field in masked) {
      masked[field] = hidden;
    }
  }
  return masked;
}
