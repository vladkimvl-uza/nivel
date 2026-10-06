/** The kinds of the marks of honesty (DESIGN_SYSTEM 3.6, 7.8); a plain module, so that the core entry can list them. */
export const badgeKinds = ["demo", "draft", "visualization", "sample"] as const;
export type BadgeKind = (typeof badgeKinds)[number];
