// PayRef's business codes, as its contract publishes them. The framework keeps its own list,
// because it never imports PayRef's code.
export const businessCodes = [
  "OK",
  "R-101",
  "R-102",
  "R-103",
  "R-104",
  "R-105",
  "R-106",
  "R-107",
  "R-108",
] as const;

export type BusinessCode = (typeof businessCodes)[number];
