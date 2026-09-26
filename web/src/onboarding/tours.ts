import type { Preferences } from "../api/client";

// Every page's tour, by id. `target` is the value of a `data-tour` attribute the
// page renders. A step without one is shown centred: that is a choice, made for
// a step that explains rather than points.
//
// A target that is not in the page at all is skipped when the tour runs — a
// register with no account has no first line to point at — and
// e2e/tests/zq-page-tours.spec.ts walks every tour on a seeded wallet to prove
// none is missing there. A renamed element would otherwise leave its step
// quietly pointing at nothing. A target that exists but has no size (the
// sidebar inside a closed phone drawer) is shown centred, as before.
export interface TourStep {
  target?: string;
  titleKey: string;
  bodyKey: string;
}

const step = (tour: string, name: string, target?: string): TourStep => ({
  target,
  titleKey: `tours.${tour}.${name}.title`,
  bodyKey: `tours.${tour}.${name}.body`,
});

export const TOURS = {
  // The first tour anyone saw, and still the overview's own: it introduces the
  // shell around every page as much as the page itself.
  dashboard: [
    { titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
    { target: "nav", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
    { target: "wallet", titleKey: "tour.wallet.title", bodyKey: "tour.wallet.body" },
    { target: "quick-add", titleKey: "tour.quickAdd.title", bodyKey: "tour.quickAdd.body" },
    { target: "customize", titleKey: "tour.customize.title", bodyKey: "tour.customize.body" },
    { target: "settings", titleKey: "tour.settings.title", bodyKey: "tour.settings.body" },
  ],
  register: [
    step("register", "account", "register-account"),
    step("register", "toolbar", "register-toolbar"),
    step("register", "newEntry", "register-new"),
    step("register", "more", "register-more"),
  ],
  accounts: [
    step("accounts", "add", "accounts-add"),
    step("accounts", "closed", "accounts-closed"),
  ],
  budget: [step("budget", "tabs", "budget-tabs"), step("budget", "editor", "budget-editor")],
  reports: [
    step("reports", "period", "reports-period"),
    step("reports", "tabs", "reports-tabs"),
    step("reports", "more", "reports-more"),
  ],
  schedules: [step("schedules", "add", "schedules-add"), step("schedules", "due")],
  bills: [step("bills", "list", "bills-list"), step("bills", "add", "bills-add")],
  goals: [step("goals", "add", "goals-add"), step("goals", "topUp")],
  bankSync: [
    step("bankSync", "providers", "banksync-providers"),
    step("bankSync", "connections", "banksync-connections"),
  ],
  review: [
    step("review", "categories", "review-categories"),
    step("review", "duplicates", "review-duplicates"),
  ],
  settings: [
    step("settings", "sections", "settings-rail"),
    step("settings", "entry", "entry-fields"),
    step("settings", "back", "settings-back"),
  ],
  data: [step("data", "import", "data-import"), step("data", "backup", "data-backup")],
} satisfies Record<string, TourStep[]>;

export type TourId = keyof typeof TOURS;

export const TOUR_IDS = Object.keys(TOURS) as TourId[];

export const isTourId = (v: string): v is TourId => v in TOURS;

/** The tours this reader has been offered. Before there were page tours there
 *  was one, and `tutorialSeen` said whether it had run: that was the overview's. */
export function toursSeen(prefs: Preferences | undefined): TourId[] {
  if (prefs?.toursSeen) return prefs.toursSeen.filter(isTourId);
  return prefs?.tutorialSeen ? ["dashboard"] : [];
}
