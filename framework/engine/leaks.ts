// What a response must never show, whatever its status: it fails the step even when the
// expected code came. It is checked on the raw body, before anything is decoded, so it also
// finds a stack trace escaped inside a JSON string.
const leaks = [
  {
    name: "a stack trace",
    pattern:
      /\bat\s+(?:async\s+)?(?:\S+\s+\()?(?:file:\/\/|node:|\/)[^\s)"]*:\d+:\d+/,
  },
  {
    name: "SQL",
    pattern:
      /\b(?:SELECT\s[\s\S]+?\sFROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b|\bER_[A-Z_]{3,}\b|SQL syntax|Unknown column '|Duplicate entry '|\bTable '[^']+' doesn't exist/,
  },
  {
    name: "an internal path",
    pattern: /\/Users\/|\/home\/|node_modules[/\\]|\.(?:ts|js|mjs|cjs):\d+/,
  },
  {
    name: "an internal error code",
    pattern: /\b(?:FST|ERR)_[A-Z_]{3,}\b/,
  },
] as const;

export function findLeak(body: string): string | undefined {
  return leaks.find((leak) => leak.pattern.test(body))?.name;
}
