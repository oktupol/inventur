import { Worker } from 'node:worker_threads';
import type { CountListInfo } from './document.ts';
import type { WorkAreaCountList } from './model.ts';

/**
 * Renders the count list in a worker thread. Laying out thousands of lines
 * takes seconds, which would otherwise delay the scans of all workstations.
 */
export function renderCountList(
  areas: readonly WorkAreaCountList[],
  info: CountListInfo,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./render-worker.ts', import.meta.url), {
      workerData: { areas, info },
    });
    worker.on('message', (message: unknown) => {
      // In watch mode (development), Node also reports the modules the
      // worker imports; only the PDF is a byte array.
      if (message instanceof Uint8Array) resolve(Buffer.from(message));
    });
    worker.once('error', reject);
    // Without effect once the PDF has arrived.
    worker.once('exit', (code) => reject(new Error(`Count list worker exited with code ${code}`)));
  });
}
