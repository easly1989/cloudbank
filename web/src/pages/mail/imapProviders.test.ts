import { describe, expect, it } from "vitest";

import { isMicrosoftAddress, providerForAddress, providerForServer } from "./imapProviders";

describe("imap providers", () => {
  it("picks the provider from the address's domain", () => {
    expect(providerForAddress("Nome@GMAIL.com")?.id).toBe("gmail");
    expect(providerForAddress("nome@inwind.it")?.id).toBe("libero");
    expect(providerForAddress("nome@me.com")?.id).toBe("icloud");
    expect(providerForAddress("nome@example.com")).toBeNull();
    expect(providerForAddress("nome")).toBeNull();
  });

  it("sends Outlook.com addresses to Microsoft", () => {
    expect(isMicrosoftAddress("nome@hotmail.it")).toBe(true);
    expect(isMicrosoftAddress("nome@gmail.com")).toBe(false);
  });

  it("names a saved server, or calls it another one", () => {
    expect(providerForServer({ host: "imap.gmail.com", port: 993, security: "tls" }).id).toBe(
      "gmail",
    );
    expect(providerForServer({ host: "imap.gmail.com", port: 143, security: "starttls" }).id).toBe(
      "other",
    );
    expect(providerForServer({ host: "imap.example.net", port: 993, security: "tls" }).id).toBe(
      "other",
    );
  });
});
