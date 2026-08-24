"use client";

import { Badge } from "@/components/ui/badge";
import { kindLabel } from "@/lib/utils";
import type { Finding, FindingKind } from "@/lib/types";

const KIND_CLASS: Record<FindingKind, string> = {
  observation: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  action: "border-primary/30 bg-primary/10 text-primary",
  decision: "border-amber-500/35 bg-amber-500/10 text-amber-200",
};

export function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        En attente des faits publics de cette étape — pas de journal interne.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {findings.map((finding, index) => (
        <li
          key={`${finding.title}-${index}`}
          className="rounded-xl border border-border/80 bg-background/50 p-3"
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge className={KIND_CLASS[finding.kind]} variant="outline">
              {kindLabel(finding.kind)}
            </Badge>
            <p className="font-medium text-sm">{finding.title}</p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
        </li>
      ))}
    </ul>
  );
}
