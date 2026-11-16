import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { PdfError, type PdfExtraction, type PdfExtractor, type PdfWorkerResult } from "./types.js";

export interface PdfExtractorOptions {
  maxConcurrent?: number;
  timeoutMs?: number;
  workerMemoryMb?: number;
}

export function createPdfExtractor(options: PdfExtractorOptions = {}): PdfExtractor {
  const { maxConcurrent = 2, timeoutMs = 15_000, workerMemoryMb = 256 } = options;
  for (const value of [maxConcurrent, timeoutMs, workerMemoryMb]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("PDF limits must be positive integers.");
  }
  let active = 0;

  return {
    async extract(bytes, { maxPages, signal }): Promise<PdfExtraction> {
      if (signal?.aborted) throw new PdfError("cancelled");
      if (active >= maxConcurrent) throw new PdfError("busy");
      active++;
      let worker: Worker | undefined;
      let timer: NodeJS.Timeout | undefined;
      let abort: (() => void) | undefined;
      try {
        worker = new Worker(join(__dirname, "worker.mjs"), {
          // Structured cloning preserves the caller's original bytes for R2.
          workerData: { bytes, maxPages },
          resourceLimits: { maxOldGenerationSizeMb: workerMemoryMb },
          stdout: true,
          stderr: true,
        });
        // Parser diagnostics may contain document content; do not forward them to logs.
        worker.stdout.resume();
        worker.stderr.resume();
        return await new Promise<PdfExtraction>((resolve, reject) => {
          abort = () => reject(new PdfError("cancelled"));
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
          timer = setTimeout(() => reject(new PdfError("timeout")), timeoutMs);
          worker!.once("message", (message: PdfWorkerResult) => {
            if (message.ok) resolve(message.result);
            else reject(new PdfError(message.code));
          });
          worker!.once("error", () => reject(new PdfError("processing_failed")));
          worker!.once("exit", () => reject(new PdfError("processing_failed")));
        });
      } catch (error) {
        throw error instanceof PdfError ? error : new PdfError("processing_failed");
      } finally {
        clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
        // Await termination before releasing the slot, including timeout/abort paths.
        try {
          if (worker) await worker.terminate();
        } finally {
          active--;
        }
      }
    },
  };
}
