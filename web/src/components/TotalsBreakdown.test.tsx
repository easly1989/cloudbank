import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { CurrencyInfo, DashboardAccount } from "../api/client";
import i18n from "../i18n";
import { TotalsBreakdown } from "./TotalsBreakdown";
import { accountsLabel, countedAccounts } from "./totalsCount";

const EUR: CurrencyInfo = {
  code: "EUR",
  symbol: "€",
  symbolPrefix: false,
  decimalChar: ",",
  groupChar: ".",
  fracDigits: 2,
};

const account = (id: number, name: string, today: number, extra: Partial<DashboardAccount> = {}) =>
  ({
    id,
    name,
    type: "bank",
    groupName: "",
    closed: false,
    noSummary: false,
    bank: today,
    today,
    future: today,
    currency: EUR,
    currencyId: 1,
    ...extra,
  }) as DashboardAccount;

const accounts = [
  account(1, "Checking", 492118),
  account(2, "Credit card", -30686),
  account(3, "Old savings", 100000, { closed: true }),
  account(4, "Pension", 900000, { noSummary: true }),
];

describe("TotalsBreakdown", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("counts the accounts the server sums, and says when some are left out", () => {
    expect(countedAccounts(accounts).map((a) => a.name)).toEqual(["Checking", "Credit card"]);
    expect(accountsLabel(i18n.t, accounts)).toBe("2 of 4 accounts");
    expect(accountsLabel(i18n.t, accounts.slice(0, 2))).toBe("2 accounts");
    expect(accountsLabel(i18n.t, accounts.slice(0, 1))).toBe("1 account");
  });

  it("lists each counted account and the total", () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <TotalsBreakdown accounts={accounts} balance="today" total={461432} base={EUR} withLink />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.getByText("Today, across 2 accounts")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.queryByText("Old savings")).toBeNull();
    expect(screen.queryByText("Pension")).toBeNull();
    const total = screen.getByText("Total").parentElement!;
    expect(within(total).getByText(/4\.614,32/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the accounts" })).toHaveAttribute(
      "href",
      "/accounts",
    );
  });
});
