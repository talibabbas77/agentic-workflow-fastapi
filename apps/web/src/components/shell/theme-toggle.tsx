"use client";

import { CheckIcon, DesktopIcon, MoonIcon, SunIcon, type Icon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { PopoverMenu, MenuItem } from "@/components/ui/popover-menu";

const options: { value: "light" | "dark" | "system"; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: DesktopIcon },
];

const noop = () => () => {};

/** True after hydration. The stored theme is only known in the browser. */
function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? (options.find((o) => o.value === theme) ?? options[2]!) : options[2]!;
  const CurrentIcon = current.icon;

  return (
    <PopoverMenu
      label="Theme"
      align="end"
      className="w-40"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Theme: ${current.label}`}
          className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <CurrentIcon aria-hidden="true" className="size-[18px]" />
        </button>
      )}
    >
      {(close) =>
        options.map((option) => {
          const OptionIcon = option.icon;
          const selected = mounted && theme === option.value;
          return (
            <MenuItem
              key={option.value}
              aria-pressed={selected}
              icon={<OptionIcon aria-hidden="true" className="size-4 text-ink-muted" />}
              onClick={() => {
                setTheme(option.value);
                close();
              }}
            >
              <span className="flex-1">{option.label}</span>
              {selected ? <CheckIcon aria-hidden="true" className="size-4 text-ink" weight="bold" /> : null}
            </MenuItem>
          );
        })
      }
    </PopoverMenu>
  );
}
