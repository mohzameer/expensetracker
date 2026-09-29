// Money is always integer minor units (1 Rs = 100). Parsing is string-based so
// "0.1 + 0.2" style float errors can never reach the database.

export const MINOR = 100;

/** Parse user input like "1,800", "1800.5" or "Rs 12,400.75" into minor units. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned || !/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === ".") return null;
  const [whole, frac = ""] = cleaned.split(".");
  const minor = Number(whole || "0") * MINOR + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1240000 → "12,400"; 180050 → "1,800.50". Negative values keep their sign. */
export function formatAmount(minor: number): string {
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / MINOR);
  const frac = abs % MINOR;
  return `${sign}${grouped.format(whole)}${frac ? "." + String(frac).padStart(2, "0") : ""}`;
}

/** 1240000 → "Rs 12,400"; -135000 → "−Rs 1,350". */
export function formatMoney(minor: number, symbol = "Rs"): string {
  const sign = minor < 0 ? "−" : "";
  return `${sign}${symbol} ${formatAmount(Math.abs(minor))}`;
}

/** Value to prefill an amount input with (no grouping, no symbol). */
export function toInputValue(minor: number | null | undefined): string {
  if (minor == null) return "";
  const whole = Math.trunc(minor / MINOR);
  const frac = minor % MINOR;
  return frac ? `${whole}.${String(frac).padStart(2, "0")}` : String(whole);
}
