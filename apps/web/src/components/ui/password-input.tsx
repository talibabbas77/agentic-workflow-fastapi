"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState, type ComponentProps } from "react";
import { Button } from "./button";
import { Input } from "./field";

export function PasswordInput(props: Omit<ComponentProps<"input">, "type" | "className">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className="pr-11" {...props} />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute top-0.5 right-0.5"
      >
        {visible ? (
          <EyeSlashIcon aria-hidden="true" className="size-4.5" />
        ) : (
          <EyeIcon aria-hidden="true" className="size-4.5" />
        )}
      </Button>
    </div>
  );
}
