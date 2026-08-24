import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function pythonBin(): string {
  const local = path.join(process.cwd(), ".venv", "bin", "python");
  if (existsSync(local)) return local;
  return "python3";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const targetRaw = form.get("target");
  const target = typeof targetRaw === "string" && targetRaw.trim() ? targetRaw.trim() : "";

  if (!(file instanceof File)) {
    return Response.json({ error: "Aucun fichier CSV." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return Response.json({ error: "Fichier trop volumineux (20 Mo max)." }, { status: 413 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ada-"));
  const csvPath = path.join(dir, "input.csv");
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(csvPath, bytes);

  const agent = path.join(process.cwd(), "pipeline", "agent.py");
  const args = ["-u", agent, "--csv", csvPath, "--filename", file.name || "dataset.csv"];
  if (target) args.push("--target", target);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(pythonBin(), args, {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          OMP_NUM_THREADS: "2",
          MKL_NUM_THREADS: "2",
        },
      });

      let buf = "";
      let closed = false;
      let sawError = false;
      const pushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.includes('"type": "error"')) sawError = true;
        controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) pushLine(line);
      });

      proc.stderr.on("data", () => {
        /* sklearn / xgboost noise ignored — errors go through NDJSON */
      });

      const finish = async (code: number | null) => {
        if (closed) return;
        closed = true;
        if (buf.trim()) pushLine(buf);
        if (code && code !== 0 && !sawError) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Le pipeline s'est arrêté de façon inattendue." })}\n\n`
            )
          );
        }
        controller.close();
        await rm(dir, { recursive: true, force: true });
      };

      proc.on("close", (code) => {
        void finish(code);
      });
      proc.on("error", () => {
        void finish(1);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
