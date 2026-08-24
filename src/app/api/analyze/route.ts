import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function pythonBin(): string {
  return process.env.ADA_PYTHON || "python3";
}

function isBinaryPart(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value !== "string" && typeof value.arrayBuffer === "function";
}

async function readUpload(request: Request): Promise<{
  useSample: boolean;
  target: string;
  file: FormDataEntryValue | null;
}> {
  const url = new URL(request.url);
  let useSample = url.searchParams.get("sample") === "1";
  let target = url.searchParams.get("target")?.trim() ?? "";
  let file: FormDataEntryValue | null = null;

  if (useSample) {
    return { useSample, target, file };
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const form = await request.formData();
    useSample = String(form.get("sample") ?? "") === "1";
    file = form.get("file");
    const fromForm = form.get("target");
    if (typeof fromForm === "string" && fromForm.trim()) {
      target = fromForm.trim();
    }
  }

  return { useSample, target, file };
}

export async function POST(request: Request) {
  const { useSample, target, file } = await readUpload(request);

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

  let proc: ChildProcess | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const pushLine = (line: string) => {
        if (closed) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
        } catch {
          closed = true;
          proc?.kill("SIGTERM");
        }
      };

      proc = spawn(pythonBin(), args, {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          OMP_NUM_THREADS: "2",
          MKL_NUM_THREADS: "2",
          PATH: pythonBin().includes(path.sep)
            ? `${path.dirname(pythonBin())}${path.delimiter}${process.env.PATH ?? ""}`
            : process.env.PATH,
        },
      });

      let buf = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) pushLine(line);
      });

      proc.stderr?.on("data", () => {
        /* sklearn / xgboost noise ignored — errors go through NDJSON */
      });

      const finish = (code: number | null) => {
        if (closed) {
          void rm(dir, { recursive: true, force: true });
          return;
        }
        if (buf.trim()) pushLine(buf);
        if (code && code !== 0 && !buf.includes('"type": "error"')) {
          pushLine(
            JSON.stringify({
              type: "error",
              message: "Le pipeline s'est arrêté de façon inattendue.",
            })
          );
        }
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
        void rm(dir, { recursive: true, force: true });
      };

      proc.on("close", (code) => finish(code));
      proc.on("error", () => finish(1));
    },
    cancel() {
      closed = true;
      proc?.kill("SIGTERM");
      void rm(dir, { recursive: true, force: true });
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
