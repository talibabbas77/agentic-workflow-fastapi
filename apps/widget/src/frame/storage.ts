// The frame's own sessionStorage (the widget origin's, partitioned per top
// level site by the browser). Never the host page's storage. Falls back to
// memory when storage is blocked, for example with all cookies disabled.

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

export function sessionStore(win: Window): KeyValueStore {
  const memory = memoryStore();
  let storage: Storage | null = null;
  try {
    storage = win.sessionStorage;
    storage.getItem("docent:probe");
  } catch {
    storage = null;
  }
  if (!storage) return memory;
  const s = storage;
  return {
    get(k) {
      try {
        return s.getItem(k);
      } catch {
        return memory.get(k);
      }
    },
    set(k, v) {
      try {
        s.setItem(k, v);
      } catch {
        memory.set(k, v);
      }
    },
    remove(k) {
      try {
        s.removeItem(k);
      } catch {
        // ignore
      }
      memory.remove(k);
    },
  };
}
