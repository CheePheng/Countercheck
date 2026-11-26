/** Normalisation shared by the checks: names, units, ids and money. */

const COMPANY_SUFFIXES =
  /\b(sdn\.?\s*bhd\.?|sendirian berhad|berhad|bhd|pte\.?\s*ltd\.?|private limited|ltd|limited|co|company|enterprise|trading)\b/g;

/** "Orchidfold Packaging Sdn. Bhd." and "ORCHIDFOLD PACKAGING" compare equal. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,()'’"-]/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Invoice and PO numbers: case, spaces and separators don't count ("inv 2291" = "INV-2291"). */
export function normalizeId(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Bank account numbers compare on digits only. */
export function normalizeAccount(account: string): string {
  return account.replace(/\D/g, "");
}

const UNIT_ALIASES: Record<string, string> = {
  box: "box",
  boxes: "box",
  bx: "box",
  kotak: "box",
  pc: "pcs",
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  unit: "pcs",
  units: "pcs",
  ea: "pcs",
  each: "pcs",
  unitpcs: "pcs",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  pack: "pack",
  packs: "pack",
  pkt: "pack",
  packet: "pack",
  packets: "pack",
  ctn: "carton",
  carton: "carton",
  cartons: "carton",
  btl: "bottle",
  bottle: "bottle",
  bottles: "bottle",
  botol: "bottle",
  l: "litre",
  ltr: "litre",
  litre: "litre",
  litres: "litre",
  liter: "litre",
  liters: "litre",
  roll: "roll",
  rolls: "roll",
  set: "set",
  sets: "set",
};

/** "Boxes", "bx" and "kotak" are all "box"; unknown units pass through lower-cased. */
export function normalizeUnit(unit: string): string {
  const key = unit.toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_ALIASES[key] ?? key;
}

/** Round to cents. */
export function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Equal within half a cent per unit of rounding (default one cent). */
export function sameMoney(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9;
}

export function formatMoney(value: number, currency?: string): string {
  const text = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return currency ? `${currency} ${text}` : text;
}

const WORD = /[a-z0-9]+/g;
const STOP = new Set(["of", "the", "and", "for", "with", "a", "x", "per", "dan", "untuk"]);

/** Word overlap between two item descriptions, 0 to 1 (Jaccard on words). */
export function descriptionSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w) && w.length > 1));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/** Days from a to b (ISO dates). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
