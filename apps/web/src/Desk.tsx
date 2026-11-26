import { checkInvoice, type Decision } from "@countercheck/core";
import { type Page, verifyExtraction } from "@countercheck/extract";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiErrorBody, Reading, ReadResponse, StatusResponse } from "./api-types";
import { cases, hasRecording, loadPage, loadRecording, truths, world } from "./data";
import { money, shortDate } from "./format";
import { Paper } from "./Paper";
import { Voucher } from "./Voucher";

type Phase = "idle" | "reading" | "checked";
type Live =
  | { state: "idle" }
  | { state: "running"; started: number }
  | { state: "failed"; message: string };

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const today = new Date()
  .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  .toUpperCase();

function Tray({
  current,
  decisions,
  onSelect,
}: {
  current: string;
  decisions: Record<string, Decision>;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Invoices in the tray">
      <h2 className="mb-2 flex items-baseline justify-between px-1 font-[750]">
        In-tray{" "}
        <span className="text-[0.85rem] font-[500] text-ink-soft">{cases.length} invoices</span>
      </h2>
      <ol className="flex gap-2 overflow-x-auto pb-2 lg:block lg:max-h-[calc(100dvh-9rem)] lg:space-y-1.5 lg:overflow-y-auto lg:pb-0">
        {cases.map((c) => {
          const inv = truths.get(c.id)!.invoice;
          const selected = c.id === current;
          const mine = decisions[c.id];
          return (
            <li key={c.id} className="shrink-0 basis-[15rem] lg:basis-auto">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={selected ? "true" : undefined}
                className={`w-full rounded-[2px] px-3 py-2 text-left transition-colors ${
                  selected ? "paper" : "bg-desk-deep/40 hover:bg-paper/70"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-[650]">{inv.vendorName}</span>
                  {mine && (
                    <span
                      className={`shrink-0 text-[0.78rem] font-[800] ${mine === "approve" ? "text-approve" : "text-hold"}`}
                    >
                      {mine === "approve" ? "Approved" : mine === "hold" ? "On hold" : "Rejected"}
                    </span>
                  )}
                </span>
                <span className="tnum flex justify-between gap-2 text-[0.85rem] text-ink-soft">
                  <span>
                    {inv.invoiceNumber}, {shortDate(inv.invoiceDate)}
                  </span>
                  <span className="text-ink">{money(inv.total, inv.currency)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Desk({
  caseId,
  onSelect,
  decisions,
  onDecide,
}: {
  caseId: string;
  onSelect: (id: string) => void;
  decisions: Record<string, Decision>;
  onDecide: (id: string, d: Decision) => void;
}) {
  const info = cases.find((c) => c.id === caseId) ?? cases[0]!;
  const truth = truths.get(info.id)!;
  const [page, setPage] = useState<Page | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [focus, setFocus] = useState<string | null>(null);
  const [live, setLive] = useState<Live>({ state: "idle" });
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [landed, setLanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setPage(null);
    setReading(null);
    setPhase("idle");
    setFocus(null);
    setLive({ state: "idle" });
    setLanded(false);
    let gone = false;
    loadPage(info.id).then((p) => !gone && setPage(p));
    loadRecording(info.id)?.then((r) => !gone && setReading(r));
    return () => {
      gone = true;
      clearTimeout(timer.current);
    };
  }, [info.id]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? (r.json() as Promise<StatusResponse>) : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const analysis = useMemo(() => {
    if (!page || !reading?.extraction) return null;
    const v = verifyExtraction(reading.extraction, page);
    return { v, r: checkInvoice({ invoice: v.invoice, world, unverified: v.unverified }) };
  }, [page, reading]);

  function play() {
    const marks = analysis?.v.checks.reduce((n, c) => n + (c.words.length ? 1 : 0), 0) ?? 0;
    setPhase("reading");
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setPhase("checked"),
      prefersReducedMotion() ? 0 : Math.min(1800, 500 + marks * 55),
    );
  }

  async function readLive() {
    setLive({ state: "running", started: Date.now() });
    try {
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case: info.id, model: "gemma-4" }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const message = (body as Partial<ApiErrorBody>).error?.message ?? `HTTP ${res.status}`;
        setLive({ state: "failed", message });
        return;
      }
      const { meter, ...fresh } = body as ReadResponse;
      setStatus((s) => (s ? { ...s, live: meter } : s));
      setLive({ state: "idle" });
      setReading(fresh);
      setLanded(false);
      play();
    } catch {
      setLive({ state: "failed", message: "The reading didn't reach the server. Try again." });
    }
  }

  const decided = decisions[info.id] ?? null;
  const showMarks = phase !== "idle";
  const canLive =
    status?.live.live && status.live.visitorCallsLeft > 0 && status.live.available >= 100;
  const liveControl = (
    <div className="space-y-1">
      <button
        type="button"
        disabled={!canLive || live.state === "running"}
        onClick={readLive}
        className="rounded-[3px] border border-ink/30 px-3 py-2 font-[650] hover:border-ink disabled:opacity-50"
      >
        {live.state === "running" ? "Reading… about 20 seconds" : "Read it again, live"}
      </button>
      <p className="text-[0.85rem] text-ink-soft">
        {status
          ? status.live.live
            ? `Gemma 4 reads it now on Cloudflare Workers AI. ${status.live.visitorCallsLeft} live readings left for you today.`
            : "Live readings are off for now; the recorded ones still work."
          : "Live readings need the app's server."}
        {live.state === "failed" && <span className="block text-hold">{live.message}</span>}
      </p>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start">
      {/* min-w-0 lets the tray scroll sideways on phones instead of widening the page. */}
      <div className="min-w-0 lg:sticky lg:top-4">
        <Tray current={info.id} decisions={decisions} onSelect={onSelect} />
      </div>

      <div className="min-w-0">
        <Paper
          page={page}
          image={`/data/${info.image}`}
          alt={`Invoice ${truth.invoice.invoiceNumber} from ${truth.invoice.vendorName}`}
          checks={showMarks ? (analysis?.v.checks ?? null) : null}
          sweep={phase === "reading"}
          focus={focus}
          issues={
            phase === "checked" && analysis
              ? analysis.r.findings.flatMap((f) => (f.field ? [f.field] : []))
              : []
          }
          stamp={decided ? { decision: decided, date: today, land: landed } : null}
        />
        <p className="mt-2 text-[0.85rem] text-ink-soft">
          <a
            className="underline hover:text-ink"
            href={`/data/${info.pdf}`}
            target="_blank"
            rel="noopener"
          >
            Open the invoice PDF
          </a>
          , an invented invoice for this demo.
        </p>
      </div>

      <div className="min-w-0 lg:sticky lg:top-4">
        {phase === "checked" && analysis && reading ? (
          <div className="reveal">
            <Voucher
              truth={truth}
              reading={reading}
              checks={analysis.v.checks}
              invoice={analysis.v.invoice}
              result={analysis.r}
              decided={decided}
              onDecide={(d) => {
                setLanded(true);
                onDecide(info.id, d);
              }}
              onFocus={setFocus}
              onNext={() => {
                const i = cases.findIndex((c) => c.id === info.id);
                onSelect(cases[(i + 1) % cases.length]!.id);
              }}
              live={liveControl}
            />
          </div>
        ) : (
          <div className="paper px-5 py-5 sm:px-6">
            <p className="text-[1.35rem] leading-tight font-[800]">
              {truth.invoice.vendorName} wants {money(truth.invoice.total, truth.invoice.currency)}.
            </p>
            <p className="mt-2 text-ink-soft">
              Before anyone pays, Countercheck reads the invoice, finds every value on the page, and
              checks it against the purchase order, what was delivered, and what was paid before.
            </p>
            {reading && reading.extraction === null && (
              <p className="mt-3 text-hold">The recorded reading failed: {reading.error}</p>
            )}
            <div className="mt-4">
              {hasRecording(info.id) ? (
                <button
                  type="button"
                  onClick={play}
                  disabled={!analysis || phase === "reading"}
                  className="rounded-[3px] bg-ink px-5 py-3 text-[1.05rem] font-[750] text-paper hover:bg-ink/85 disabled:opacity-60"
                >
                  {phase === "reading" ? "Checking…" : "Check this invoice"}
                </button>
              ) : (
                liveControl
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
