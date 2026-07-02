// Barrel re-exporting the domain-split API client. Each module owns one area
// (see core.ts for the request/api/ApiError/downloadFile infrastructure).
export * from "./core";
export * from "./auth";
export * from "./structure";
export * from "./ledger";
export * from "./dashboard";
export * from "./automation";
export * from "./finance";
export * from "./imports";
