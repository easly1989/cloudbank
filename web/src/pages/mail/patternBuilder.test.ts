import { describe, expect, it } from "vitest";

import {
  buildExpression,
  guessDateFormat,
  literal,
  mailText,
  type Mark,
  readEditorState,
} from "./patternBuilder";

// Invented mails, shaped like a card-payment notice. None is a real bank's.
const SUBJECT = "Pagamento con carta";
const BODY =
  "Gentile cliente, ti informiamo che in data 10.15 è stato richiesto un pagamento di 6,43 EUR " +
  "con la carta 1234_*_*_5678 presso Supermercato Demo 0042, - 10.15 ore 17:56\n" +
  "Cordiali saluti";
const TEXT = mailText(SUBJECT, BODY);

const mark = (field: Mark["field"], piece: string, text = TEXT): Mark => {
  const start = text.indexOf(piece);
  if (start < 0) throw new Error(`no ${piece}`);
  return { field, start, end: start + piece.length };
};

// The server runs RE2; JavaScript writes the same groups and classes
// slightly differently.
const run = (expr: string, text: string) =>
  new RegExp(
    expr.replaceAll("(?P<", "(?<").replaceAll(String.raw`\pL`, String.raw`\p{L}`),
    "u",
  ).exec(text)?.groups;

describe("buildExpression", () => {
  it("reads the same pieces in another mail of the kind", () => {
    const expr = buildExpression(TEXT, [
      mark("amount", "6,43"),
      mark("memo", "Supermercato Demo 0042"),
      mark("card", "5678"),
    ]);
    const other = mailText(
      SUBJECT,
      "Gentile cliente, ti informiamo che in data 11.02 è stato richiesto un pagamento di 1.234,56 EUR " +
        "con la carta 1234_*_*_9876 presso Bar Demo, - 11.02 ore 08:05\nCordiali saluti",
    );
    expect(run(expr, other)).toEqual({ amount: "1.234,56", card: "9876", memo: "Bar Demo" });
    expect(run(expr, TEXT)).toEqual({
      amount: "6,43",
      card: "5678",
      memo: "Supermercato Demo 0042",
    });
  });

  it("anchors each piece on the words just before it", () => {
    const expr = buildExpression(TEXT, [mark("amount", "6,43")]);
    expect(expr).toBe(
      String.raw`pagamento di (?P<amount>\d(?:[\d.,]*\d)?)`.replaceAll(" ", String.raw`\s+`),
    );
  });

  it("skips the text between pieces, which may change", () => {
    const expr = buildExpression(TEXT, [
      mark("amount", "6,43"),
      mark("memo", "Supermercato Demo 0042"),
    ]);
    expect(expr).toContain(String.raw`[\s\S]*?`);
    const longer = TEXT.replace("con la carta", "con la tua carta preferita");
    expect(run(expr, longer)?.memo).toBe("Supermercato Demo 0042");
  });

  it("runs a text piece to the end of its line when nothing follows it", () => {
    const text = mailText("Bonifico in arrivo", "Ordinante: Mario Demo\nImporto: 250,00 EUR");
    const expr = buildExpression(text, [
      mark("payee", "Mario Demo", text),
      mark("amount", "250,00", text),
    ]);
    const other = mailText(
      "Bonifico in arrivo",
      "Ordinante: Luisa Esempio Srl\nImporto: 12,00 EUR",
    );
    expect(run(expr, other)).toEqual({ payee: "Luisa Esempio Srl", amount: "12,00" });
  });

  it("reads a piece of the subject", () => {
    const text = mailText("Addebito di 19,99 EUR", "Il tuo abbonamento Demo è stato rinnovato.");
    const expr = buildExpression(text, [mark("amount", "19,99", text)]);
    expect(run(expr, mailText("Addebito di 5,00 EUR", "Altro testo"))?.amount).toBe("5,00");
  });

  it("captures the direction as a word", () => {
    const text = mailText("Movimento", "Tipo: accredito di 10,00 EUR");
    const expr = buildExpression(text, [
      mark("direction", "accredito", text),
      mark("amount", "10,00", text),
    ]);
    expect(run(expr, mailText("Movimento", "Tipo: addebito di 3,50 EUR"))).toEqual({
      direction: "addebito",
      amount: "3,50",
    });
  });

  it("keeps the earlier of two overlapping pieces", () => {
    const a = mark("memo", "Supermercato Demo");
    const b = { ...mark("payee", "Demo 0042") };
    const expr = buildExpression(TEXT, [b, a]);
    expect(expr).toContain("(?P<memo>");
    expect(expr).not.toContain("(?P<payee>");
  });

  it("is empty with nothing marked", () => {
    expect(buildExpression(TEXT, [])).toBe("");
  });
});

describe("literal", () => {
  it("escapes what an expression would read as syntax", () => {
    expect(literal("(*) 1.5$ [x]")).toBe(String.raw`\(\*\)\s+\d+\.\d+\$\s+\[x\]`);
  });
});

describe("guessDateFormat", () => {
  it.each([
    ["15.10", "DD.MM"],
    ["10.15", "MM.DD"],
    ["03/04", "DD/MM"],
    ["15/10/2026", "DD/MM/YYYY"],
    ["15-10-26", "DD-MM-YY"],
    ["2026-10-15", "YYYY-MM-DD"],
    ["oggi", "DD/MM/YYYY"],
  ])("%s → %s", (sample, want) => {
    expect(guessDateFormat(sample)).toBe(want);
  });
});

describe("readEditorState", () => {
  it("reads back what the editor saved, and nothing else", () => {
    const state = {
      v: 1,
      mailId: 7,
      text: "ab",
      marks: [{ field: "amount", start: 0, end: 2 }],
      manual: false,
    };
    expect(readEditorState(JSON.stringify(state))).toEqual(state);
    expect(readEditorState("")).toBeNull();
    expect(readEditorState("{not json")).toBeNull();
    expect(readEditorState(JSON.stringify({ ...state, v: 2 }))).toBeNull();
    // A piece beyond the text, or of no known field, is dropped.
    const bad = {
      ...state,
      marks: [
        { field: "amount", start: 0, end: 9 },
        { field: "x", start: 0, end: 1 },
      ],
    };
    expect(readEditorState(JSON.stringify(bad))?.marks).toEqual([]);
  });
});
