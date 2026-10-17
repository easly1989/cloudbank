import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildPattern, type Field, guessDateFormat, mailText } from "./patternBuilder";

// The editor builds expressions in the browser, the server runs them with
// Go's RE2. These cases are written to a file the Go tests read
// (server/internal/mailingest/testdata/builder_cases.json), so an expression
// the builder writes that RE2 refuses, or reads differently, fails there.
// After changing the builder: UPDATE_BUILDER_CASES=1 npx vitest run patternBuilder.re2
// Invented mails only, never a real bank's.

interface Case {
  name: string;
  subject: string;
  body: string;
  marks: [Field, string][];
  /** More example mails of the kind, marked the same way (#674). */
  also?: { subject: string; body: string; marks: [Field, string][] }[];
  /** Other mails of the kind, with what each piece reads in them. */
  others: { subject: string; body: string; want: Partial<Record<Field, string>> }[];
}

const card = (date: string, amount: string, digits: string, shop: string, time: string) =>
  `Gentile cliente, ti informiamo che in data ${date} è stato richiesto un pagamento di ${amount} EUR ` +
  `con la carta 1234_*_*_${digits} presso ${shop}, - ${date} ore ${time}\nCordiali saluti`;

const asked = (amount: string, shop: string) =>
  `Gentile cliente,
ti informiamo che in data 10.16 è stato richiesto un pagamento di ${amount} EUR ` +
  `con la carta 1111_*_*_2222 presso ${shop}, - 10.16 ore 17:50
Cordiali saluti`;
const made = (amount: string, shop: string) =>
  `Gentile cliente,
ti informiamo che è stato effettuato un pagamento di ${amount} EUR ` +
  `con la carta 1111_*_*_ 2222 presso ${shop} .
Cordiali saluti`;

const CASES: Case[] = [
  {
    name: "card payment",
    subject: "Pagamento con carta",
    body: card("10.15", "6,43", "5678", "Supermercato Demo 0042", "17:56"),
    marks: [
      ["amount", "6,43"],
      ["card", "5678"],
      ["memo", "Supermercato Demo 0042"],
      ["date", "10.15"],
    ],
    others: [
      {
        subject: "Pagamento con carta",
        body: card("11.02", "1.234,56", "9876", "Bar Demo", "08:05"),
        want: { amount: "1.234,56", card: "9876", memo: "Bar Demo", date: "11.02" },
      },
    ],
  },
  {
    name: "credit transfer, pieces ending their line",
    subject: "Bonifico in arrivo",
    body: "Ordinante: Mario Demo\nImporto: 250,00 EUR\nCausale: rimborso cena",
    marks: [
      ["payee", "Mario Demo"],
      ["amount", "250,00"],
      ["info", "rimborso cena"],
    ],
    others: [
      {
        subject: "Bonifico in arrivo",
        body: "Ordinante: Luisa Esempio Srl\nImporto: 12,00 EUR\nCausale: quota (marzo) 50%",
        want: { payee: "Luisa Esempio Srl", amount: "12,00", info: "quota (marzo) 50%" },
      },
    ],
  },
  {
    name: "amount in the subject",
    subject: "Addebito di 19,99 EUR",
    body: "Il tuo abbonamento Demo è stato rinnovato.",
    marks: [["amount", "19,99"]],
    others: [{ subject: "Addebito di 5,00 EUR", body: "Altro testo", want: { amount: "5,00" } }],
  },
  {
    name: "direction as a word, with accents",
    subject: "Movimento",
    body: "Tipo: accredito di 10,00 EUR [rif. 2026/1]",
    marks: [
      ["direction", "accredito"],
      ["amount", "10,00"],
    ],
    others: [
      {
        subject: "Movimento",
        body: "Tipo: addebitò di 3,50 EUR [rif. 2026/2]",
        want: { direction: "addebitò", amount: "3,50" },
      },
    ],
  },
  {
    name: "two wordings of one notice, from two example mails",
    subject: "Pagamento con carta",
    body: asked("12,50", "BAR DEMO"),
    marks: [
      ["amount", "12,50"],
      ["memo", "BAR DEMO"],
    ],
    also: [
      {
        subject: "Pagamento con carta",
        body: made("41,00", "FARMACIA DEMO"),
        marks: [
          ["amount", "41,00"],
          ["memo", "FARMACIA DEMO"],
        ],
      },
    ],
    others: [
      {
        subject: "Pagamento con carta",
        body: asked("23,90", "EDICOLA DEMO"),
        want: { amount: "23,90", memo: "EDICOLA DEMO" },
      },
      {
        subject: "Pagamento con carta",
        body: made("7,80", "PANETTERIA DEMO"),
        want: { amount: "7,80", memo: "PANETTERIA DEMO" },
      },
    ],
  },
];

interface Written {
  name: string;
  expression: string;
  /** The date format the editor would offer, when a date is marked. */
  dateFormat: string;
  checks: { text: string; want: Partial<Record<Field, string>> }[];
}

function sample(name: string, subject: string, body: string, pieces: [Field, string][]) {
  const text = mailText(subject, body);
  const marks = pieces.map(([field, piece]) => {
    const start = text.indexOf(piece);
    if (start < 0) throw new Error(`${name}: no ${piece}`);
    return { field, start, end: start + piece.length };
  });
  return { mailId: null, text, marks };
}

function written(c: Case): Written {
  const first = sample(c.name, c.subject, c.body, c.marks);
  const text = first.text;
  const also = (c.also ?? []).map((a) => sample(c.name, a.subject, a.body, a.marks));
  const own = Object.fromEntries(c.marks) as Partial<Record<Field, string>>;
  return {
    name: c.name,
    expression: buildPattern([first, ...also]).expression,
    dateFormat: own.date ? guessDateFormat(own.date) : "",
    checks: [
      { text, want: own },
      ...c.others.map((o) => ({ text: mailText(o.subject, o.body), want: o.want })),
    ],
  };
}

// vitest runs from web/.
const FILE = join(
  process.cwd(),
  "..",
  "server",
  "internal",
  "mailingest",
  "testdata",
  "builder_cases.json",
);

describe("the cases the server checks with RE2", () => {
  const cases = CASES.map(written);
  const json = JSON.stringify(cases, null, 2) + "\n";
  if (process.env.UPDATE_BUILDER_CASES) writeFileSync(FILE, json);

  it.each(cases)("$name reads every mail of its kind", (c) => {
    // JavaScript writes RE2's named groups and letter class differently.
    const re = new RegExp(
      c.expression.replaceAll("(?P<", "(?<").replaceAll(String.raw`\pL`, String.raw`\p{L}`),
      "u",
    );
    for (const check of c.checks) expect(re.exec(check.text)?.groups).toEqual(check.want);
  });

  it("are the ones in the file", () => {
    expect(readFileSync(FILE, "utf8").replaceAll("\r\n", "\n")).toBe(json);
  });
});
