// Secrets are not in the generated worker-configuration.d.ts; declare them here.
interface Env {
  /** Optional secret (`wrangler secret put RECORDER_KEY`): marks eval and recording calls. */
  RECORDER_KEY?: string;
}
declare namespace Cloudflare {
  interface Env {
    RECORDER_KEY?: string;
  }
}
