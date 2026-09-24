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
