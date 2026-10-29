// Money is stored and computed as integer paise to avoid floating-point drift.

const AMOUNT_PATTERN = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

/** Parses a rupee amount string such as "1234.5" into paise. Returns null when invalid. */
export function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  const match = AMOUNT_PATTERN.exec(trimmed);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const paise = rupees * 100 + Number(fraction);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Formats paise as an amount string with exactly two decimals and no grouping ("1234.50"). */
export function paiseToPlain(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompactFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 2,
});

/** Formats paise in Indian grouping, e.g. ₹1,23,456.00 */
export function formatINR(paise: number): string {
  return inrFormatter.format(paise / 100);
}

/** Short form for headline figures, e.g. ₹1.2L or ₹3.4Cr */
export function formatINRCompact(paise: number): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1e7) return `₹${trimZeros((rupees / 1e7).toFixed(2))} Cr`;
  if (abs >= 1e5) return `₹${trimZeros((rupees / 1e5).toFixed(2))} L`;
  return inrCompactFormatter.format(rupees);
}

function trimZeros(value: string): string {
  return value.replace(/\.?0+$/, "");
}

const countFormatter = new Intl.NumberFormat("en-IN");

export function formatCount(value: number): string {
  return countFormatter.format(value);
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}
