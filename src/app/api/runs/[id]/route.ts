import { NextResponse } from "next/server";
import { getRun } from "@/lib/runs-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const run = await getRun(id);
  if (!run) {
    return NextResponse.json({ error: "Run introuvable." }, { status: 404 });
  }
  return NextResponse.json(run);
}
