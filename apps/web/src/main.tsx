import type { Decision } from "@countercheck/core";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "./Desk";
import { cases, FIRST_CASE } from "./data";
import { Evals } from "./Evals";
import { How } from "./How";
import "./styles.css";

type Route = { name: "desk"; id: string } | { name: "evals" } | { name: "how" };

function parse(hash: string): Route {
  const part = hash.replace(/^#\/?/, "");
  if (part === "evals") return { name: "evals" };
  if (part === "how") return { name: "how" };
  return { name: "desk", id: cases.some((c) => c.id === part) ? part : FIRST_CASE };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

function Wordmark() {
  return (
    <a href="#/" className="flex items-center gap-2 font-[800] text-[1.15rem] tracking-[-0.01em]">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="26"
          height="26"
          rx="4"
          fill="none"
          stroke="var(--color-hold)"
          strokeWidth="2.5"
        />
        <path
          d="M10 16.5l4 4 8-9"
          fill="none"
          stroke="var(--color-hold)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Countercheck
    </a>
  );
}

function App() {
  const route = useRoute();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const tab = (name: Route["name"], href: string, label: string) => (
    <a
      href={href}
      aria-current={route.name === name ? "page" : undefined}
      className={`rounded-[2px] px-2.5 py-1.5 font-[650] ${route.name === name ? "bg-paper shadow-sm" : "text-ink-soft hover:text-ink"}`}
    >
      {label}
    </a>
  );

  return (
    <div className="mx-auto max-w-[96rem] px-3 pb-12 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <Wordmark />
        <nav aria-label="Main" className="flex gap-1 text-[0.95rem]">
          {tab("desk", "#/", "Invoices")}
          {tab("evals", "#/evals", "Evals")}
          {tab("how", "#/how", "How it works")}
        </nav>
      </header>
      {route.name === "desk" && (
        <>
          <p className="mb-4 max-w-[52rem] text-[1.05rem] text-ink">
            Supplier invoices, checked against the order and the delivery before anyone pays them.
            Pick one from the tray, check it, and make the call.
          </p>
          <Desk
            caseId={route.id}
            onSelect={(id) => {
              location.hash = `#/${id}`;
            }}
            decisions={decisions}
            onDecide={(id, d) => setDecisions((all) => ({ ...all, [id]: d }))}
          />
        </>
      )}
      {route.name === "evals" && <Evals />}
      {route.name === "how" && <How />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
