import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";
import { listRuns } from "@/lib/runs-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await pingDb();
  if (!health.ok) {
    return NextResponse.json({ ok: false, error: health.error, runs: [] }, { status: 503 });
  }
  const runs = await listRuns();
  return NextResponse.json({ ok: true, version: health.version, runs });
}
