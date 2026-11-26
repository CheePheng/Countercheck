import type { Decision } from "@countercheck/core";
import type { FieldCheck, Page } from "@countercheck/extract";
import { useMemo } from "react";

interface Mark {
  key: string;
  field: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confirmed: boolean;
  order: number;
}

/** How much of the page to show: down to the last printed line, plus a margin. */
function visibleHeight(page: Page): number {
  const bottom = Math.max(...page.words.map((w) => w.bottom));
  return Math.min(page.height, bottom + 44);
}

/** One mark per line of text a quote covers, in percent of the visible page. */
function marksFor(page: Page, checks: FieldCheck[]): Mark[] {
  const height = visibleHeight(page);
  const marks: Mark[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    const lines = new Map<number, number[]>();
    for (const i of check.words) {
      const top = Math.round(page.words[i]!.top);
      lines.set(top, [...(lines.get(top) ?? []), i]);
    }
    for (const words of lines.values()) {
      const boxes = words.map((i) => page.words[i]!);
      const x0 = Math.min(...boxes.map((b) => b.x0)) - 1.5;
      const x1 = Math.max(...boxes.map((b) => b.x1)) + 1.5;
      const top = Math.min(...boxes.map((b) => b.top)) - 1;
      const bottom = Math.max(...boxes.map((b) => b.bottom)) + 1;
      const key = `${check.field}:${x0.toFixed(1)}:${top.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      marks.push({
        key,
        field: check.field,
        left: (x0 / page.width) * 100,
        top: (top / height) * 100,
        width: ((x1 - x0) / page.width) * 100,
        height: ((bottom - top) / height) * 100,
        confirmed: check.status === "verified",
        order: marks.length,
      });
    }
  }
  return marks;
}

const STAMP: Record<Decision, { word: string; ink: string }> = {
  approve: { word: "APPROVED", ink: "var(--color-approve)" },
  hold: { word: "ON HOLD", ink: "var(--color-hold)" },
  reject: { word: "REJECTED", ink: "var(--color-hold)" },
};

export function Stamp({
  decision,
  date,
  land,
}: {
  decision: Decision;
  date: string;
  land: boolean;
}) {
  const { word, ink } = STAMP[decision];
  return (
    <svg
      className="stamp pointer-events-none absolute left-[73%] top-[84%] w-[34%]"
      style={{
        ["--tilt" as string]: "-8deg",
        transform: "translate(-50%, -50%) rotate(-8deg)",
        opacity: 0.9,
        mixBlendMode: "multiply",
      }}
      data-land={land}
      viewBox="0 0 300 120"
      role="img"
      aria-label={`Stamped ${word.toLowerCase()}`}
    >
      <defs>
        <filter id="ink">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.45"
            result="holes"
          />
          <feComposite in="SourceGraphic" in2="holes" operator="in" />
        </filter>
      </defs>
      <g filter="url(#ink)" fill="none" stroke={ink}>
        <rect x="6" y="6" width="288" height="108" rx="10" strokeWidth="6" />
        <rect x="16" y="16" width="268" height="88" rx="5" strokeWidth="2" />
        <text
          x="150"
          y="70"
          textAnchor="middle"
          fill={ink}
          stroke="none"
          style={{ font: "900 54px var(--font-stamp)", letterSpacing: "0.04em" }}
        >
          {word}
        </text>
        <text
          x="150"
          y="94"
          textAnchor="middle"
          fill={ink}
          stroke="none"
          style={{ font: "700 17px var(--font-stamp)", letterSpacing: "0.18em" }}
        >
          {date}
        </text>
      </g>
    </svg>
  );
}

export function Paper({
  page,
  image,
  alt,
  checks,
  sweep,
  focus,
  issues,
  stamp,
}: {
  page: Page | null;
  image: string;
  alt: string;
  checks: FieldCheck[] | null;
  sweep: boolean;
  focus: string | null;
  /** Fields the checks raised a finding about ("bank.accountNumber", "lines[0].unitPrice"). */
  issues: string[];
  stamp: { decision: Decision; date: string; land: boolean } | null;
}) {
  const covers = (markField: string, field: string) =>
    field === markField || field.startsWith(`${markField}.`) || markField.startsWith(`${field}.`);
  const marks = useMemo(() => (page && checks ? marksFor(page, checks) : []), [page, checks]);
  const height = page ? visibleHeight(page) : 842;
  const ratio = page ? `${page.width} / ${height}` : "595 / 842";

  return (
    <div className="paper relative w-full overflow-hidden" style={{ aspectRatio: ratio }}>
      <img
        src={image}
        alt={alt}
        className="absolute inset-x-0 top-0 w-full select-none"
        style={{ height: page ? `${(page.height / height) * 100}%` : "100%" }}
        draggable={false}
      />
      {marks.map((m) => (
        <span
          key={m.key}
          className="mark"
          data-state={m.confirmed ? "confirmed" : "unconfirmed"}
          data-focus={focus !== null && covers(m.field, focus)}
          data-issue={issues.some((f) => covers(m.field, f))}
          data-sweep={sweep}
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            width: `${m.width}%`,
            height: `${m.height}%`,
            animationDelay: sweep ? `${m.order * 55}ms` : undefined,
          }}
        />
      ))}
      {stamp && <Stamp decision={stamp.decision} date={stamp.date} land={stamp.land} />}
    </div>
  );
}
