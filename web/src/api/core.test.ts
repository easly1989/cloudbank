import { ApiError, api, dropReauthParam, reauthAtProxy } from "./core";

function fakeWindow(href: string) {
  const store = new Map<string, string>();
  const win = {
    location: { href, assign: vi.fn() },
    history: { state: null, replaceState: vi.fn() },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  return win as unknown as Window & {
    location: { assign: ReturnType<typeof vi.fn> };
    history: { replaceState: ReturnType<typeof vi.fn> };
  };
}

describe("reauthAtProxy (#774)", () => {
  it("reloads the page past the service worker, once per 30 seconds", () => {
    const win = fakeWindow("https://finance.example/budget?month=11");
    let t = 1_000_000;
    expect(reauthAtProxy(win, () => t)).toBe(true);
    expect(win.location.assign).toHaveBeenCalledWith(
      "https://finance.example/budget?month=11&reauth=1000000",
    );
    t += 29_000;
    expect(reauthAtProxy(win, () => t)).toBe(false);
    t += 2_000;
    expect(reauthAtProxy(win, () => t)).toBe(true);
    expect(win.location.assign).toHaveBeenCalledTimes(2);
  });

  it("drops the marker once back", () => {
    const win = fakeWindow("https://finance.example/budget?month=11&reauth=5");
    dropReauthParam(win);
    expect(win.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "https://finance.example/budget?month=11",
    );
  });
});

describe("a 401", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  function answer(body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 401 })),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { href: "https://finance.example/", assign });
    return assign;
  }

  it("from CloudBank keeps the page", async () => {
    const assign = answer(
      JSON.stringify({ error: { code: "unauthorized", message: "authentication required" } }),
    );
    await expect(api.get("/api/v1/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it("from the proxy reloads through it", async () => {
    const assign = answer("401 Unauthorized");
    await expect(api.get("/api/v1/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledOnce();
  });
});
