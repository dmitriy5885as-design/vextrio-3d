import { create } from "zustand";
import type { EntityRef } from "@forma/document";
import type { SnapCandidate } from "@forma/snapping";
import type { Vec3 } from "@forma/shared";
export interface PushPullGesture {
  ref: EntityRef;
  anchor: Vec3;
  normal: Vec3;
  revision: number;
  side: 1 | -1;
  limit: number | null;
  distance: number;
  snap?: SnapCandidate | null;
}
export const usePushPull = create<{
  gesture: PushPullGesture | null;
  commitId: number;
  committing: boolean;
  editing: boolean;
  begin: (g: PushPullGesture) => void;
  move: (distance: number, snap?: SnapCandidate | null) => void;
  setEditing: (editing: boolean) => void;
  confirm: () => void;
  cancel: () => void;
}>((set, get) => ({
  gesture: null,
  commitId: 0,
  committing: false,
  editing: false,
  begin: (gesture) => set({ gesture, committing: false, editing: false }),
  // The queued command guard owns this gesture object until completion.
  setEditing: (editing) =>
    set((state) => ({
      editing,
      gesture: state.committing
        ? state.gesture
        : state.gesture
          ? { ...state.gesture, snap: null }
          : null,
    })),
  move: (distance, snap = null) => {
    const g = get().gesture;
    if (g && !get().committing && !get().editing && Number.isFinite(distance))
      set({
        gesture: {
          ...g,
          snap: g.limit !== null && distance < g.limit ? null : snap,
          distance:
            g.limit !== null && distance <= g.limit ? g.limit : distance,
        },
      });
  },
  confirm: () => {
    if (!get().committing)
      set({ commitId: get().commitId + 1, committing: true });
  },
  cancel: () => set({ gesture: null, committing: false, editing: false }),
}));
