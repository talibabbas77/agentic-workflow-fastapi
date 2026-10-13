"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
        icon={
          copied ? <CheckIcon aria-hidden="true" className="size-4" /> : <CopyIcon aria-hidden="true" className="size-4" />
        }
      >
        {copied ? "Copied" : "Copy"}
        <span className="sr-only"> {label}</span>
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied to the clipboard` : ""}
      </span>
    </>
  );
}
