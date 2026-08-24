"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric } from "@/lib/utils";
import type { AgentResult } from "@/lib/types";
import { Download } from "lucide-react";

const METRIC_LABELS: Record<string, string> = {
  accuracy: "Accuracy",
  f1_macro: "F1 macro",
  precision_macro: "Précision macro",
  recall_macro: "Rappel macro",
  roc_auc: "ROC-AUC",
  r2: "R²",
  mae: "MAE",
  rmse: "RMSE",
};

export function ReportPanel({ result }: { result: AgentResult }) {
  const download = () => {
    const blob = new Blob([result.report_md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-${result.meta.filename.replace(/\.csv$/i, "")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-heading text-2xl tracking-tight">{result.meta.selected_model}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {result.rationale}
          </p>
        </div>
        <Button variant="outline" onClick={download}>
          <Download data-icon="inline-start" />
          Télécharger le rapport
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Fichier" value={result.meta.filename} />
        <Stat
          label="Lignes"
          value={`${result.meta.rows_clean}`}
          hint={`${result.meta.rows} brutes → ${result.meta.rows_clean} propres`}
        />
        <Stat label="Cible" value={result.meta.target} hint={result.meta.task} />
        <Stat label="Scoring CV" value={result.meta.scoring} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(result.metrics).map(([key, value]) => (
          <Card key={key} size="sm">
            <CardHeader>
              <CardTitle className="text-xs text-muted-foreground font-normal">
                {METRIC_LABELS[key] ?? key}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-2xl tabular-nums">{formatMetric(value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Classement des modèles</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <ul className="divide-y">
            {result.leaderboard.map((row, index) => (
              <li key={row.name} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted-foreground">{index + 1}</span>
                  <span className="font-medium">{row.name}</span>
                  {index === 0 ? <Badge>retenu</Badge> : null}
                </div>
                <span className="tabular-nums text-sm">
                  {formatMetric(row.cv_mean)} ± {formatMetric(row.cv_std)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Recommandations</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            {result.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="truncate font-medium">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
