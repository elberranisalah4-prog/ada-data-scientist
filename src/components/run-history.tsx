"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RunSummary } from "@/lib/types";
import { Database } from "lucide-react";

export function RunHistory({
  runs,
  dbVersion,
  dbError,
  onOpen,
}: {
  runs: RunSummary[];
  dbVersion: string | null;
  dbError: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="w-full">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" />
          Historique MySQL
          {dbVersion ? (
            <Badge variant="outline" className="font-normal">
              {dbVersion}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {dbError ? (
          <p className="text-sm text-destructive">{dbError}</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun run enregistré. Chaque analyse (échantillon ou CSV) est écrite dans les tables{" "}
            <code className="text-xs">runs</code>, <code className="text-xs">findings</code> et{" "}
            <code className="text-xs">stage_logs</code>.
          </p>
        ) : (
          <ul className="divide-y">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onOpen(run.id)}
                  className="flex w-full items-start justify-between gap-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">{run.filename}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {run.target ?? "cible auto"}
                      {run.selected_model ? ` · ${run.selected_model}` : ""}
                      {run.rows_clean ? ` · ${run.rows_clean} lignes` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Badge variant={run.status === "done" ? "default" : run.status === "error" ? "destructive" : "secondary"}>
                      {run.status === "done" ? "terminé" : run.status === "error" ? "erreur" : "en cours"}
                    </Badge>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {formatWhen(run.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
