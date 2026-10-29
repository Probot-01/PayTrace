/**
 * Normalises URL search params for schema parsing: GET forms submit empty strings for untouched
 * fields ("Any status"), and a repeated key arrives as an array. Both are dropped so they mean "no filter".
 */
export function nonEmptyParams(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim() !== "") out[k] = v;
  return out;
}
