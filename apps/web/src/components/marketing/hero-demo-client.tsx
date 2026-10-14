"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ScenarioId = "anonymous" | "ana" | "person";

export type ScenarioOption = { id: ScenarioId; title: string; sub: string; summary: string; signedIn: boolean };

/*
 * Phases of one play: 0 the question, 1 typing, 2 the answer, 3 sources and
 * notes. Which steps show for a phase is decided in CSS from data-phase and
 * each step's data-at (see .mk-scenario in globals.css), so the conversations
 * themselves stay server-rendered. The server renders phase 1, the question
 * and the typing dots, so the first play continues from there without a flash.
 */
const FINAL = 3;
const TIMING = { ask: 380, typing: 650, details: 360 };

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clear(timers: number[]) {
  timers.forEach((t) => window.clearTimeout(t));
  timers.length = 0;
}

/** Step through the phases from `from`, or jump to the end when motion is reduced. */
function schedule(from: number, setPhase: (phase: number) => void, timers: number[]) {
  clear(timers);
  if (reducedMotion()) {
    setPhase(FINAL);
    return;
  }
  setPhase(from);
  let at = 0;
  if (from <= 0) {
    at += TIMING.ask;
    timers.push(window.setTimeout(() => setPhase(1), at));
  }
  at += TIMING.typing;
  timers.push(window.setTimeout(() => setPhase(2), at));
  at += TIMING.details;
  timers.push(window.setTimeout(() => setPhase(FINAL), at));
}

/**
 * The state of the hero demo: which visitor is asking and how far the reply
 * has played. Every piece of content arrives from the server as props.
 */
export function HeroDemoClient({
  options,
  conversations,
  knows,
  close,
}: {
  options: ScenarioOption[];
  conversations: Record<ScenarioId, ReactNode>;
  knows: { anonymous: ReactNode; signedIn: ReactNode };
  close: ReactNode;
}) {
  const [scenario, setScenario] = useState<ScenarioId>("anonymous");
  const [phase, setPhase] = useState(1);
  const [run, setRun] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const seen = useRef(false);

  // First play: when the demo is first on screen, finish the typing it was server rendered with.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const pending = timers.current;
    if (typeof IntersectionObserver === "undefined") {
      pending.push(window.setTimeout(() => setPhase(FINAL), 0));
      return () => clear(pending);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || seen.current) return;
        seen.current = true;
        observer.disconnect();
        schedule(1, setPhase, pending);
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clear(pending);
    };
  }, []);

  function choose(id: ScenarioId) {
    if (id === scenario) return;
    seen.current = true;
    setScenario(id);
    setRun((r) => r + 1);
    setInteracted(true);
    schedule(0, setPhase, timers.current);
  }

  const current = options.find((option) => option.id === scenario)!;

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-4" data-testid="hero-demo">
      <fieldset className="min-w-0">
        <legend className="sr-only">Who is asking</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface-2 p-1">
          {options.map((option) => {
            const checked = option.id === scenario;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border px-2.5 py-2 transition-colors duration-150 sm:px-3",
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-rust",
                  checked ? "border-line-strong bg-surface" : "border-transparent hover:bg-surface/60",
                )}
              >
                <input
                  type="radio"
                  name="hero-demo-scenario"
                  value={option.id}
                  checked={checked}
                  onChange={() => choose(option.id)}
                  className="sr-only"
                />
                <span className={cn("text-sm font-medium", checked ? "text-ink" : "text-ink-muted")}>
                  {option.title}
                  <span className="sr-only">,</span>
                </span>
                <span className="text-xs text-ink-muted">{option.sub}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <figure className="flex min-w-0 flex-col gap-3">
        <div className="relative rounded-lg border border-line-strong bg-surface">
          {/* The bookmark from the logo, rising above the panel like the ribbon above the bubble. */}
          <span aria-hidden="true" className="mk-ribbon absolute -top-2 right-16 h-8 w-4" />
          <div className="flex items-center gap-3 rounded-t-lg border-b border-line bg-surface py-3 pr-3 pl-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-md font-semibold tracking-[-0.02em] text-ink">
                Lumen Notes <span className="font-normal text-ink-muted">(example)</span>
              </p>
              <p key={current.signedIn ? "in" : "out"} className="mk-swap truncate text-sm text-ink-muted">
                {current.signedIn ? "Signed in as Ana" : "Help center"}
              </p>
            </div>
            <span aria-hidden="true" className="inline-flex size-8 items-center justify-center text-ink-muted">
              {close}
            </span>
          </div>

          <div className="grid bg-paper px-4 py-5 [grid-template-areas:'stack']">
            {options.map((option) => {
              const active = option.id === scenario;
              return (
                <div
                  key={active ? `${option.id}-${run}` : option.id}
                  className={cn("mk-scenario [grid-area:stack]", !active && "invisible")}
                  aria-hidden={active ? undefined : true}
                  inert={!active}
                  data-phase={active ? phase : FINAL}
                  data-active={active || undefined}
                >
                  {conversations[option.id]}
                </div>
              );
            })}
          </div>

          <div aria-hidden="true" className="flex items-center gap-2 rounded-b-lg border-t border-line bg-surface p-3">
            <span className="flex h-9 flex-1 items-center rounded-md border border-line-strong bg-paper px-3 text-base text-ink-muted">
              Ask a question
            </span>
            <span className="inline-flex h-9 items-center rounded-md bg-rust px-3.5 text-base font-medium text-on-rust">
              Send
            </span>
          </div>
        </div>

        <div key={current.signedIn ? "in" : "out"} className="mk-swap">
          {current.signedIn ? knows.signedIn : knows.anonymous}
        </div>

        <figcaption className="text-sm text-ink-muted">
          Example with fictional data. Lumen Notes and Ana are not real.
        </figcaption>
      </figure>

      <p className="sr-only" aria-live="polite">
        {interacted && phase === FINAL ? current.summary : ""}
      </p>
    </div>
  );
}
