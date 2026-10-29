import { regionDate } from "./clock.ts";
import type { PaymentMethodConfig, RegionConfig } from "./config.ts";
import { rejections } from "./errors.ts";

type Rejection = (typeof rejections)[keyof typeof rejections];

type PayableReference = {
  amountType: "fixed" | "open";
  amount: number | null;
};

// The expiry (8.3): a reference is paid until 23:59:59 of its day, in the time of its region.
export function checkExpiry(
  expiresOn: string | null,
  now: Date,
  region: RegionConfig,
  bugs: ReadonlySet<number>,
): Rejection | undefined {
  if (expiresOn === null) {
    return undefined;
  }
  const today = regionDate(now, region.utcOffset);
  // Bug 3: the reference expires a day early.
  const expired = bugs.has(3) ? today >= expiresOn : today > expiresOn;
  return expired ? rejections.expired : undefined;
}

// The amount of a payment (HU-08). Whatever makes it invalid, the answer is R-104, and it is
// never rounded: zero or negative, more decimals than its region, other than the fixed amount,
// or outside the limits of the payment method for an open reference.
export function checkAmount(
  amount: number,
  reference: PayableReference,
  method: PaymentMethodConfig,
  region: RegionConfig,
  bugs: ReadonlySet<number>,
): { amount: number } | { rejection: Rejection } {
  let paid = amount;
  if (decimalsOf(amount) > region.decimals) {
    if (!bugs.has(2)) {
      return { rejection: rejections.invalidAmount };
    }
    // Bug 2: an amount with more decimals than its region is rounded, and accepted.
    const scale = 10 ** region.decimals;
    paid = Math.round(amount * scale) / scale;
  }
  const valid =
    paid > 0 &&
    (reference.amountType === "fixed"
      ? paid === reference.amount
      : paid >= method.amountLimits.min && paid <= method.amountLimits.max);
  return valid ? { amount: paid } : { rejection: rejections.invalidAmount };
}

// The decimals of the amount as it came, also when it is written with an exponent.
function decimalsOf(amount: number): number {
  const [mantissa = "", exponent = "0"] = String(amount)
    .toLowerCase()
    .split("e");
  const decimals = (mantissa.split(".")[1] ?? "").length - Number(exponent);
  return Math.max(0, decimals);
}
