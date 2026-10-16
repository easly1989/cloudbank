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

/**
 * The expression for the marks in text. Empty when nothing is marked.
 */
export function buildExpression(text: string, marks: Mark[]): string {
  const list = orderedMarks(marks);
  let out = "";
  let pos = 0; // where the expression has read up to
  list.forEach((m, i) => {
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
    if (i > 0 && from > pos) out += String.raw`[\s\S]*?`;
    out += literal(text.slice(from, m.start));

    const after = text.slice(m.end);
    const next = list[i + 1];
    if (!TEXT_FIELDS.has(m.field)) {
      out += `(?P<${m.field}>${SHAPE[m.field]})`;
      pos = m.end;
      return;
    }
    if (after === "" || after.startsWith("\n") || after.startsWith("\r")) {
      out += `(?P<${m.field}>[^\\n]+)`;
      pos = m.end;
      return;
    }
    // The words just after: up to two of them, short of the line's end and
    // of the next piece.
    let limit = Math.min(after.length, ANCHOR_AFTER);
    const eol = after.search(/[\r\n]/);
    if (eol >= 0) limit = Math.min(limit, eol);
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
      out += `(?P<${m.field}>\\S+)`;
      pos = m.end;
      return;
    }
    out += `(?P<${m.field}>.+?)${literal(suffix)}`;
    pos = m.end + suffix.length;
  });
  return out;
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
  v: 1;
  /** The mail the pieces were highlighted in. */
  mailId: number | null;
  text: string;
  marks: Mark[];
  /** The expression was changed by hand under Advanced. */
  manual: boolean;
}

export function readEditorState(raw: string): EditorState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<EditorState>;
    if (s.v !== 1 || typeof s.text !== "string" || !Array.isArray(s.marks)) return null;
    const marks = s.marks.filter(
      (m): m is Mark =>
        !!m &&
        FIELDS.includes(m.field) &&
        Number.isInteger(m.start) &&
        Number.isInteger(m.end) &&
        m.start >= 0 &&
        m.end <= s.text!.length,
    );
    return {
      v: 1,
      mailId: typeof s.mailId === "number" ? s.mailId : null,
      text: s.text,
      marks,
      manual: !!s.manual,
    };
  } catch {
    return null;
  }
}
