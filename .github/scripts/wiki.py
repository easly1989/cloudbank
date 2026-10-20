#!/usr/bin/env python3
"""Build the GitHub wiki from docs/ (#605).

The wiki is a mirror, never a source: every guide listed in docs/README.md
becomes a page, plus Home (the index itself) and the changelog. Links between
guides become links between wiki pages; anything else in the repository
becomes an absolute link to it on main, so nothing points at a file the wiki
does not have. Each page opens with a line naming the file it was copied from.

    python3 .github/scripts/wiki.py <wiki-checkout>

It replaces every page in the checkout, writes _Sidebar.md in the order of the
index, and fails if any link between pages points at one that does not exist.
The output depends only on the files, so an unchanged docs/ rewrites nothing.
"""

import os
import re
import sys

REPO = "easly1989/cloudbank"
BLOB = f"https://github.com/{REPO}/blob/main/"
TREE = f"https://github.com/{REPO}/tree/main/"
RAW = f"https://github.com/{REPO}/raw/main/"
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Page names that a plain title-casing of the file name would get wrong.
NAMES = {
    "migrate-from-homebank.md": "Migrate-from-HomeBank",
    "sso.md": "SSO",
    "ai.md": "AI",
    "home-assistant.md": "Home-Assistant",
}

LINK = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)")
FENCE = re.compile(r"^(```|~~~)")


def page_name(file):
    if file in NAMES:
        return NAMES[file]
    stem = file[:-3]
    return stem[:1].upper() + stem[1:]


def guides():
    """The guides docs/README.md links to, in its order: (file, page)."""
    seen = []
    with open(os.path.join(ROOT, "docs", "README.md"), encoding="utf-8") as f:
        for _, _, target in LINK.findall(f.read()):
            file = target.split("#")[0]
            if re.fullmatch(r"[\w.-]+\.md", file) and file != "README.md" and file not in seen:
                if os.path.exists(os.path.join(ROOT, "docs", file)):
                    seen.append(file)
    return [(file, page_name(file)) for file in seen]


def rewrite(text, src_dir, pages):
    """Rewrite the relative links of a file that lives in src_dir (repo-relative)."""

    def one(m):
        bang, label, target = m.groups()
        if re.match(r"([a-z]+:|#|/)", target):
            return m.group(0)
        path, _, anchor = target.partition("#")
        anchor = "#" + anchor if anchor else ""
        rel = os.path.normpath(os.path.join(src_dir, path)).replace(os.sep, "/")
        if rel.startswith("docs/") and rel[5:] in pages and not bang:
            return f"[{label}]({pages[rel[5:]]}{anchor})"
        if rel == "docs/README.md" and not bang:
            return f"[{label}](Home{anchor})"
        if rel == "CHANGELOG.md" and not bang:
            return f"[{label}](Changelog{anchor})"
        if bang:
            return f"![{label}]({RAW}{rel})"
        base = TREE if os.path.isdir(os.path.join(ROOT, rel)) else BLOB
        return f"[{label}]({base}{rel}{anchor})"

    out, fenced = [], False
    for line in text.splitlines():
        if FENCE.match(line.strip()):
            fenced = not fenced
            out.append(line)
            continue
        out.append(line if fenced else LINK.sub(one, line))
    return "\n".join(out) + "\n"


def header(src):
    return (
        f"> This page is copied from [`{src}`]({BLOB}{src}) whenever it changes. "
        f"To correct it, open a pull request on that file.\n\n"
    )


def sidebar(pages):
    """The index's sections, each with its guides, then the changelog."""
    lines = ["**[CloudBank](Home)**", ""]
    with open(os.path.join(ROOT, "docs", "README.md"), encoding="utf-8") as f:
        for line in f:
            h = re.match(r"^##\s+(.*)", line)
            if h:
                lines += ["", f"**{h.group(1).strip()}**", ""]
                continue
            item = re.match(r"^- \[([^\]]+)\]\(([\w.-]+\.md)(#[^)]*)?\)", line)
            if item and item.group(2) in pages:
                lines.append(f"- [{item.group(1)}]({pages[item.group(2)]})")
    lines += ["", "**Project**", "", "- [Changelog](Changelog)", ""]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def check(out_dir, names):
    """Every relative link in the wiki names a page that exists."""
    broken = []
    for file in sorted(os.listdir(out_dir)):
        if not file.endswith(".md"):
            continue
        with open(os.path.join(out_dir, file), encoding="utf-8") as f:
            fenced = False
            for line in f:
                if FENCE.match(line.strip()):
                    fenced = not fenced
                if fenced:
                    continue
                for bang, _, target in LINK.findall(line):
                    if bang or re.match(r"([a-z]+:|#)", target):
                        continue
                    if target.split("#")[0] not in names:
                        broken.append(f"{file}: {target}")
    return broken


def main(out_dir):
    listed = guides()
    pages = dict(listed)
    docs = {"Home": ("docs/README.md", "docs")}
    for file, page in listed:
        docs[page] = (f"docs/{file}", "docs")
    docs["Changelog"] = ("CHANGELOG.md", "")

    for file in os.listdir(out_dir):
        if file.endswith(".md"):
            os.remove(os.path.join(out_dir, file))
    for page, (src, src_dir) in docs.items():
        with open(os.path.join(ROOT, src), encoding="utf-8") as f:
            body = rewrite(f.read(), src_dir, pages)
        with open(os.path.join(out_dir, page + ".md"), "w", encoding="utf-8", newline="\n") as f:
            f.write(header(src) + body)
    with open(os.path.join(out_dir, "_Sidebar.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(sidebar(pages))

    broken = check(out_dir, set(docs))
    if broken:
        print("broken links in the wiki:\n  " + "\n  ".join(broken), file=sys.stderr)
        return 1
    print(f"wiki: {len(docs)} pages and the sidebar")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit("usage: wiki.py <wiki-checkout>")
    sys.exit(main(sys.argv[1]))
