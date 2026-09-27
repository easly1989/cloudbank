/**
 * A button label with a shorter form for the narrowest phones.
 *
 * At 320px the register's "⋯", "Import" and "Add transaction" need about 318px
 * and the page has 288, so the primary button fell onto a line of its own.
 * Below 360px it says only "Add": the button, its place and the sheet it opens
 * are unchanged. The long form is hidden with display, so a screen reader
 * hears exactly one of the two.
 */
export function ShortLabel({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="cb-label-long">{long}</span>
      <span className="cb-label-short">{short}</span>
    </>
  );
}
