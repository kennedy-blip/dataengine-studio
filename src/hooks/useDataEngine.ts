'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { createSampleDatasets } from '@/lib/sample';
import { MAX_ROWS, type ParseOptions, type PipelineStep, type ProcessedDataset, type SavedWorkspace, type SourceDataset, type WorkerRequestPayload, type WorkerResponse } from '@/lib/types';

const STORAGE_KEY = 'dataengine-workspace-v1';
const initial: SavedWorkspace = { version: 1, sources: [], recipes: {}, activeId: '', projectName: 'Customer data pipeline' };
export function useDataEngine() {
  const [state, setState] = useState<SavedWorkspace>(initial);
  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [output, setOutput] = useState<ProcessedDataset | null>(null);
  const [busy, setBusy] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [runVersion, setRunVersion] = useState(0);
  const [histories, setHistories] = useState<Record<string, { past: PipelineStep[][]; future: PipelineStep[][] }>>({});
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const pending = useRef(new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>());
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const request = useCallback((message: WorkerRequestPayload) => new Promise<WorkerResponse>((resolve, reject) => {
    if (!worker.current) { reject(new Error('The processing engine is starting. Please try again.')); return; }
    const id = ++requestId.current;
    pending.current.set(id, { resolve, reject });
    worker.current.postMessage({ ...message, requestId: id });
  }), []);

  useEffect(() => {
    const w = new Worker(new URL('../workers/data.worker.ts', import.meta.url), { type: 'module' });
    const tasks = pending.current;
    worker.current = w;
    w.onmessage = (event: MessageEvent<WorkerResponse>) => { const task = pending.current.get(event.data.requestId); if (task) { pending.current.delete(event.data.requestId); task.resolve(event.data); } };
    w.onerror = () => { pending.current.forEach(task => task.reject(new Error('The processing worker stopped. Refresh to restore your saved workspace.'))); pending.current.clear(); setError('The processing worker stopped. Refresh to restore your saved workspace.'); setBusy(false); setImporting(false); };
    let cancelled = false;
    async function hydrate() {
      try {
        const saved = await get<SavedWorkspace>(STORAGE_KEY);
        const valid = saved?.version === 1 && Array.isArray(saved.sources) && saved.sources.every(d => typeof d.id === 'string' && Array.isArray(d.rows) && d.rows.length <= MAX_ROWS);
        const next = valid ? saved : { ...initial, sources: createSampleDatasets(), activeId: 'demo-customers' };
        if (!next.sources.some(d => d.id === next.activeId)) next.activeId = next.sources[0]?.id ?? '';
        if (!cancelled) { setState(next); setHydrated(true); setReady(true); }
      } catch {
        if (!cancelled) { setState({ ...initial, sources: createSampleDatasets(), activeId: 'demo-customers' }); setHydrated(true); setReady(true); setSaveStatus('error'); }
      }
    }
    void hydrate();
    return () => { cancelled = true; w.terminate(); worker.current = null; tasks.forEach(task => task.reject(new Error('Workspace closed.'))); tasks.clear(); };
  }, []);

  useEffect(() => {
    if (!ready || !hydrated) return;
    let cancelled = false;
    async function load() {
      const response = await request({ type: 'load', datasets: state.sources });
      if (cancelled) return;
      if (response.ok) setLoadedVersion(v => v + 1);
      else { setError(response.error); setBusy(false); }
    }
    void load().catch(e => { if (!cancelled) { setError(e.message); setBusy(false); } });
    return () => { cancelled = true; };
  }, [state.sources, ready, hydrated, request]);

  useEffect(() => {
    if (!loadedVersion || !hydrated) return;
    let cancelled = false;
    const current = stateRef.current;
    async function run() {
      setBusy(true); setError('');
      if (!current.activeId) { setOutput(null); setBusy(false); return; }
      const response = await request({ type: 'run', id: current.activeId, steps: current.recipes[current.activeId] ?? [] });
      if (cancelled) return;
      if (response.ok && response.result && 'quality' in response.result) setOutput(response.result);
      else if (!response.ok) { setError(response.error); setOutput(null); }
      setBusy(false);
    }
    void run().catch(e => { if (!cancelled) { setError(e.message); setBusy(false); } });
    return () => { cancelled = true; };
  }, [state.activeId, state.recipes, loadedVersion, runVersion, hydrated, request]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSaveStatus('saving');
      set(STORAGE_KEY, state).then(() => { if (!cancelled) setSaveStatus('saved'); }).catch(() => { if (!cancelled) setSaveStatus('error'); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [state, hydrated]);

  const changeRecipe = useCallback((next: PipelineStep[]) => {
    const current = stateRef.current; const id = current.activeId;
    const old = current.recipes[id] ?? [];
    setHistories(h => ({ ...h, [id]: { past: [...(h[id]?.past ?? []), old].slice(-30), future: [] } }));
    setState(s => ({ ...s, recipes: { ...s.recipes, [id]: next } }));
  }, []);
  const addStep = useCallback((step: PipelineStep) => changeRecipe([...(stateRef.current.recipes[stateRef.current.activeId] ?? []), step]), [changeRecipe]);
  const updateStep = useCallback((id: string, step: PipelineStep) => changeRecipe((stateRef.current.recipes[stateRef.current.activeId] ?? []).map(s => s.id === id ? step : s)), [changeRecipe]);
  const removeStep = useCallback((id: string) => changeRecipe((stateRef.current.recipes[stateRef.current.activeId] ?? []).filter(s => s.id !== id)), [changeRecipe]);
  const undo = useCallback(() => {
    const id = stateRef.current.activeId, history = histories[id]; if (!history?.past.length) return;
    const previous = history.past[history.past.length - 1];
    setHistories(h => ({ ...h, [id]: { past: history.past.slice(0, -1), future: [stateRef.current.recipes[id] ?? [], ...history.future] } }));
    setState(s => ({ ...s, recipes: { ...s.recipes, [id]: previous } }));
  }, [histories]);
  const redo = useCallback(() => {
    const id = stateRef.current.activeId, history = histories[id]; if (!history?.future.length) return;
    const next = history.future[0];
    setHistories(h => ({ ...h, [id]: { past: [...history.past, stateRef.current.recipes[id] ?? []], future: history.future.slice(1) } }));
    setState(s => ({ ...s, recipes: { ...s.recipes, [id]: next } }));
  }, [histories]);
  const importFiles = useCallback(async (files: File[], options: ParseOptions) => {
    setImporting(true);
    const added: SourceDataset[] = [], failures: string[] = [], warnings: string[] = [];
    for (const file of files) {
      try { const response = await request({ type: 'parse', file, options }); if (response.ok && Array.isArray(response.result)) { added.push(...response.result); } else if (!response.ok) failures.push(`${file.name}: ${response.error}`); }
      catch (e) { failures.push(`${file.name}: ${e instanceof Error ? e.message : 'Import failed.'}`); }
    }
    if (added.length) setState(s => ({ ...s, sources: [...s.sources, ...added], activeId: s.activeId || added[0].id }));
    setImporting(false);
    return { added, failures, warnings };
  }, [request]);
  const addSource = useCallback((source: SourceDataset) => setState(s => ({ ...s, sources: [...s.sources, source], activeId: source.id })), []);
  const selectDataset = useCallback((id: string) => { setOutput(null); setState(s => ({ ...s, activeId: id })); }, []);
  const removeDataset = useCallback((id: string) => { setOutput(null); setState(s => { const sources = s.sources.filter(d => d.id !== id); return { ...s, sources, activeId: s.activeId === id ? sources[0]?.id ?? '' : s.activeId }; }); }, []);
  const resetDemo = useCallback(() => { setOutput(null); setHistories({}); setState({ ...initial, sources: createSampleDatasets(), activeId: 'demo-customers' }); }, []);
  const clearWorkspace = useCallback(() => { setOutput(null); setHistories({}); setState({ version: 1, sources: [], recipes: {}, activeId: '', projectName: 'Untitled pipeline' }); }, []);
  const renameProject = useCallback((projectName: string) => setState(s => ({ ...s, projectName: projectName.trim().slice(0, 80) || 'Untitled pipeline' })), []);
  const active = state.sources.find(d => d.id === state.activeId);
  const steps = state.recipes[state.activeId] ?? [];
  return { ...state, active, steps, output, busy, importing, error, saveStatus, hydrated, importFiles, addSource, selectDataset, removeDataset, addStep, updateStep, removeStep, changeRecipe, undo, redo, canUndo: !!histories[state.activeId]?.past.length, canRedo: !!histories[state.activeId]?.future.length, resetDemo, clearWorkspace, renameProject, rerun: () => setRunVersion(v => v + 1) };
}
export type DataEngine = ReturnType<typeof useDataEngine>;
