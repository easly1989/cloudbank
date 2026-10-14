import base from "./playwright.config";

// The language check (#614): every page in every language, against the demo
// build (npm run test:i18n).
export default { ...base, testDir: "./i18n" };
