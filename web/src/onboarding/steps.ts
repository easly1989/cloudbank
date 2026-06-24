// The first-login tour steps. `target` is the value of a `data-tour` attribute
// rendered somewhere in the app; a step with no target is shown centred. Steps
// whose target isn't currently on screen still display (centred), so the tour is
// robust to the active page, screen size, and a collapsed sidebar.
export interface TourStep {
  target?: string;
  titleKey: string;
  bodyKey: string;
}

export const TOUR_STEPS: TourStep[] = [
  { titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
  { target: "nav", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
  { target: "wallet", titleKey: "tour.wallet.title", bodyKey: "tour.wallet.body" },
  { target: "quick-add", titleKey: "tour.quickAdd.title", bodyKey: "tour.quickAdd.body" },
  { target: "customize", titleKey: "tour.customize.title", bodyKey: "tour.customize.body" },
  { target: "settings", titleKey: "tour.settings.title", bodyKey: "tour.settings.body" },
];
