import { normalizeCurrency } from "@countercheck/core";

export function money(n: number, printedCurrency?: string): string {
  const text = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!printedCurrency) return text;
  const code = normalizeCurrency(printedCurrency);
  return `${code === "MYR" ? "RM" : code === "SGD" ? "S$" : `${printedCurrency} `}${text}`;
}

export function price(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function quantity(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
