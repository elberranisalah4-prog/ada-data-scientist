import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function isBinaryPart(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value !== "string" && typeof value.arrayBuffer === "function";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const useSample = String(form.get("sample") ?? "") === "1";
  const targetRaw = form.get("target");
  const target = typeof targetRaw === "string" && targetRaw.trim() ? targetRaw.trim() : "";

  const dir = await mkdtemp(path.join(tmpdir(), "ada-"));
  const csvPath = path.join(dir, "input.csv");
  let filename = "dataset.csv";

  try {
    if (useSample) {
      const sample = path.join(process.cwd(), "public", "samples", "customers.csv");
      if (!existsSync(sample)) {
        await rm(dir, { recursive: true, force: true });
        return Response.json({ error: "customers.csv est introuvable." }, { status: 404 });
      }
      await writeFile(csvPath, await readFile(sample));
      filename = "customers.csv";
    } else if (isBinaryPart(file)) {
      if (file.size > 20 * 1024 * 1024) {
        await rm(dir, { recursive: true, force: true });
        return Response.json({ error: "Fichier trop volumineux (20 Mo max)." }, { status: 413 });
      }
      await writeFile(csvPath, Buffer.from(await file.arrayBuffer()));
      filename = "name" in file && file.name ? file.name : "dataset.csv";
    } else {
      await rm(dir, { recursive: true, force: true });
      return Response.json({ error: "Aucun fichier CSV." }, { status: 400 });
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    return Response.json(
      { error: err instanceof Error ? err.message : "Impossible de lire le CSV." },
      { status: 400 }
    );
  }

  const agent = path.join(process.cwd(), "pipeline", "agent.py");
  const args = ["-u", agent, "--csv", csvPath, "--filename", filename];
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
