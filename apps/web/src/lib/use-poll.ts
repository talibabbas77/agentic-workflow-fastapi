"use client";

import { useEffect, useRef } from "react";

/**
 * Call `refresh` every `everyMs` while `active` is true. Nothing runs while the
 * tab is hidden; coming back refreshes right away. Calls never overlap.
 */
export function usePoll(active: boolean, refresh: () => Promise<void>, everyMs = 2000) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    let running = false;

    const run = async () => {
      if (running) return;
      running = true;
      try {
        await latest.current();
      } finally {
        running = false;
      }
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(run, everyMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
      } else {
        run();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, everyMs]);
}
