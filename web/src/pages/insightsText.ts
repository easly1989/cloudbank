// The text of an AI report (#696), cut for display.

// An amount as the model writes one: 2540.00 EUR, 2.540,00 €, € 12.40.
const AMOUNT = /([+\-−]?(?:[€$£]\s?)?\d{1,3}(?:[.,'\s]?\d{3})*[.,]\d{2}(?:\s?(?:[€$£]|[A-Z]{3}))?)/;

/** The text cut round its amounts: the amounts are at the odd indexes. */
export const splitAmounts = (text: string) => text.split(AMOUNT);

/** The paragraphs of a report, which the model separates with a blank line. */
export const paragraphs = (body: string) => body.split(/\n\s*\n/).filter((p) => p.trim() !== "");
