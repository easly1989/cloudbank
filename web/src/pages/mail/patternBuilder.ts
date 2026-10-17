/**
 * The pattern editor's engine (#657): the pieces a person highlights in one
 * real mail become an RE2 expression with named groups, which the server
 * matches against every mail of that kind (subject, a newline, then body).
 *
 * Each piece is found by the two words just before it, as written in the mail,
 * with numbers and spaces loosened (a time or a date changes from one mail to
 * the next). Text between pieces may change too, so it is skipped. A text
 * piece (memo, payee…) runs until the words just after it, or to the end of
 * its line.
 */

export type Field =
  "amount" | "memo" | "payee" | "info" | "tag" | "category" | "date" | "card" | "direction";

/** The order fields are offered in. */
export const FIELDS: Field[] = [
  "amount",
  "memo",
  "payee",
  "info",
  "tag",
  "category",
  "date",
  "card",
  "direction",
];

/** A highlighted piece: [start, end) in the mail's text. */
export interface Mark {
  field: Field;
  start: number;
  end: number;
}

const TEXT_FIELDS = new Set<Field>(["memo", "payee", "info", "tag", "category"]);

/** What each self-delimiting piece looks like. */
const SHAPE: Partial<Record<Field, string>> = {
  amount: String.raw`\d(?:[\d.,]*\d)?`,
  card: String.raw`\d+`,
  date: String.raw`\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?`,
  direction: String.raw`\pL+`,
};

/** How many words before a piece find it, and how far back they reach. */
const ANCHOR_WORDS = 2;
const ANCHOR_BEFORE = 32;
/** How far the words after a text piece reach. */
const ANCHOR_AFTER = 16;

/** The text a pattern reads: the subject, a newline, then the body. */
export const mailText = (subject: string, body: string) => `${subject}\n${body}`;

/**
 * Literal text as an expression: special characters escaped, every run of
 * digits any number and every run of spaces any spacing.
 */
export function literal(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\d/.test(c)) {
      while (i < s.length && /\d/.test(s[i])) i++;
      out += String.raw`\d+`;
      continue;
    }
    if (/\s/.test(c)) {
      while (i < s.length && /\s/.test(s[i])) i++;
      out += String.raw`\s+`;
      continue;
    }
    out += /[\\.+*?()|[\]{}^$]/.test(c) ? `\\${c}` : c;
    i++;
  }
  return out;
}

/** The marks in order, with overlapping ones dropped (the earlier wins). */
export function orderedMarks(marks: Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.end <= m.start) continue;
    const last = out[out.length - 1];
    if (last && m.start < last.end) continue;
    out.push(m);
  }
  return out;
}

const GAP = String.raw`[\s\S]*?`;

/** How a text piece ends: at the end of its line, after one word, or at the words that follow it. */
type End =
  { kind: "shape" } | { kind: "line" } | { kind: "word" } | { kind: "until"; text: string };

/** A marked piece as one mail shows it. */
interface Piece {
  field: Field;
  /** Text that may change comes between the previous piece and this one. */
  gap: boolean;
  /** The words just before the piece, as the mail writes them. */
  before: string;
  end: End;
}

/**
 * A part of the expression, kept apart so the editor can say where a mail
 * stops matching: the words before a piece, the piece, the words after it.
 */
export interface Step {
  kind: "before" | "value" | "end";
  field: Field;
  /** RE2. */
  re: string;
  /**
   * What it looks for, as the mails write it: one text, or one per variant
   * when the example mails differ. "\n" is the end of a line, " " a space.
   */
  looksFor: string[];
}

function pieces(text: string, marks: Mark[]): Piece[] {
  const list = orderedMarks(marks);
  const out: Piece[] = [];
  let pos = 0; // where the expression has read up to
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    // The two words just before the piece, on its line and after what was
    // read; a word the length limit cuts short is left out.
    const lineStart = text.lastIndexOf("\n", m.start - 1) + 1;
    const floor = Math.max(pos, lineStart, m.start - ANCHOR_BEFORE);
    let from = m.start;
    for (let words = 0; words < ANCHOR_WORDS; words++) {
      let j = from;
      while (j > floor && /[ \t]/.test(text[j - 1])) j--;
      let w = j;
      while (w > floor && !/\s/.test(text[w - 1])) w--;
      if (w === j) break;
      if (w === floor && floor > pos && floor > lineStart && !/\s/.test(text[w - 1])) break;
      from = w;
    }
    const piece = { field: m.field, gap: i > 0 && from > pos, before: text.slice(from, m.start) };
    pos = m.end;

    const after = text.slice(m.end);
    if (!TEXT_FIELDS.has(m.field)) {
      out.push({ ...piece, end: { kind: "shape" } });
      continue;
    }
    if (after === "" || after.startsWith("\n") || after.startsWith("\r")) {
      out.push({ ...piece, end: { kind: "line" } });
      continue;
    }
    // The words just after: up to two of them, short of the line's end and
    // of the next piece.
    let limit = Math.min(after.length, ANCHOR_AFTER);
    const eol = after.search(/[\r\n]/);
    if (eol >= 0) limit = Math.min(limit, eol);
    const next = list[i + 1];
    if (next) limit = Math.min(limit, next.start - m.end);
    let end = 0;
    let words = 0;
    while (end < limit) {
      if (/\s/.test(after[end]) && end > 0 && !/\s/.test(after[end - 1])) {
        words++;
        if (words === 2) break;
      }
      end++;
    }
    const suffix = after.slice(0, end).replace(/\s+$/, "");
    if (suffix === "") {
      out.push({ ...piece, end: { kind: "word" } });
      continue;
    }
    out.push({ ...piece, end: { kind: "until", text: suffix } });
    pos = m.end + suffix.length;
  }
  return out;
}

const VALUE: Record<Exclude<End["kind"], "shape">, string> = {
  line: String.raw`[^\n]+`,
  word: String.raw`\S+`,
  until: ".+?",
};

/** The value and end steps of a piece every example mail ends the same way. */
function valueSteps(field: Field, end: End): Step[] {
  const value = end.kind === "shape" ? SHAPE[field]! : VALUE[end.kind];
  const steps: Step[] = [{ kind: "value", field, re: `(?P<${field}>${value})`, looksFor: [] }];
  if (end.kind === "until") {
    steps.push({ kind: "end", field, re: literal(end.text), looksFor: [end.text] });
  }
  return steps;
}

function render(list: Piece[]): Step[] {
  return list.flatMap((p) => [
    {
      kind: "before" as const,
      field: p.field,
      re: (p.gap ? GAP : "") + literal(p.before),
      looksFor: p.before.trim() ? [p.before.trim()] : [],
    },
    ...valueSteps(p.field, p.end),
  ]);
}

/** Why the example mails cannot make one pattern. */
export type MergeProblem = { code: "order" } | { code: "nothing"; field: Field };

/**
 * One pattern from several mails of the kind: before each piece, the words
 * they all have; after a text piece, any of the endings they show.
 */
function merge(all: Piece[][]): Step[] | MergeProblem {
  const fields = (list: Piece[]) => list.map((p) => p.field).join();
  if (all.some((list) => fields(list) !== fields(all[0]))) return { code: "order" };
  const steps: Step[] = [];
  for (let i = 0; i < all[0].length; i++) {
    const same = all.map((list) => list[i]);
    const { field } = same[0];
    if (new Set(same.map((p) => literal(p.before))).size === 1) {
      steps.push(...render([{ ...same[0], gap: same.some((p) => p.gap) }]).slice(0, 1));
    } else {
      // The words they share, counted back from the piece.
      const words = same.map((p) => p.before.trim().split(/\s+/).filter(Boolean));
      const common: string[] = [];
      for (let k = 1; words.every((w) => w.length >= k); k++) {
        const word = words[0][words[0].length - k];
        if (!words.every((w) => literal(w[w.length - k]) === literal(word))) break;
        common.unshift(word);
      }
      if (common.length === 0) return { code: "nothing", field };
      const spaced = new Set(same.map((p) => /\s$/.test(p.before)));
      const tail = spaced.size > 1 ? String.raw`\s*` : spaced.has(true) ? String.raw`\s+` : "";
      // A shared word starts after a space: never inside a longer word.
      const lead = i > 0 ? GAP + String.raw`\s` : String.raw`(?:^|\s)`;
      steps.push({
        kind: "before",
        field,
        re: lead + literal(common.join(" ")) + tail,
        looksFor: [common.join(" ")],
      });
    }
    const key = (e: End) => (e.kind === "until" ? `u${literal(e.text)}` : e.kind);
    if (new Set(same.map((p) => key(p.end))).size === 1) {
      steps.push(...valueSteps(field, same[0].end));
      continue;
    }
    // Only text pieces end in different ways.
    const alts = new Map<string, string>();
    for (const { end } of same) {
      if (end.kind === "until") alts.set(literal(end.text), end.text);
      if (end.kind === "line") alts.set(String.raw`\r?\n|$`, "\n");
      if (end.kind === "word") alts.set(String.raw`\s`, " ");
    }
    steps.push(
      { kind: "value", field, re: `(?P<${field}>.+?)`, looksFor: [] },
      { kind: "end", field, re: `(?:${[...alts.keys()].join("|")})`, looksFor: [...alts.values()] },
    );
  }
  return steps;
}

/**
 * The expression for the marks in text. Empty when nothing is marked.
 */
export function buildExpression(text: string, marks: Mark[]): string {
  return render(pieces(text, marks))
    .map((s) => s.re)
    .join("");
}

/** A mail the pieces are marked in. */
export interface Sample {
  mailId: number | null;
  text: string;
  marks: Mark[];
}

/** The fields marked in a sample, in the order the mail has them. */
export const sampleFields = (s: Sample) => orderedMarks(s.marks).map((m) => m.field);

/**
 * The pattern for the example mails. A mail joins once it has the first
 * one's fields marked; until then, and when the mails cannot be merged, the
 * pattern is the first mail's alone.
 */
export function buildPattern(samples: Sample[]): {
  steps: Step[];
  expression: string;
  problem?: MergeProblem;
} {
  const first = samples[0] ? pieces(samples[0].text, samples[0].marks) : [];
  const want = [...first.map((p) => p.field)].sort().join();
  const joined = samples
    .slice(1)
    .filter((s) => [...sampleFields(s)].sort().join() === want)
    .map((s) => pieces(s.text, s.marks));
  const merged = joined.length > 0 ? merge([first, ...joined]) : render(first);
  const problem = Array.isArray(merged) ? undefined : merged;
  const steps = Array.isArray(merged) ? merged : render(first);
  return { steps, expression: steps.map((s) => s.re).join(""), problem };
}

/**
 * An expression the builder writes, in JavaScript's dialect with RE2's
 * meaning: \s and . as RE2 reads them, named groups, the letter class.
 */
export function toJS(re: string): string {
  let out = "";
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === "\\") {
      const n = re[++i];
      if (n === "s") out += String.raw`[\t\n\f\r ]`;
      else if (n === "S") out += String.raw`[^\t\n\f\r ]`;
      else if (n === "p" && re[i + 1] === "L") {
        out += String.raw`\p{L}`;
        i++;
      } else out += `\\${n}`;
    } else if (c === "[") {
      let j = i + 1;
      while (j < re.length && re[j] !== "]") j += re[j] === "\\" ? 2 : 1;
      const cls = re.slice(i, j + 1);
      out += cls === String.raw`[\s\S]` ? "[^]" : cls;
      i = j;
    } else if (c === ".") out += String.raw`[^\n]`;
    else if (re.startsWith("(?P<", i)) {
      out += "(?<";
      i += 3;
    } else out += c;
  }
  return out;
}

/** Where a mail stops matching the pattern. */
export interface Stop {
  /** The first step the mail does not match. */
  step: Step;
  /** It differs from the pattern's first words: likely another kind of mail. */
  fromStart: boolean;
  /** What the pattern did read, as [start, end) in the mail's text. */
  read: [number, number] | null;
  /** The text that differs from what the step looks for. */
  diff: [number, number];
}

/** Where text stops matching steps; null when it matches them all. */
export function whereItStops(steps: Step[], text: string): Stop | null {
  let prefix = "";
  let read: [number, number] | null = null;
  for (const step of steps) {
    if (!step.re) continue;
    const m = new RegExp(toJS(prefix + step.re), "u").exec(text);
    if (m) {
      prefix += step.re;
      read = [m.index, m.index + m[0].length];
      continue;
    }
    return { step, fromStart: !read, read, diff: differs(step, text, read?.[1] ?? 0) };
  }
  return null;
}

/** The text after p that a step was looking for and did not find. */
function differs(step: Step, text: string, p: number): [number, number] {
  const lineEnd = (i: number) => {
    const e = text.slice(i).search(/[\r\n]/);
    return e < 0 ? text.length : i + e;
  };
  if (step.kind === "end") {
    // The value before it read a single character: what follows on its line differs.
    const s = Math.max(0, p - 1);
    return [s, Math.min(lineEnd(s), s + 60)];
  }
  if (step.kind === "before" && step.looksFor.length === 1) {
    // The last of its words the mail does have, with what stands before them.
    const words = step.looksFor[0].split(/\s+/);
    for (let j = 1; j < words.length; j++) {
      const m = new RegExp(toJS(literal(words.slice(j).join(" "))), "u").exec(text.slice(p));
      if (!m) continue;
      const q = p + m.index;
      const floor = Math.max(p, text.lastIndexOf("\n", q - 1) + 1);
      let s = Math.max(floor, q - words.slice(0, j).join(" ").length - 1);
      while (s > floor && !/\s/.test(text[s - 1])) s--;
      return [s, q + m[0].length];
    }
  }
  let s = p;
  while (s < text.length && /\s/.test(text[s])) s++;
  return [s, Math.min(lineEnd(s), s + 40)];
}

/**
 * A date format for the date as the sample writes it: DD, MM and YYYY or YY
 * with its separators. A day above 12 settles which number is the day; when
 * neither is, the day comes first, as banks in Europe write it.
 */
export function guessDateFormat(sample: string): string {
  const m = sample.trim().match(/^(\d{1,4})([./-])(\d{1,2})(?:([./-])(\d{2,4}))?$/);
  if (!m) return "DD/MM/YYYY";
  const [, a, sep, b, sep2, c] = m;
  if (a.length === 4) return `YYYY${sep}MM${sep2 ?? sep}DD`;
  const monthFirst = Number(b) > 12 && Number(a) <= 12;
  const head = monthFirst ? `MM${sep}DD` : `DD${sep}MM`;
  if (!c) return head;
  return `${head}${sep2}${c.length === 4 ? "YYYY" : "YY"}`;
}

/** The editor's own state, kept with the pattern to reopen it as it was. */
export interface EditorState {
  v: 2;
  /** The mails the pieces were highlighted in; the first leads. */
  samples: Sample[];
  /** The expression was changed by hand under Advanced. */
  manual: boolean;
}

function readSample(s: Partial<Sample> | null): Sample | null {
  if (!s || typeof s.text !== "string" || !Array.isArray(s.marks)) return null;
  const text = s.text;
  const marks = s.marks.filter(
    (m): m is Mark =>
      !!m &&
      FIELDS.includes(m.field) &&
      Number.isInteger(m.start) &&
      Number.isInteger(m.end) &&
      m.start >= 0 &&
      m.end <= text.length,
  );
  return { mailId: typeof s.mailId === "number" ? s.mailId : null, text, marks };
}

/** The saved state, or null; version 1 kept a single mail. */
export function readEditorState(raw: string): EditorState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as {
      v?: number;
      samples?: unknown;
      manual?: unknown;
    } & Partial<Sample>;
    const list = s.v === 1 ? [s] : s.v === 2 && Array.isArray(s.samples) ? s.samples : [];
    const samples = (list as (Partial<Sample> | null)[]).map(readSample);
    if (samples.length === 0 || samples.some((x) => !x)) return null;
    return { v: 2, samples: samples as Sample[], manual: !!s.manual };
  } catch {
    return null;
  }
}
