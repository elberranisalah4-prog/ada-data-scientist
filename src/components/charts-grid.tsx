"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric } from "@/lib/utils";
import type { AgentResult } from "@/lib/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="h-56">{children}</div>
      </CardContent>
    </Card>
  );
}

function AxisTick(props: { x?: number; y?: number; payload?: { value: string } }) {
  const { x = 0, y = 0, payload } = props;
  const value = String(payload?.value ?? "");
  const label = value.length > 14 ? `${value.slice(0, 13)}…` : value;
  return (
    <text x={x} y={y} dy={12} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>
      {label}
    </text>
  );
}

export function ChartsGrid({ result }: { result: AgentResult }) {
  const { charts, metrics, meta } = result;
  const rocData =
    charts.roc?.fpr.map((fpr, i) => ({
      fpr,
      tpr: charts.roc?.tpr[i] ?? 0,
      diag: fpr,
    })) ?? [];
  const histEntries = Object.entries(charts.histograms).slice(0, 4);
  const importanceData = charts.importances.slice().reverse();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {charts.target_dist.length > 0 ? (
        <ChartCard title="Distribution de la cible">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.target_dist}>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" vertical={false} />
              <XAxis dataKey="label" tick={<AxisTick />} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {charts.target_dist.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}

      {charts.missing.length > 0 ? (
        <ChartCard title="Manquants imputés">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.missing} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--chart-2)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}

      {charts.leaderboard.length > 0 ? (
        <ChartCard title="Comparaison des modèles (CV)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.leaderboard}>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" vertical={false} />
              <XAxis dataKey="name" tick={<AxisTick />} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatMetric(Number(v))} />
              <Bar dataKey="cv_mean" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}

      {importanceData.length > 0 ? (
        <ChartCard title={`Importances — ${meta.selected_model}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={importanceData} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} />
              <YAxis
                type="category"
                dataKey="feature"
                width={130}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="importance" fill="var(--chart-3)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}

      {rocData.length > 0 ? (
        <ChartCard title={`Courbe ROC${metrics.roc_auc ? ` · AUC ${formatMetric(metrics.roc_auc)}` : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rocData}>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" />
              <XAxis
                dataKey="fpr"
                type="number"
                domain={[0, 1]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
              />
              <YAxis
                dataKey="tpr"
                type="number"
                domain={[0, 1]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Line dataKey="diag" stroke="var(--muted-foreground)" strokeDasharray="4 4" dot={false} />
              <Line dataKey="tpr" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}

      {charts.confusion ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-sm">Matrice de confusion</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <HeatMatrix labels={charts.confusion.labels} matrix={charts.confusion.matrix} />
          </CardContent>
        </Card>
      ) : null}

      {charts.pred_scatter.length > 0 ? (
        <ChartCard title="Prédiction vs réel">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" />
              <XAxis
                dataKey="actual"
                name="réel"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
              />
              <YAxis
                dataKey="pred"
                name="prédit"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Scatter data={charts.pred_scatter} fill="var(--chart-1)" />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}

      {charts.corr_labels.length > 0 ? (
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-sm">Corrélations numériques</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-4">
            <CorrHeatmap labels={charts.corr_labels} matrix={charts.corr_matrix} />
          </CardContent>
        </Card>
      ) : null}

      {histEntries.map(([name, series]) => (
        <ChartCard key={name} title={`Distribution · ${name}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series}>
              <CartesianGrid stroke="color-mix(in oklch, var(--border) 80%, transparent)" vertical={false} />
              <XAxis dataKey="bin" hide />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ))}
    </div>
  );
}

function HeatMatrix({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const max = Math.max(...matrix.flat(), 1);
  return (
    <div className="flex flex-col gap-2">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `auto repeat(${labels.length}, minmax(3.5rem, 1fr))` }}
      >
        <span />
        {labels.map((label) => (
          <span key={label} className="px-1 text-center text-[11px] text-muted-foreground">
            préd. {label}
          </span>
        ))}
        {matrix.map((row, i) => (
          <div key={labels[i]} className="contents">
            <span className="pr-2 text-right text-[11px] text-muted-foreground">réel {labels[i]}</span>
            {row.map((value, j) => (
              <div
                key={`${i}-${j}`}
                className="flex aspect-square items-center justify-center rounded-lg text-sm font-medium"
                style={{
                  background: `color-mix(in oklch, var(--chart-1) ${Math.round((value / max) * 70)}%, var(--muted))`,
                }}
              >
                {value}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CorrHeatmap({ labels, matrix }: { labels: string[]; matrix: (number | null)[][] }) {
  return (
    <div
      className="grid w-max gap-1"
      style={{ gridTemplateColumns: `7rem repeat(${labels.length}, 3.25rem)` }}
    >
      <span />
      {labels.map((label) => (
        <span key={label} className="h-16 origin-bottom-left translate-x-3 -rotate-45 text-[10px] text-muted-foreground">
          {label}
        </span>
      ))}
      {matrix.map((row, i) => (
        <div key={labels[i]} className="contents">
          <span className="truncate pr-2 text-right text-[11px] text-muted-foreground">{labels[i]}</span>
          {row.map((value, j) => {
            const v = value ?? 0;
            const hue = v >= 0 ? "var(--chart-1)" : "var(--chart-4)";
            return (
              <div
                key={`${i}-${j}`}
                title={`${labels[i]} × ${labels[j]} = ${value?.toFixed(2) ?? "—"}`}
                className="flex size-12 items-center justify-center rounded-md text-[10px] font-medium"
                style={{
                  background: `color-mix(in oklch, ${hue} ${Math.round(Math.abs(v) * 75)}%, var(--muted))`,
                }}
              >
                {value === null ? "—" : value.toFixed(2)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};
