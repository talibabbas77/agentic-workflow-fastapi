import { cn } from "@/lib/cn";
import { BUBBLE, RIBBON } from "./logo";

/**
 * Branded loader for moments with no layout to sketch yet, such as the first
 * paint of the app while the session loads. The bubble outline draws itself,
 * fills, and the bookmark drops in, then the loop repeats. Pure SVG and CSS.
 * In-page loading uses skeletons; buttons use Spinner.
 */
export function LogoLoader({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div role="status" className={cn("logo-loader", className)}>
      <svg viewBox="10 1 44 60" aria-hidden="true" focusable="false">
        <path className="logo-loader-fill" d={BUBBLE} />
        <path className="logo-loader-stroke" d={BUBBLE} pathLength={100} />
        <path className="logo-loader-ribbon" d={RIBBON} />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Full-screen version, centered on the page background. */
export function AppLoader() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper">
      <LogoLoader label="Loading Docent" className="size-14" />
    </div>
  );
}
