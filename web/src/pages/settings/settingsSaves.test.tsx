import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AI_SETTINGS_KEY, updateAISettings, type AISettings } from "../../api/ai";
import { updateWallet, type Wallet } from "../../api/client";
import { useAiSave, useWalletSave } from "./settingsSaves";

vi.mock("../../api/client", async (orig) => ({
  ...(await orig<typeof import("../../api/client")>()),
  updateWallet: vi.fn(),
}));
vi.mock("../../api/ai", async (orig) => ({
  ...(await orig<typeof import("../../api/ai")>()),
  updateAISettings: vi.fn(),
  getAISettings: vi.fn(),
}));

/**
 * A server that stores the whole object it is sent, answering when the test
 * says so, and refusing a body the test marks as bad.
 */
function server<T>(initial: T, refuse: (body: T) => boolean = () => false) {
  let stored = initial;
  const pending: (() => void)[] = [];
  const handle = (body: T) =>
    new Promise<T>((resolve, reject) => {
      pending.push(() => {
        if (refuse(body)) return reject(new Error("refused"));
        stored = { ...stored, ...body };
        resolve(stored);
      });
    });
  return {
    handle,
    stored: () => stored,
    inFlight: () => pending.length,
    answer: async () => {
      await act(async () => {
        pending.shift()?.();
        await new Promise((r) => setTimeout(r, 0));
      });
    },
  };
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});

describe("wallet settings", () => {
  const casa = {
    id: 1,
    title: "Casa",
    ownerName: "Carlo",
    role: "owner",
    createdAt: "",
    schedulePostMonths: 0,
    billsCategoryId: null,
  } as Wallet;

  it("keeps both of two quick changes, the second sent after the first", async () => {
    const srv = server<Wallet>(casa);
    vi.mocked(updateWallet).mockImplementation((_id, body) => srv.handle(body as Wallet));
    qc.setQueryData(["wallets"], [casa]);
    const { result } = renderHook(() => useWalletSave(1), { wrapper });
    act(() => {
      result.current.mutate({ title: "Casa nuova" });
      result.current.mutate({ schedulePostMonths: 2 });
    });
    await settle();
    expect(srv.inFlight()).toBe(1);
    await srv.answer();
    await settle();
    await srv.answer();
    expect(srv.stored()).toMatchObject({ title: "Casa nuova", schedulePostMonths: 2 });
    expect(qc.getQueryData<Wallet[]>(["wallets"])?.[0]).toMatchObject({
      title: "Casa nuova",
      schedulePostMonths: 2,
    });
  });

  it("does not send a refused change again with the next one", async () => {
    const srv = server<Wallet>(casa, (b) => b.title === "");
    vi.mocked(updateWallet).mockImplementation((_id, body) => srv.handle(body as Wallet));
    qc.setQueryData(["wallets"], [casa]);
    const { result } = renderHook(() => useWalletSave(1), { wrapper });
    act(() => {
      result.current.mutate({ title: "" });
      result.current.mutate({ ownerName: "Anna" });
    });
    await settle();
    await srv.answer();
    await settle();
    await srv.answer();
    expect(srv.stored()).toMatchObject({ title: "Casa", ownerName: "Anna" });
  });
});

describe("AI settings", () => {
  const ai = {
    enabled: false,
    baseUrl: "",
    model: "",
    hasKey: false,
    features: { reports: false, ask: false },
    schedule: { weekly: false, yearly: true },
    walletsOff: [],
    monthlyLimit: 200,
    used: 0,
    motion: true,
    local: false,
  } as unknown as AISettings;

  it("keeps two quick switches in one list, and the last change of one wins", async () => {
    const srv = server<AISettings>(ai);
    vi.mocked(updateAISettings).mockImplementation((body) => srv.handle(body as AISettings));
    qc.setQueryData(AI_SETTINGS_KEY, ai);
    const { result } = renderHook(() => useAiSave(), { wrapper });
    act(() => {
      result.current.mutate((cur) => ({ features: { ...cur.features, reports: true } }));
      result.current.mutate((cur) => ({ features: { ...cur.features, ask: true } }));
      result.current.mutate(() => ({ enabled: true }));
      result.current.mutate(() => ({ enabled: false }));
    });
    await settle();
    expect(srv.inFlight()).toBe(1);
    for (let i = 0; i < 4; i++) {
      await srv.answer();
      await settle();
    }
    expect(srv.stored().features).toMatchObject({ reports: true, ask: true });
    expect(srv.stored().enabled).toBe(false);
  });
});
