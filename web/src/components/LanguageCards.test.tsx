import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import i18n from "../i18n";
import { languages, type Language } from "../i18n/languages";
import { LanguageCards } from "./LanguageCards";

const list: Language[] = [
  { code: "en", name: "English", beta: false, weekStart: 1 },
  { code: "it", name: "Italiano", beta: false, weekStart: 1 },
  { code: "de", name: "Deutsch", beta: true, weekStart: 1, correction: "Korrektur vorschlagen" },
  { code: "fr", name: "Français", beta: true, weekStart: 1, correction: "Proposer une correction" },
];

const cards = (value: string) =>
  render(
    <MantineProvider>
      <LanguageCards label="Language" value={value} onChange={() => {}} list={list} />
    </MantineProvider>,
  );

describe("LanguageCards", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows every language, its name in the app's language, and beta on the new ones", () => {
    cards("en");
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByText("Deutsch")).toBeInTheDocument();
    expect(screen.getByText("German")).toBeInTheDocument();
    expect(screen.getAllByText("beta")).toHaveLength(2);
  });

  it("offers the correction only on the chosen beta language, in that language", () => {
    cards("de");
    const link = screen.getByRole("link", { name: /Korrektur vorschlagen/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/easly1989/cloudbank/issues/new?template=translation.yml&language=de&title=%5Bde%5D%20",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("Proposer une correction")).toBeNull();
  });

  it("offers no correction on a complete language", () => {
    cards("it");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

// The form's language menu offers every language the app speaks, so the
// link's language=xx always picks an option.
describe("the translation form", () => {
  it("lists every language as an option", () => {
    // vitest runs from web/.
    const form = readFileSync(
      join(process.cwd(), "..", ".github", "ISSUE_TEMPLATE", "translation.yml"),
      "utf8",
    );
    for (const l of languages) expect(form).toMatch(new RegExp(`^\\s+- ${l.code}$`, "m"));
  });
});
