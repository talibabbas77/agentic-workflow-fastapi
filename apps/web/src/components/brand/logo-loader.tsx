import { Loading } from "@/components/ui/loading";
import { BUBBLE, RIBBON } from "./logo";

/**
 * Full-screen branded loader for the first paint of the app, while the session
 * loads and there is no layout to sketch yet. The bubble outline draws itself,
 * fills, and the bookmark drops in, then the loop repeats. Pure SVG and CSS.
 * In-page loading uses skeletons; buttons use a spinner.
 */
export function AppLoader() {
  return (
    <Loading label="Loading Docent" className="grid min-h-dvh place-items-center bg-paper">
      <svg className="logo-loader size-14" viewBox="10 1 44 60" aria-hidden="true" focusable="false">
        <path className="logo-loader-fill" d={BUBBLE} />
        <path className="logo-loader-stroke" d={BUBBLE} pathLength={100} />
        <path className="logo-loader-ribbon" d={RIBBON} />
      </svg>
    </Loading>
  );
}
