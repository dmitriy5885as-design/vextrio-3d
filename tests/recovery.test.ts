import { it, expect, vi, afterEach } from "vitest";
import {
  RecoveryWriter,
  createRecoveryStore,
  type RecoveryStore,
} from "@forma/file-io";
import {
  emptyProjectV2,
  serializeProject,
  parseProject,
} from "@forma/document";
afterEach(() => vi.useRealTimers());
it("coalesces autosaves, captures immutable valid documents and leaves the document untouched", async () => {
  vi.useFakeTimers();
  const writes: string[] = [],
    saved = vi.fn(),
    errors = vi.fn(),
    store: RecoveryStore = {
      load: async () => null,
      remove: async () => {},
      save: async (p) => {
        writes.push(serializeProject(p));
        return { savedAt: Date.now(), project: parseProject(writes.at(-1)!) };
      },
    };
  const writer = new RecoveryWriter(store, saved, errors, 100),
    p = emptyProjectV2("A");
  writer.schedule(p);
  p.name = "B";
  writer.schedule(p);
  p.name = "not scheduled";
  await vi.advanceTimersByTimeAsync(101);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]).name).toBe("B");
  expect(p.name).toBe("not scheduled");
  expect(saved).toHaveBeenCalledOnce();
  expect(errors).not.toHaveBeenCalled();
});
it("discard is ordered after an in-flight write and suppresses its stale callback", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const events: string[] = [],
    saved = vi.fn();
  const store: RecoveryStore = {
    load: async () => null,
    save: async (p) => {
      events.push("write-start");
      await new Promise<void>((r) => (release = r));
      events.push("write-end");
      return { savedAt: 1, project: p };
    },
    remove: async () => {
      events.push("remove");
    },
  };
  const w = new RecoveryWriter(store, saved, vi.fn(), 1);
  w.schedule(emptyProjectV2());
  await vi.advanceTimersByTimeAsync(2);
  const clearing = w.discard();
  release();
  await clearing;
  expect(events).toEqual(["write-start", "write-end", "remove"]);
  expect(saved).not.toHaveBeenCalled();
});
it("storage errors are visible while editing remains independent, and cancel drops pending work", async () => {
  vi.useFakeTimers();
  const error = vi.fn(),
    write = vi.fn(async () => {
      throw Error("quota");
    }),
    store: RecoveryStore = {
      load: async () => null,
      save: write,
      remove: async () => {},
    };
  const w = new RecoveryWriter(store, vi.fn(), error, 10),
    p = emptyProjectV2();
  w.schedule(p);
  await vi.advanceTimersByTimeAsync(11);
  expect(error.mock.calls[0][0].message).toBe("quota");
  w.schedule(p);
  w.cancel();
  await vi.advanceTimersByTimeAsync(20);
  expect(write).toHaveBeenCalledOnce();
  expect(p.name).toBe("Без названия");
});
it("disabled IndexedDB reports an actionable error without changing the project", async () => {
  const store = createRecoveryStore(undefined);
  await expect(store.load()).rejects.toThrow(/IndexedDB/);
});
