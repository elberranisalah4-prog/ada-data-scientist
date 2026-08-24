"use client";

import { cn } from "@/lib/utils";
import type { StageState } from "@/lib/types";
import {
  BarChart3,
  BrainCircuit,
  Check,
  Database,
  FileText,
  Layers,
  Search,
  Sparkles,
  Target,
} from "lucide-react";

const ICONS = {
  data: Database,
  cleaning: Sparkles,
  eda: Search,
  features: Layers,
  ml: BrainCircuit,
  evaluation: Target,
  visualization: BarChart3,
  report: FileText,
} as const;

export function WorkflowRail({
  stages,
  selectedId,
  onSelect,
}: {
  stages: StageState[];
  selectedId: string;
  onSelect: (id: StageState["id"]) => void;
}) {
  return (
    <ol className="relative flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-0 md:overflow-visible md:pb-0">
      {stages.map((stage, index) => {
        const Icon = ICONS[stage.id];
        const active = selectedId === stage.id;
        const done = stage.status === "done";
        const running = stage.status === "running";
        const error = stage.status === "error";
        return (
          <li key={stage.id} className="relative flex min-w-[9.5rem] md:min-w-0">
            {index < stages.length - 1 ? (
              <span
                className={cn(
                  "pointer-events-none absolute bg-border",
                  "top-5 left-11 h-px w-[calc(100%-2.75rem)] md:top-11 md:left-[1.15rem] md:h-[calc(100%-0.5rem)] md:w-px"
                )}
                aria-hidden
              />
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(stage.id)}
              className={cn(
                "relative z-10 flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors",
                active ? "bg-card ring-1 ring-primary/35" : "hover:bg-card/60"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs",
                  done && "border-primary/40 bg-primary/15 text-primary",
                  running && "border-primary bg-primary/20 text-primary shadow-[0_0_0_4px] shadow-primary/15",
                  error && "border-destructive/50 bg-destructive/15 text-destructive",
                  !done && !running && !error && "border-border bg-background text-muted-foreground"
                )}
              >
                {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-sm">{stage.label}</span>
                  {running ? (
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {stage.summary ?? stage.blurb}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
