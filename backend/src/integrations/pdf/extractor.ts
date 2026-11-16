import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { PdfError, type PdfExtraction, type PdfExtractor, type PdfWorkerResult } from "./types.js";

// Operational limits, not product rules. Excess concurrent work fails fast with "busy".
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 15_000;
// Caps the worker's V8 heap only; it is not a limit on total process memory.
const WORKER_MEMORY_MB = 256;

// Create ONE extractor per process; the concurrency limit is per instance.
// The options exist so tests can use small limits.
export function createPdfExtractor(
  { maxConcurrent = MAX_CONCURRENT, timeoutMs = TIMEOUT_MS } = {},
): PdfExtractor {
  let active = 0;

  return {
    async extract(bytes, { maxPages, signal }): Promise<PdfExtraction> {
      if (signal?.aborted) throw new PdfError("cancelled");
      if (active >= maxConcurrent) throw new PdfError("busy");
      active++;
      // PDF.js cannot be interrupted mid-parse, so it runs in a worker we can terminate.
      let worker: Worker | undefined;
      let removeListeners = () => {};
      try {
        worker = new Worker(join(__dirname, "worker.mjs"), {
          // Structured cloning gives the worker a copy; the caller's bytes stay intact for R2.
          workerData: { bytes, maxPages },
          resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB },
          stdout: true,
          stderr: true,
        });
        // Parser diagnostics may contain document content; discard them instead of logging.
        worker.stdout.resume();
        worker.stderr.resume();
        return await new Promise<PdfExtraction>((resolve, reject) => {
          const timer = setTimeout(() => reject(new PdfError("timeout")), timeoutMs);
          const cancel = () => reject(new PdfError("cancelled"));
          signal?.addEventListener("abort", cancel, { once: true });
          removeListeners = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
          };
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
        removeListeners();
        // Release the slot only after the worker is really gone, including on timeout/cancel.
        await worker?.terminate().catch(() => {});
        active--;
      }
    },
  };
}
