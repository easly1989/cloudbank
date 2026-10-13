import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";

import { ApiError } from "./api/core";
import { ErrorMessage } from "./components/ErrorMessage";
import { errorText } from "./errorText";
import i18n, { i18nReady } from "./i18n";

describe("errorText", () => {
  beforeAll(async () => {
    await i18nReady;
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("gives a code with a sentence of its own that sentence, in the reader's language", async () => {
    await i18n.changeLanguage("it");
    const err = new ApiError(401, "invalid username or password", "invalid_credentials");
    expect(errorText(err)).toEqual({ message: "I dati di accesso non sono corretti." });
    await i18n.changeLanguage("en");
    expect(errorText(err).message).toBe("Those sign-in details are not correct.");
  });

  it("falls back by status, with the server's text as the detail, for a code without one", async () => {
    await i18n.changeLanguage("it");
    expect(errorText(new ApiError(400, "every_n must be at least 1", "invalid_every_n"))).toEqual({
      message: "Non è stato possibile completare l'operazione.",
      detail: "every_n must be at least 1",
    });
    expect(errorText(new ApiError(404, "goal not found", "not_found"))).toEqual({
      message: "Non c'è più: forse è stato eliminato.",
      detail: "goal not found",
    });
    expect(errorText(new ApiError(500, "could not save", "internal"))).toEqual({
      message: "Qualcosa è andato storto sul server.",
      detail: "could not save",
    });
    // A proxy's 502 has no code at all.
    expect(errorText(new ApiError(502, "Bad Gateway")).message).toBe(
      "Qualcosa è andato storto sul server.",
    );
  });

  it("keeps the provider's own words under its sentence", async () => {
    await i18n.changeLanguage("en");
    expect(
      errorText(new ApiError(502, "pluggy: item is waiting for user input", "provider_error")),
    ).toEqual({
      message: "The bank's provider did not answer as expected. Try again later.",
      detail: "pluggy: item is waiting for user input",
    });
  });

  it("says when the server cannot be reached, and covers any other error", async () => {
    await i18n.changeLanguage("en");
    expect(errorText(new TypeError("Failed to fetch"))).toEqual({
      message: "CloudBank could not be reached. Check the connection and try again.",
    });
    expect(errorText(new Error("boom"))).toEqual({
      message: "The operation could not be completed.",
      detail: "boom",
    });
  });

  it("shows the detail small, under the sentence, only when there is one", async () => {
    await i18n.changeLanguage("it");
    const { rerender } = render(
      <MantineProvider>
        <ErrorMessage error={new ApiError(400, "every_n must be at least 1", "invalid_every_n")} />
      </MantineProvider>,
    );
    expect(screen.getByText("Non è stato possibile completare l'operazione.")).toBeInTheDocument();
    expect(screen.getByText("Dettaglio: every_n must be at least 1")).toBeInTheDocument();
    rerender(
      <MantineProvider>
        <ErrorMessage
          error={new ApiError(409, "that username is already taken", "username_taken")}
        />
      </MantineProvider>,
    );
    expect(screen.getByText("Questo nome utente è già in uso.")).toBeInTheDocument();
    expect(screen.queryByText(/Dettaglio/)).toBeNull();
  });
});
