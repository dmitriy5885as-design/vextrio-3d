import { it, expect, vi } from "vitest";
import {
  createRecentProjectStore,
  RECENT_PROJECTS_KEY,
  createNativeFileAdapter,
  type RecentStorage,
} from "@forma/file-io";
import {
  emptyProjectV2,
  serializeProject,
  parseProject,
  validateProject,
} from "@forma/document";
import {
  createHomeProject,
  homeProjectSettings,
  templates,
} from "../apps/web/src/home/templates";
function storage() {
  const map = new Map<string, string>();
  const store: RecentStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
  return { map, store };
}
it.each(templates)(
  "creates a valid $name document and retains template settings through .v3d",
  (t) => {
    const p = createHomeProject({
      name: " Моя модель ",
      template: t.id,
      units: t.units,
    });
    validateProject(p);
    expect(p.name).toBe("Моя модель");
    expect(p.units).toBe(t.units);
    expect(p.format).toBe("forma");
    expect(p.schemaVersion).toBe(2);
    expect(Object.keys(p.geometries)).toHaveLength(0);
    expect(homeProjectSettings(parseProject(serializeProject(p)))).toEqual({
      gridStep: t.gridStep,
      planeName: "XZ",
    });
  },
);
it("changing template display units does not rescale its physical view", () => {
  const a = createHomeProject({ name: "a", template: "furniture", units: "m" }),
    b = createHomeProject({ name: "b", template: "furniture", units: "mm" });
  expect(a.camera).toEqual(b.camera);
  expect(homeProjectSettings(a)).toEqual(homeProjectSettings(b));
});
it("rejects invalid new-project input and ignores invalid template metadata", () => {
  expect(() =>
    createHomeProject({ name: " ", template: "empty", units: "m" }),
  ).toThrow();
  const p = emptyProjectV2();
  p.extensions["vextrio:home"] = {
    templateId: "printing",
    gridStep: -1,
    planeName: "XZ",
  };
  expect(homeProjectSettings(p)).toEqual({ gridStep: 0.25, planeName: "XZ" });
});
it("has an empty registry without invented projects", () => {
  const { store } = storage();
  expect(createRecentProjectStore(store).list()).toEqual([]);
});
it("stores browser metadata only and never treats a filename as access permission", () => {
  const { map, store } = storage(),
    r = createRecentProjectStore(store),
    file = { name: "Дом.v3d", size: 1200, lastModified: 12 };
  r.record("Дом", file, 123);
  const list = r.list();
  expect(list[0]).toMatchObject({
    name: "Дом",
    fileName: "Дом.v3d",
    source: "browser",
    available: false,
    lastOpened: 123,
  });
  expect(map.get(RECENT_PROJECTS_KEY)).not.toContain("geometries");
  expect(list[0].path).toBeUndefined();
});
it("deduplicates actual file identities and bounds the recent list", () => {
  const { store } = storage(),
    r = createRecentProjectStore(store);
  for (let i = 0; i < 20; i++)
    r.record("Model " + i, { name: i + ".v3d", size: 10, lastModified: 1 }, i);
  r.record("Model 19", { name: "19.v3d", size: 10, lastModified: 1 }, 100);
  expect(r.list()).toHaveLength(16);
  expect(r.list()[0].lastOpened).toBe(100);
});
it("removes only registry metadata", () => {
  const { store } = storage(),
    r = createRecentProjectStore(store);
  r.record("House", { name: "house.v3d", size: 5, lastModified: 1 });
  r.remove(r.list()[0].id);
  expect(r.list()).toEqual([]);
});
it("reports corrupt and unavailable storage without silently replacing it", () => {
  const { map, store } = storage();
  map.set(RECENT_PROJECTS_KEY, "broken");
  const r = createRecentProjectStore(store);
  expect(() => r.list()).toThrow();
  expect(() =>
    r.record("A", { name: "a.v3d", size: 1, lastModified: 1 }),
  ).toThrow();
  expect(map.get(RECENT_PROJECTS_KEY)).toBe("broken");
  r.clear();
  expect(r.list()).toEqual([]);
  const fail = createRecentProjectStore({
    ...store,
    setItem: () => {
      throw Error("quota");
    },
  });
  expect(() =>
    fail.record("A", { name: "a.v3d", size: 1, lastModified: 1 }),
  ).toThrow("quota");
});
it("reopening a native recent uses the same candidate validation and explicit acceptance", async () => {
  const accept = vi.fn(async () => {}),
    reject = vi.fn(async () => {}),
    open = vi.fn(async (recentId?: string) => ({
      candidateToken: recentId ?? "new",
      text: serializeProject(emptyProjectV2()),
    }));
  const adapter = createNativeFileAdapter({
    openCandidate: open,
    acceptCandidate: accept,
    rejectCandidate: reject,
    save: async () => false,
    resetDestination: async () => {},
  });
  const candidate = await adapter.open("registered-id");
  expect(open).toHaveBeenCalledWith("registered-id");
  expect(accept).not.toHaveBeenCalled();
  await adapter.accept(candidate!);
  expect(accept).toHaveBeenCalledWith("registered-id");
  expect(reject).not.toHaveBeenCalled();
});

it("uses the real filename when an older project's name is empty", () => {
  const { store } = storage(),
    r = createRecentProjectStore(store);
  r.record("", { name: "old.v3d", size: 10, lastModified: 1 });
  expect(r.list()[0].name).toBe("old.v3d");
});
