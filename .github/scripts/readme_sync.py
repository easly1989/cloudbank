#!/usr/bin/env python3
"""Check that the translated READMEs keep the English Quick start (#612).

Each README marks its Quick start with <!-- quick-start --> and
<!-- /quick-start -->. The prose between them is translated; the code blocks
(the docker-compose.yml, the commands) must be identical to the English ones,
so a change made only in README.md fails here instead of leaving a
translation that installs something else.

    python3 .github/scripts/readme_sync.py

It also checks that every README's language row names every README.
"""

import glob
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
START, END = "<!-- quick-start -->", "<!-- /quick-start -->"
FENCE = re.compile(r"^```[^\n]*\n.*?^```", re.M | re.S)


def quick_start(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if text.count(START) != 1 or text.count(END) != 1:
        return text, None
    return text, text[text.index(START) : text.index(END)]


def main():
    errors = []
    english_text, english = quick_start(os.path.join(ROOT, "README.md"))
    if english is None:
        sys.exit(f"README.md: no single {START} … {END} section")
    blocks = FENCE.findall(english)
    if not blocks:
        sys.exit("README.md: the Quick start has no code blocks")

    translated = sorted(glob.glob(os.path.join(ROOT, "README.*.md")))
    readmes = ["README.md"] + [os.path.basename(p) for p in translated]

    for path in translated:
        name = os.path.basename(path)
        text, section = quick_start(path)
        if section is None:
            errors.append(f"{name}: no single {START} … {END} section")
            continue
        if FENCE.findall(section) != blocks:
            errors.append(
                f"{name}: the Quick start code blocks differ from README.md's; copy them across"
            )

    # The language row: every README links every other one.
    for name in readmes:
        with open(os.path.join(ROOT, name), encoding="utf-8") as f:
            text = f.read() if name != "README.md" else english_text
        for other in readmes:
            if other != name and f'href="{other}"' not in text:
                errors.append(f"{name}: the language row does not link {other}")

    for e in errors:
        print(e, file=sys.stderr)
    if errors:
        sys.exit(1)
    print(f"READMEs in sync: {', '.join(readmes)}; {len(blocks)} Quick start blocks match.")


if __name__ == "__main__":
    main()
