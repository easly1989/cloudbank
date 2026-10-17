import { describe, expect, it } from "vitest";

import {
  buildExpression,
  buildPattern,
  guessDateFormat,
  literal,
  mailText,
  type Mark,
  readEditorState,
  type Sample,
  toJS,
  whereItStops,
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

// One bank, two wordings of the same notice (#674): the card written with
// and without a space, and a different ending after the merchant.
const asked = (amount: string, shop: string) =>
  mailText(
    SUBJECT,
    `Gentile cliente,\nti informiamo che in data 10.16 è stato richiesto un pagamento di ${amount} EUR ` +
      `con la carta 1111_*_*_2222 presso ${shop}, - 10.16 ore 17:50\nCordiali saluti`,
  );
const made = (amount: string, shop: string) =>
  mailText(
    SUBJECT,
    `Gentile cliente,\nti informiamo che è stato effettuato un pagamento di ${amount} EUR ` +
      `con la carta 1111_*_*_ 2222 presso ${shop} .\nCordiali saluti`,
  );
const sample = (text: string, amount: string, shop: string): Sample => ({
  mailId: null,
  text,
  marks: [mark("amount", amount, text), mark("memo", shop, text)],
});

describe("buildPattern", () => {
  const one = sample(asked("12,50", "BAR DEMO"), "12,50", "BAR DEMO");
  const two = sample(made("41,00", "FARMACIA DEMO"), "41,00", "FARMACIA DEMO");

  it("is the first mail's pattern while it has one mail", () => {
    expect(buildPattern([one]).expression).toBe(buildExpression(one.text, one.marks));
  });

  it("covers both wordings once the fields are marked in a mail of each", () => {
    const { expression, problem } = buildPattern([one, two]);
    expect(problem).toBeUndefined();
    const read = (text: string) => run(toJS(expression), text);
    expect(read(asked("23,90", "EDICOLA DEMO"))).toEqual({ amount: "23,90", memo: "EDICOLA DEMO" });
    expect(read(made("7,80", "PANETTERIA DEMO"))).toEqual({
      amount: "7,80",
      memo: "PANETTERIA DEMO",
    });
    // Another notice from the same sender stays unread.
    expect(read(mailText("Bonifico in arrivo", "accreditato un bonifico di 1.200,00 EUR"))).toBe(
      undefined,
    );
  });

  it("waits for a mail to have the first one's fields", () => {
    const half = { ...two, marks: two.marks.slice(0, 1) };
    expect(buildPattern([one, half]).expression).toBe(buildExpression(one.text, one.marks));
  });

  it("refuses mails with nothing in common before a field", () => {
    const text = mailText("Avviso", "Totale 9,99 EUR");
    const other = { mailId: null, text, marks: [mark("amount", "9,99", text)] };
    const first = { ...one, marks: one.marks.slice(0, 1) };
    expect(buildPattern([first, other]).problem).toEqual({ code: "nothing", field: "amount" });
  });

  it("refuses fields in another order", () => {
    const text = mailText("Avviso", "Presso BAR DEMO, importo 3,00 EUR");
    const other = {
      mailId: null,
      text,
      marks: [mark("memo", "BAR DEMO", text), mark("amount", "3,00", text)],
    };
    expect(buildPattern([one, other]).problem).toEqual({ code: "order" });
  });
});

describe("whereItStops", () => {
  const { steps } = buildPattern([sample(asked("12,50", "BAR DEMO"), "12,50", "BAR DEMO")]);

  it("shows the card written another way", () => {
    const text = made("41,00", "FARMACIA DEMO");
    const stop = whereItStops(steps, text)!;
    expect(stop.fromStart).toBe(false);
    expect(stop.step).toMatchObject({ kind: "before", field: "memo" });
    expect(stop.step.looksFor).toEqual(["1111_*_*_2222 presso"]);
    expect(text.slice(...stop.diff)).toBe("1111_*_*_ 2222 presso");
    expect(text.slice(...stop.read!)).toBe("pagamento di 41,00");
  });

  it("shows the ending after the merchant", () => {
    const loose = steps.map((s) =>
      s.kind === "before" && s.field === "memo" ? { ...s, re: String.raw`[\s\S]*?\spresso\s+` } : s,
    );
    const text = made("41,00", "FARMACIA DEMO");
    const stop = whereItStops(loose, text)!;
    expect(stop.step).toMatchObject({ kind: "end", field: "memo", looksFor: [", -"] });
    expect(text.slice(...stop.diff)).toBe("FARMACIA DEMO .");
  });

  it("tells another kind of mail", () => {
    const stop = whereItStops(steps, mailText("Bonifico in arrivo", "un bonifico di 5,00 EUR"))!;
    expect(stop.fromStart).toBe(true);
  });

  it("is null for a mail that matches", () => {
    expect(whereItStops(steps, asked("1,00", "BAR DEMO"))).toBeNull();
  });
});

describe("toJS", () => {
  it("keeps RE2's meaning of spaces and dots", () => {
    // RE2's \s is ASCII only: a no-break space is not a space to it.
    expect(new RegExp(toJS(String.raw`a\sb`), "u").test("a b")).toBe(false);
    expect(new RegExp(toJS("a.b"), "u").test("a\rb")).toBe(true);
    expect(new RegExp(toJS(String.raw`[\s\S]*?[\d.,]`), "u").exec("x\n,")?.[0]).toBe("x\n,");
  });
});

describe("readEditorState", () => {
  const state = {
    v: 2,
    samples: [{ mailId: 7, text: "ab", marks: [{ field: "amount", start: 0, end: 2 }] }],
    manual: false,
  };

  it("reads back what the editor saved, and nothing else", () => {
    expect(readEditorState(JSON.stringify(state))).toEqual(state);
    expect(readEditorState("")).toBeNull();
    expect(readEditorState("{not json")).toBeNull();
    expect(readEditorState(JSON.stringify({ ...state, v: 3 }))).toBeNull();
    expect(readEditorState(JSON.stringify({ ...state, samples: [] }))).toBeNull();
    // A piece beyond the text, or of no known field, is dropped.
    const bad = {
      ...state,
      samples: [
        {
          ...state.samples[0],
          marks: [
            { field: "amount", start: 0, end: 9 },
            { field: "x", start: 0, end: 1 },
          ],
        },
      ],
    };
    expect(readEditorState(JSON.stringify(bad))?.samples[0].marks).toEqual([]);
  });

  it("reads the single mail an earlier version saved", () => {
    const v1 = { v: 1, ...state.samples[0], manual: true };
    expect(readEditorState(JSON.stringify(v1))).toEqual({ ...state, manual: true });
  });
});
