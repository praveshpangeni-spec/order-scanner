export const colors = {
  brand: "#0f766e",
  brandDark: "#115e59",
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  danger: "#dc2626",
  high: "#059669",
  highBg: "#d1fae5",
  medium: "#b45309",
  mediumBg: "#fef3c7",
  low: "#c2410c",
  lowBg: "#ffedd5",
  noneBg: "#f1f5f9",
};

export const confidenceStyle: Record<string, { bg: string; fg: string }> = {
  high: { bg: colors.highBg, fg: colors.high },
  medium: { bg: colors.mediumBg, fg: colors.medium },
  low: { bg: colors.lowBg, fg: colors.low },
  none: { bg: colors.noneBg, fg: colors.muted },
};

export function money(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
