import { parentPort, workerData } from 'node:worker_threads';
import { renderPdf } from '../pdf/render.ts';
import { countListDocument, type CountListInfo } from './document.ts';
import type { WorkAreaCountList } from './model.ts';

// Runs in a worker thread, see `renderCountList`.
const { areas, info } = workerData as { areas: WorkAreaCountList[]; info: CountListInfo };
parentPort!.postMessage(await renderPdf(countListDocument(areas, info)));
