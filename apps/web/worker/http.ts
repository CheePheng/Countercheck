export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/**
 * The visitor's network, not their address: the first three parts of an IPv4 address or
 * the first three groups of an IPv6 one. It is only ever hashed with a key that changes daily.
 */
export function visitorNetwork(ip: string | null): string {
  if (!ip) return "unknown";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":");
  return ip.split(".").slice(0, 3).join(".");
}

export class TimeoutError extends Error {}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Workers AI error 4006: the account's free daily allocation is used up. */
export function isAllowanceError(err: unknown): boolean {
  return /\b4006\b|daily free allocation|neurons? (limit|allocation)/i.test(String(err));
}
