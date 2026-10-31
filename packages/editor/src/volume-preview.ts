import { create } from "zustand";
import type { ProjectV2 } from "@forma/document";
export const useGeometryPreview = create<{
  document: ProjectV2 | null;
  revision: number;
  owner: "extrude" | "offset" | "translate" | null;
}>(() => ({ document: null, revision: 0, owner: null }));

// Compatibility alias for existing volume-tool integrations.
export const useVolumePreview = useGeometryPreview;
