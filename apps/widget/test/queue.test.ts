/// <reference types="node" />
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { STUB_SNIPPET, installApi, type DocentApi } from "../src/loader/queue";

function fakeApi(log: unknown[][]): DocentApi {
  return {
    init: (...a: unknown[]) => void log.push(["init", ...a]),
    open: (...a: unknown[]) => void log.push(["open", ...a]),
    close: (...a: unknown[]) => void log.push(["close", ...a]),
    reset: async (...a: unknown[]) => void log.push(["reset", ...a]),
  };
}

/** Runs the exact snippet a host page pastes, in a sandbox whose global is `window`. */
function hostWindow(): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(STUB_SNIPPET, sandbox);
  return sandbox;
}

describe("queue stub", () => {
  it("queues calls made before the loader and replays them in order", () => {
    const win = hostWindow();
    const getToken = async () => "jwt";
    vm.runInContext(
      'Docent.init({ widget: "wid_x", getToken: getToken }); Docent.open(); Docent.close(); Docent.reset();',
      Object.assign(win, { getToken }),
    );
    const log: unknown[][] = [];
    expect(installApi(win, fakeApi(log), "1")).toBe(true);
    expect(log).toEqual([["init", { widget: "wid_x", getToken }], ["open"], ["close"], ["reset"]]);
  });

  it("replaces stub methods with the real ones and runs later calls immediately", () => {
    const win = hostWindow();
    const stubOpen = (win.Docent as Record<string, () => void>).open;
    const log: unknown[][] = [];
    installApi(win, fakeApi(log), "1");
    const docent = win.Docent as Record<string, (...a: unknown[]) => void>;
    docent.open();
    // A stub function captured before load still works: it pushes onto the live queue.
    stubOpen();
    expect(log).toEqual([["open"], ["open"]]);
  });

  it("accepts entries pushed by hand, with a plain object as the only argument", () => {
    const win: { Docent?: unknown } = { Docent: { q: [["init", { widget: "wid_y" }], ["open"], ["nope", []], "junk"] } };
    const log: unknown[][] = [];
    installApi(win, fakeApi(log), "1");
    expect(log).toEqual([["init", { widget: "wid_y" }], ["open"]]);
  });

  it("works when the snippet runs after the loader (keeps the real methods)", () => {
    const sandbox: Record<string, unknown> = {};
    sandbox.window = sandbox;
    const log: unknown[][] = [];
    installApi(sandbox, fakeApi(log), "1");
    vm.createContext(sandbox);
    vm.runInContext(STUB_SNIPPET + 'Docent.init({ widget: "wid_z" });', sandbox);
    expect(log).toEqual([["init", { widget: "wid_z" }]]);
  });

  it("does nothing when a loader is already installed", () => {
    const win: { Docent?: unknown } = {};
    const first: unknown[][] = [];
    const second: unknown[][] = [];
    expect(installApi(win, fakeApi(first), "1")).toBe(true);
    expect(installApi(win, fakeApi(second), "1")).toBe(false);
    (win.Docent as DocentApi).open();
    expect(first).toEqual([["open"]]);
    expect(second).toEqual([]);
  });

  it("keeps replaying after a call throws", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log: unknown[][] = [];
    const api = fakeApi(log);
    api.init = () => {
      throw new Error("boom");
    };
    installApi({ Docent: { q: [["init", []], ["open", []]] } }, api, "1");
    expect(log).toEqual([["open"]]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
