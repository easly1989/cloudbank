import type { RegisterSWOptions } from "vite-plugin-pwa/types";

import { CHECK_EVERY_MS, reloadOnStaleChunk, startAppUpdate } from "./appUpdate";

// A window with just what the code touches: timers, visibility, reload.
function fakeWindow() {
  const target = new EventTarget();
  const doc = new EventTarget() as Document & { visibilityState: string };
  doc.visibilityState = "visible";
  const store = new Map<string, string>();
  const win = {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    document: doc,
    location: { reload: vi.fn() },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  return win as unknown as Window & { location: { reload: ReturnType<typeof vi.fn> } };
}

function setup() {
  const win = fakeWindow();
  let opts: RegisterSWOptions = {};
  const skipWaiting = vi.fn(async () => {});
  const update = startAppUpdate((o) => {
    opts = o;
    return skipWaiting;
  }, win);
  const reg = { update: vi.fn(async () => {}) } as unknown as ServiceWorkerRegistration;
  opts.onRegisteredSW?.("/sw.js", reg);
  const seen = vi.fn();
  update.subscribe(seen);
  return { win, opts, skipWaiting, update, reg, seen };
}

describe("startAppUpdate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the notice only once a new build is waiting", () => {
    const { opts, update, seen } = setup();
    expect(update.visible()).toBe(false);
    opts.onNeedRefresh?.();
    expect(update.visible()).toBe(true);
    expect(seen).toHaveBeenCalled();
  });

  it("asks the server every hour and when the app comes back", () => {
    const { win, reg } = setup();
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
    win.document.dispatchEvent(new Event("visibilitychange"));
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it("brings a notice put off back at the next check", () => {
    const { win, opts, update } = setup();
    opts.onNeedRefresh?.();
    update.later();
    expect(update.visible()).toBe(false);
    win.document.dispatchEvent(new Event("visibilitychange"));
    expect(update.visible()).toBe(true);
  });

  it("switches only when chosen, and reloads the tab that chose", () => {
    const { win, opts, skipWaiting, update } = setup();
    opts.onNeedRefresh?.();
    expect(skipWaiting).not.toHaveBeenCalled();
    update.update();
    expect(skipWaiting).toHaveBeenCalledTimes(1);
    opts.onNeedReload?.();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads a tab whose person did not choose", () => {
    const { win, opts, skipWaiting, update } = setup();
    opts.onNeedRefresh?.();
    // Another tab chose Update: the new worker takes this page over too.
    opts.onNeedReload?.();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(update.visible()).toBe(true);
    // Here, Update is now only a reload.
    update.update();
    expect(skipWaiting).not.toHaveBeenCalled();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe("reloadOnStaleChunk", () => {
  it("reloads once, then lets a second failure reach the error page", () => {
    const win = fakeWindow();
    let now = 1_000_000;
    reloadOnStaleChunk(win, () => now);

    const first = new Event("vite:preloadError", { cancelable: true });
    win.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(win.location.reload).toHaveBeenCalledTimes(1);

    now += 2_000;
    const second = new Event("vite:preloadError", { cancelable: true });
    win.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(1);

    // Much later it is a new build again, not a loop.
    now += 60_000;
    win.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(win.location.reload).toHaveBeenCalledTimes(2);
  });
});
