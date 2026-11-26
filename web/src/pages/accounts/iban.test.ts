import { groupIban, looksLikeIban, validBic, validIban } from "./iban";

describe("IBAN and BIC (#775)", () => {
  it("checks the IBAN's check digits, spaces and case aside", () => {
    expect(validIban("IT60 X054 2811 1010 0000 0123 456")).toBe(true);
    expect(validIban("de89370400440532013000")).toBe(true);
    expect(validIban("IT60X0542811101000000123457")).toBe(false);
    expect(validIban("IT60")).toBe(false);
  });

  it("treats only IBAN-shaped numbers as IBANs", () => {
    expect(looksLikeIban("it60 x054")).toBe(true);
    expect(looksLikeIban("000123-45")).toBe(false);
  });

  it("takes an 8 or 11 character BIC, or none", () => {
    expect(validBic("")).toBe(true);
    expect(validBic("bpmoit22xxx")).toBe(true);
    expect(validBic("BPMOIT22")).toBe(true);
    expect(validBic("BPMO")).toBe(false);
  });

  it("prints the IBAN in groups of four", () => {
    expect(groupIban("IT60X0542811101000000123456")).toBe("IT60 X054 2811 1010 0000 0123 456");
  });
});
