/** Who can use a widget: anonymous mode needs the switch on, signed-in mode needs an active key. */
export function widgetMode(anonymousEnabled: boolean, activeKeys: number) {
  if (anonymousEnabled) return activeKeys > 0 ? "Anonymous and signed-in" : "Anonymous visitors";
  return activeKeys > 0 ? "Signed-in customers" : "No one yet";
}
