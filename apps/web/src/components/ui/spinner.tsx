import { Loading } from "./loading";

export function Spinner({ label }: { label?: string }) {
  return (
    <Loading label={label} className="inline-flex items-center">
      <span className="spinner" aria-hidden="true" />
    </Loading>
  );
}
