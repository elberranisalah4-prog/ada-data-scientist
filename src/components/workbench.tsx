"use client";

import { useCallback, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartsGrid } from "@/components/charts-grid";
import { FindingList } from "@/components/finding-list";
import { ReportPanel } from "@/components/report-panel";
import { WorkflowRail } from "@/components/workflow-rail";
import {
  DEFAULT_STAGES,
  type AgentEvent,
  type AgentResult,
  type Finding,
  type StageId,
  type StageState,
} from "@/lib/types";
import { guessTarget, peekCsvColumns } from "@/lib/utils";

type RunStatus = "idle" | "running" | "done" | "error";

function initialStages(): StageState[] {
  return DEFAULT_STAGES.map((stage) => ({
    ...stage,
    status: "idle",
    findings: [],
  }));
}

export function Workbench() {
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>(initialStages);
  const [selectedId, setSelectedId] = useState<StageId>("data");
  const [result, setResult] = useState<AgentResult | null>(null);
  const [tab, setTab] = useState("workflow");

  const selected = stages.find((s) => s.id === selectedId) ?? stages[0];
  const doneCount = stages.filter((s) => s.status === "done").length;

  const onFile = useCallback(async (next: File | null) => {
    setFile(next);
    setResult(null);
    setError(null);
    setStatus("idle");
    setStages(initialStages());
    if (!next) {
      setColumns([]);
      setTarget("");
      return;
    }
    const text = await next.slice(0, 64_000).text();
    const cols = peekCsvColumns(text);
    setColumns(cols);
    setTarget(guessTarget(cols));
  }, []);

  const loadSample = async () => {
    const res = await fetch("/samples/customers.csv");
    if (!res.ok) {
      setError("Impossible de charger customers.csv.");
      return;
    }
    const blob = await res.blob();
    const sample = new File([blob], "customers.csv", { type: "text/csv" });
    const text = await sample.slice(0, 64_000).text();
    const cols = peekCsvColumns(text);
    setFile(sample);
    setColumns(cols);
    setTarget("churn");
    await run(sample, "churn");
  };

  const run = async (csvFile?: File, csvTarget?: string) => {
    const active = csvFile ?? file;
    const tgt = csvTarget ?? target;
    if (!active) return;
    setStatus("running");
    setError(null);
    setResult(null);
    setTab("workflow");
    setSelectedId("data");
    setStages(
      DEFAULT_STAGES.map((stage) => ({
        ...stage,
        status: "pending",
        findings: [],
      }))
    );

    const form = new FormData();
    form.append("file", active);
    if (tgt) form.append("target", tgt);

    try {
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Le serveur a refusé l'analyse.");
      }
      await consumeStream(res.body, {
        onEvent: (event) => {
          if (event.type === "run_start") {
            setStages((prev) =>
              (event.stages.length ? event.stages : DEFAULT_STAGES).map((def) => ({
                ...def,
                status: "pending" as const,
                findings: prev.find((s) => s.id === def.id)?.findings ?? [],
              }))
            );
          }
          if (event.type === "stage_start") {
            setSelectedId(event.id);
            setStages((prev) =>
              prev.map((s) =>
                s.id === event.id ? { ...s, status: "running", intent: event.intent } : s
              )
            );
          }
          if (event.type === "finding") {
            const finding: Finding = {
              stage: event.stage,
              kind: event.kind,
              title: event.title,
              detail: event.detail,
            };
            setStages((prev) =>
              prev.map((s) =>
                s.id === event.stage ? { ...s, findings: [...s.findings, finding] } : s
              )
            );
          }
          if (event.type === "stage_complete") {
            setStages((prev) =>
              prev.map((s) =>
                s.id === event.id ? { ...s, status: "done", summary: event.summary } : s
              )
            );
          }
          if (event.type === "complete") {
            setResult(event.result);
            setStatus("done");
            setSelectedId("report");
            setTab("report");
          }
          if (event.type === "error") {
            setError(event.message);
            setStatus("error");
            setStages((prev) =>
              prev.map((s) => (s.status === "running" ? { ...s, status: "error" } : s))
            );
          }
        },
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Analyse interrompue.");
    }
  };

  const reset = () => {
    setFile(null);
    setColumns([]);
    setTarget("");
    setResult(null);
    setError(null);
    setStatus("idle");
    setStages(initialStages());
    setSelectedId("data");
    setTab("workflow");
  };

  const findingsAll = useMemo(
    () => stages.flatMap((s) => s.findings),
    [stages]
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border/80 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 font-heading text-lg text-primary">
              A
            </span>
            <div>
              <p className="font-heading text-xl leading-none">Ada</p>
              <p className="text-xs text-muted-foreground">Agent data scientist autonome</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status !== "idle" ? (
              <Button variant="ghost" size="sm" onClick={reset}>
                Nouveau run
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
        {status === "idle" && !file ? (
          <IdleHero onFile={onFile} onSample={loadSample} dragOver={dragOver} setDragOver={setDragOver} />
        ) : (
          <>
            <aside className="lg:w-72 lg:shrink-0">
              <p className="mb-3 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Workflow
              </p>
              <WorkflowRail stages={stages} selectedId={selectedId} onSelect={setSelectedId} />
              {status === "running" ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  {doneCount}/{stages.length} étapes · les faits affichés sont les décisions
                  publiques du run, pas un journal interne.
                </p>
              ) : null}
            </aside>

            <main className="min-w-0 flex-1 space-y-4">
              {status === "idle" && file ? (
                <SetupCard
                  file={file}
                  columns={columns}
                  target={target}
                  setTarget={setTarget}
                  onRun={run}
                  onReplace={onFile}
                />
              ) : null}

              {error ? (
                <Card className="border-destructive/40">
                  <CardHeader>
                    <CardTitle>Analyse interrompue</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-destructive">{error}</CardContent>
                </Card>
              ) : null}

              {status !== "idle" ? (
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList variant="line" className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="workflow">Étape</TabsTrigger>
                    <TabsTrigger value="data" disabled={!result}>
                      Données
                    </TabsTrigger>
                    <TabsTrigger value="charts" disabled={!result}>
                      Visualisations
                    </TabsTrigger>
                    <TabsTrigger value="report" disabled={!result}>
                      Rapport
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="workflow" className="pt-4">
                    <Card>
                      <CardHeader className="border-b">
                        <CardTitle className="flex flex-col gap-1">
                          <span>{selected.label}</span>
                          {selected.intent ? (
                            <span className="text-sm font-normal text-muted-foreground">
                              {selected.intent}
                            </span>
                          ) : (
                            <span className="text-sm font-normal text-muted-foreground">
                              {selected.blurb}
                            </span>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <FindingList findings={selected.findings} />
                      </CardContent>
                    </Card>
                    {status === "running" && findingsAll.length === 0 ? (
                      <p className="pt-3 text-sm text-muted-foreground">Lecture du CSV…</p>
                    ) : null}
                  </TabsContent>
                  <TabsContent value="data" className="pt-4">
                    {result ? <PreviewTable result={result} /> : null}
                  </TabsContent>
                  <TabsContent value="charts" className="pt-4">
                    {result ? <ChartsGrid result={result} /> : null}
                  </TabsContent>
                  <TabsContent value="report" className="pt-4">
                    {result ? <ReportPanel result={result} /> : null}
                  </TabsContent>
                </Tabs>
              ) : null}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

function IdleHero({
  onFile,
  onSample,
  dragOver,
  setDragOver,
}: {
  onFile: (file: File | null) => void;
  onSample: () => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-10 py-6 lg:flex-row lg:items-center">
      <div className="max-w-xl space-y-5">
        <p className="text-[11px] font-medium tracking-[0.22em] text-primary uppercase">
          Data → Cleaning → EDA → Features → ML → Report
        </p>
        <h1 className="font-heading text-4xl leading-tight tracking-tight md:text-5xl">
          Un data scientist qui enchaîne le run tout seul.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Déposez un CSV. Ada nettoie, explore, fabrique des variables, compare régression
          logistique, forêt aléatoire et XGBoost, puis rédige un rapport. Chaque étape apparaît
          dans le workflow — uniquement les décisions utiles, pas une chaîne de pensée privée.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSample} size="lg">
            Analyser customers.csv
          </Button>
          <Button variant="outline" size="lg" render={<label htmlFor="csv-input" />}>
            Importer un CSV
          </Button>
        </div>
      </div>
      <label
        htmlFor="csv-input"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) onFile(dropped);
        }}
        className={`flex min-h-64 flex-1 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/10" : "border-border bg-card/60"
        }`}
      >
        <Upload className="mb-3 size-8 text-primary" />
        <p className="font-medium">Déposer customers.csv ici</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Un jeu télécom est fourni. Votre propre CSV fonctionne aussi : Ada détecte la cible
          (`churn`, `target`, `label`…) ou prend la dernière colonne.
        </p>
        <input
          id="csv-input"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}

function SetupCard({
  file,
  columns,
  target,
  setTarget,
  onRun,
  onReplace,
}: {
  file: File;
  columns: string[];
  target: string;
  setTarget: (v: string) => void;
  onRun: () => void;
  onReplace: (file: File | null) => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Prêt à lancer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{file.name}</span>
          {" · "}
          {(file.size / 1024).toFixed(1)} Ko
          {columns.length ? ` · ${columns.length} colonnes` : ""}
        </p>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Colonne cible</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="flex h-9 w-full max-w-sm rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          L&apos;agent choisira classification ou régression, puis le meilleur modèle sur une
          validation croisée.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRun} size="lg">
            Lancer l&apos;agent
          </Button>
          <Button variant="ghost" onClick={() => onReplace(null)}>
            Annuler
          </Button>
          <input
            id="csv-input"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => onReplace(e.target.files?.[0] ?? null)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewTable({ result }: { result: AgentResult }) {
  const cols = result.preview.columns;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Aperçu brut (8 premières lignes)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-3">
          <table className="w-max min-w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                {cols.map((col) => (
                  <th key={col} className="px-2 py-2 font-medium whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.preview.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/60">
                  {cols.map((col) => (
                    <td key={col} className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                      {row[col] === null || row[col] === undefined ? "—" : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-normal text-muted-foreground">Nettoyage</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {result.cleaning.duplicates} doublons · {result.cleaning.imputations.length} imputations
            · {result.cleaning.dropped.length} colonnes retirées
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-normal text-muted-foreground">Features créées</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {result.features.created.length ? result.features.created.join(", ") : "aucune"}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-normal text-muted-foreground">Schéma</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {result.features.numeric.length} numériques · {result.features.categorical.length} catégorielles
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  { onEvent }: { onEvent: (event: AgentEvent) => void }
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as AgentEvent);
      } catch {
        /* skip malformed chunk */
      }
    }
  }
}
