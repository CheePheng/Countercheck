// Browser smoke test of the built app (no Workers AI calls: it replays recorded readings).
// Usage: node scripts/smoke.mjs <base url>   (set PLAYWRIGHT_CHANNEL=msedge to use an installed Edge)
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:4173").replace(/\/+$/, "");
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test-results", "smoke");
mkdirSync(out, { recursive: true });

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};
const errors = [];
const watch = (page, tag) => {
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => {
    // Preview has no remote Workers AI; failed /api calls are expected there.
    if (m.type() === "error" && !m.location().url.includes("/api/"))
      errors.push(`${tag}: ${m.text()}`);
  });
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {},
);
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    watch(page, `${width}px`);
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    check(
      `${width}px: the in-tray lists the invoices`,
      (await page.locator("nav[aria-label='Invoices in the tray'] li").count()) >= 20,
    );
    await page.getByRole("button", { name: "Check this invoice" }).click();
    await page.locator("section:has(h3:text-is('Your call'))").waitFor({ timeout: 10_000 });
    check(
      `${width}px: checking shows a recommendation`,
      /Ready to approve|Hold it|Reject it/.test(
        (await page.locator("header[aria-live]").textContent()) ?? "",
      ),
    );
    check(
      `${width}px: evidence is highlighted on the invoice`,
      (await page.locator(".mark").count()) > 5,
    );
    await page.locator("section:has(h3:text-is('Your call')) button").first().click();
    check(
      `${width}px: the decision lands as a stamp`,
      (await page.locator("svg.stamp").count()) === 1,
    );
    check(
      `${width}px: the known answer is shown after deciding`,
      /known answer/.test(
        (await page.locator("section:has(h3:text-is('Your decision'))").textContent()) ?? "",
      ),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${width}px: no horizontal scroll`, overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: join(out, `desk-${width}.png`), fullPage: width < 600 });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, "pages");
  await page.goto(`${base}/#/evals`, { waitUntil: "networkidle" });
  check("evals page shows the results table", (await page.locator("table tbody tr").count()) >= 1);
  await page.screenshot({ path: join(out, "evals.png"), fullPage: true });
  await page.goto(`${base}/#/how`, { waitUntil: "networkidle" });
  check("how-it-works page lists the steps", (await page.locator("ol > li").count()) >= 4);
} finally {
  await browser.close();
}

check("no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(
  failures.length ? `${failures.length} checks failed` : `smoke test passed against ${base}`,
);
process.exitCode = failures.length ? 1 : 0;
