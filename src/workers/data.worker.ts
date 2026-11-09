import { parseFile } from '../lib/parsers';
import { runPipeline } from '../lib/operations';
import type { SourceDataset, WorkerRequest, WorkerResponse } from '../lib/types';

const sources = new Map<string, SourceDataset>();
const scope = self as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage: (message: WorkerResponse) => void };
scope.onmessage = async event => {
  const request = event.data;
  try {
    if (request.type === 'parse') {
      const result = await parseFile(request.file, request.options);
      result.datasets.forEach(dataset => sources.set(dataset.id, dataset));
      scope.postMessage({ requestId: request.requestId, ok: true, result: result.datasets });
    } else if (request.type === 'load') {
      sources.clear(); request.datasets.forEach(dataset => sources.set(dataset.id, dataset));
      scope.postMessage({ requestId: request.requestId, ok: true, result: null });
    } else if (request.type === 'remove') {
      sources.delete(request.id); scope.postMessage({ requestId: request.requestId, ok: true, result: null });
    } else {
      const source = sources.get(request.id);
      if (!source) throw new Error('Dataset not found. Import the file again.');
      const result = runPipeline(source.rows, request.steps, sources);
      scope.postMessage({ requestId: request.requestId, ok: true, result });
    }
  } catch (error) {
    scope.postMessage({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : 'Unable to process this data.' });
  }
};
