import { create } from "zustand";
import type { ProjectV2 } from "@forma/document";
export const useVolumePreview = create<{
  document: ProjectV2 | null;
  revision: number;
}>(() => ({ document: null, revision: 0 }));
