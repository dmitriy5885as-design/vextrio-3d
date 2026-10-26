import { create } from "zustand";
import type { EntityRef } from "@forma/document";
import type { Vec3 } from "@forma/shared";
export interface PushPullGesture {
  ref: EntityRef;
  anchor: Vec3;
  normal: Vec3;
  revision: number;
  side: 1 | -1;
  limit: number | null;
  distance: number;
}
export const usePushPull = create<{
  gesture: PushPullGesture | null;
  commitId: number;
  committing: boolean;
  editing: boolean;
  begin: (g: PushPullGesture) => void;
  move: (distance: number) => void;
  confirm: () => void;
  cancel: () => void;
}>((set, get) => ({
  gesture: null,
  commitId: 0,
  committing: false,
  editing: false,
  begin: (gesture) => set({ gesture, committing: false, editing: false }),
  move: (distance) => {
    const g = get().gesture;
    if (g && !get().committing && !get().editing && Number.isFinite(distance))
      set({
        gesture: {
          ...g,
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
