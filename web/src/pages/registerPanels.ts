/** The register's two side panels. On a desktop both can be open, one above the other (#535). */
export type PanelId = "filters" | "columns";
export type RegisterPanels = Record<PanelId, boolean>;
export const noPanels: RegisterPanels = { filters: false, columns: false };
