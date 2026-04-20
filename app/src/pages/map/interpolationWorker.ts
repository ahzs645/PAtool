import type { InterpolationWorkerResponse } from "../../lib/interpolationProtocol";

export function createInterpolationWorker(
  onmessage: (event: MessageEvent<InterpolationWorkerResponse>) => void,
): Worker {
  const worker = new Worker(new URL("../../workers/interpolation.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = onmessage;
  return worker;
}
