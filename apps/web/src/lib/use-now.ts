"use client";

import { useSyncExternalStore } from "react";

// One shared clock that ticks every 30 seconds while anything reads it.
let now = 0;
const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}

function getSnapshot() {
  if (now === 0) now = Date.now();
  return now;
}

/** The current time in the browser, or null while server rendering and hydrating. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
