/**
 * Full page load. Used only when the session or active workspace changes (log
 * in, log out, accept an invite, switch workspace), so no state from the
 * previous identity survives in the client router or preserved routes.
 *
 * The returned promise never settles: the page is going away, so callers that
 * await it stay in their pending state instead of flashing a result.
 */
export function hardNavigate(path: string): Promise<never> {
  window.location.assign(path);
  return new Promise<never>(() => {});
}
