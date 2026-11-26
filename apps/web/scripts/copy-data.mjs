// Copies the sample invoices (PDF, picture, text layer) into public/data, where both the app
// and the Worker's asset binding can read them. The known answers are not copied: the app
// imports them into its bundle, and the Worker never reads them.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(web, "..", "..", "data");
const out = join(web, "public", "data");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(data, "cases"), join(out, "cases"), { recursive: true });
cpSync(join(data, "cases.json"), join(out, "cases.json"));
