/**
 * Full page load. Used only when the session or active workspace changes (log
 * in, log out, accept an invite, switch workspace), so no state from the
 * previous identity survives in the client router or preserved routes.
 */
export function hardNavigate(path: string) {
  window.location.assign(path);
}
