// frame.js: runs inside the widget iframe, served from the widget origin with
// a strict CSP (no inline scripts or styles, same origin fetches only).
import "./frame.css";
import { boot } from "./boot";
import { sessionStore } from "./storage";

boot({
  win: window,
  doc: document,
  fetch: window.fetch.bind(window),
  storage: sessionStore(window),
});
