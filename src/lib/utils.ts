import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const TARGET_HINTS = [
  "churn",
  "target",
  "label",
  "y",
  "class",
  "outcome",
  "survived",
  "default",
  "fraude",
  "fraud",
  "attrition",
];

export function peekCsvColumns(text: string): string[] {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const semi = first.split(";").length;
  const comma = first.split(",").length;
  const sep = semi > comma ? ";" : ",";
  return first
    .split(sep)
    .map((cell) => cell.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

export function guessTarget(columns: string[]): string {
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const hint of TARGET_HINTS) {
    const hit = lower.get(hint);
    if (hit) return hit;
  }
  return columns[columns.length - 1] ?? "";
}

export function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

export function kindLabel(kind: "observation" | "action" | "decision"): string {
  if (kind === "observation") return "Observation";
  if (kind === "action") return "Action";
  return "Décision";
}
