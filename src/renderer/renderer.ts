import { createRendererController, type RendererController, type RendererDocument } from './renderer-app.ts';
import type { HoldVueApi } from '../preload-api.d.ts';

export function runRenderer(documentRef: RendererDocument | undefined, api: HoldVueApi | undefined, factory: typeof createRendererController = createRendererController): RendererController | null {
  if (!documentRef || !api) return null;
  const controller = factory(documentRef, api);
  controller.start();
  return controller;
}

const runtime = globalThis as typeof globalThis & { document?: RendererDocument; holdvue?: HoldVueApi };
runRenderer(runtime.document, runtime.holdvue);
