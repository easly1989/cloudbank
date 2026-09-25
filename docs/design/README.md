# The design spec, as numbers

The UI is built against one design artefact: the **"CloudBank restyle — style tile"**
Artifact. Its seven boards are the target — foundations, dark, the register, the
overview, settings, the secondary pages, and entering & deciding.

A screenshot of a mockup is not a specification. You cannot read a column width,
a font weight or a row's grid template off one, and building "towards" a picture
produces something that looks vaguely right and is wrong everywhere. So the
boards are extracted as **measured data** and the UI is built to those numbers.

## The files

`extract-spec.mjs` renders each board and dumps every element that paints
something: its text, position, size, font size and weight, whether it is in the
money face, colour, background, border, radius, padding, gap, and — for rows —
the grid template that puts the columns where they are.

```bash
# 1. export the artefact's boards as standalone HTML into a folder
# 2. serve it
python -m http.server 8123
# 3. extract
node docs/design/extract-spec.mjs http://127.0.0.1:8123
```

One JSON per board lands beside the script. Re-run it whenever the artefact
changes: the diff then says exactly what moved, which is the point of keeping
them in the repo rather than in someone's screenshots folder.

## How to use them

Build to the numbers, then **measure the built page and compare it back**. "It
looks close" is not a check — every time that was the check on this project, the
result was wrong in ways nobody could name until the numbers came out.

Two things the extraction cannot tell you, so read the artefact itself as well:

- **The canvas notes** — the yellow stickies — carry the reasoning behind the
  layout, and the HTML export drops them. They live in the artefact's
  `project/canvas.json`.
- **Annotations are not UI.** Each board has explanatory prose around the mock
  (the line under the register, the paragraph beside the columns panel). Those
  describe the design; they are not elements to build.

## What the app has that the design does not

The tile is a design for the shape of the app, not an inventory of its features,
so a few things in CloudBank have no counterpart on a board — the sidebar search
row, the register's reconcile and transfer workflows, several dashboard widgets.
Where that happens it was a decision, not an oversight; see #449 for which ones
and why. Adding to that list is fine, but say so rather than letting the two
drift apart quietly.

Added since:

- **The collapse-sidebar button in the sidebar foot** (#465). The overview board
  puts only the gear beside the user row; the app keeps a 34px button to fold
  the sidebar into a rail, so the user row is 162px wide instead of 198.
  `e2e/design-size-audit.mjs` checks that row's height only, for this reason.
- **Page tours** (#421). The boards draw no help at all. Each page with a tour
  has a **?** as the first of its header actions: a default icon button, 44px on
  the register and the overview and 40 elsewhere, like its neighbours. The two
  settings sections with tours (General, Data) put it beside the section title.
  The first time a page is opened, a 320px card in the bottom-right corner
  offers its tour. It is not a dialog, and it sits above the page but below any
  modal.
- **The entry sheet's fields are the reader's to arrange** (#469). The Entering
  and deciding board draws Date · Account, Memo, Category · Payee. By default the
  app instead shows what a transaction needs: Date · Account, Memo, Payment ·
  Category, and the status as a row of icons. Payee waits under More details
  with the rest. Settings → General → Transaction sheet moves any field either
  way, and names the default a new entry takes when the date or the account is
  out of view. The board's "Save and add another" gains a joined toggle on its
  left, which keeps every field for the next entry and relabels the button
  "Save and keep". The board's "Enter saves ↵" line is gone. Each foot button
  instead shows its own key after its label: ↵ on Save (save and close) and ⇧↵
  on the other (save and start another). The keys are hidden on a touch screen.
  This makes both buttons wider than the board draws, so the audit checks their
  height and type only. It still measures the amount, a paired field (Date) and
  a full-width field (Memo) against the board.
- **The demo build's band and notice** (#420). Only the `:demo` image has them.
  A yellow band opens every page, with "What's different here?" at its right.
  On the dark theme that link takes the band's own text colour, underlined,
  because the accent blue falls to 3:1 there. The band opens a notice, which also
  opens by itself on the first visit. The login card becomes a single "Start the
  demo" button. Settings loses Security. Integrations becomes Bank sync, with no
  AI. The Data section keeps the downloads but not the restore. The bank sync
  page shows the pretend bank's panel in place of the three providers.
