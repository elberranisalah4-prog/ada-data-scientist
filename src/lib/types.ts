export const STAGE_IDS = [
  "data",
  "cleaning",
  "eda",
  "features",
  "ml",
  "evaluation",
  "visualization",
  "report",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export type StageStatus = "idle" | "pending" | "running" | "done" | "error";

export type FindingKind = "observation" | "action" | "decision";

export type StageDef = {
  id: StageId;
  label: string;
  blurb: string;
};

export type Finding = {
  stage: StageId;
  kind: FindingKind;
  title: string;
  detail: string;
};

export type LeaderboardRow = {
  name: string;
  cv_mean: number;
  cv_std: number;
  scoring: string;
};

export type ChartPoint = { bin?: string; x?: number; count: number; label?: string };

export type AgentResult = {
  meta: {
    filename: string;
    rows: number;
    cols: number;
    rows_clean: number;
    target: string;
    task: "classification" | "regression";
    selected_model: string;
    scoring: string;
    classes: string[];
  };
  preview: { columns: string[]; rows: Record<string, unknown>[] };
  cleaning: {
    dropped: string[];
    duplicates: number;
    imputations: { column: string; n: number; method: string; value: unknown }[];
    outliers: string[];
  };
  eda: {
    numeric_summary: {
      column: string;
      mean: number;
      std: number;
      min: number;
      p50: number;
      max: number;
    }[];
    cat_summary: {
      column: string;
      n_unique: number;
      top: { label: string; count: number }[];
    }[];
    target_dist: { label: string; count: number }[];
    top_corr: { feature: string; corr: number }[];
  };
  features: { created: string[]; numeric: string[]; categorical: string[] };
  leaderboard: LeaderboardRow[];
  metrics: Record<string, number>;
  charts: {
    target_dist: { label: string; count: number }[];
    missing: { label: string; count: number }[];
    histograms: Record<string, { bin: string; x: number; count: number }[]>;
    corr_labels: string[];
    corr_matrix: (number | null)[][];
    top_corr: { feature: string; corr: number }[];
    leaderboard: LeaderboardRow[];
    roc: { fpr: number[]; tpr: number[] } | null;
    confusion: { labels: string[]; matrix: number[][] } | null;
    importances: { feature: string; importance: number }[];
    pred_scatter: { actual: number; pred: number }[];
    cat_summary: {
      column: string;
      n_unique: number;
      top: { label: string; count: number }[];
    }[];
  };
  recommendations: string[];
  report_md: string;
  rationale: string;
};

export type AgentEvent =
  | { type: "run_start"; filename: string; stages: StageDef[] }
  | { type: "stage_start"; id: StageId; intent: string }
  | { type: "finding"; stage: StageId; kind: FindingKind; title: string; detail: string }
  | { type: "stage_complete"; id: StageId; summary: string }
  | { type: "complete"; result: AgentResult }
  | { type: "error"; message: string; trace?: string };

export type StageState = {
  id: StageId;
  label: string;
  blurb: string;
  status: StageStatus;
  intent?: string;
  summary?: string;
  findings: Finding[];
};

export const DEFAULT_STAGES: StageDef[] = [
  { id: "data", label: "Données", blurb: "Profil du fichier et de la cible" },
  { id: "cleaning", label: "Nettoyage", blurb: "Qualité, manquants, doublons" },
  { id: "eda", label: "EDA", blurb: "Distributions, corrélations, déséquilibre" },
  { id: "features", label: "Features", blurb: "Variables dérivées et encodage" },
  { id: "ml", label: "Machine Learning", blurb: "Comparaison et sélection de modèles" },
  { id: "evaluation", label: "Évaluation", blurb: "Hold-out, métriques, erreurs" },
  { id: "visualization", label: "Visualisation", blurb: "Graphiques du run" },
  { id: "report", label: "Rapport", blurb: "Synthèse actionnable" },
];
