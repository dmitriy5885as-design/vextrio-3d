import { describe, expect, it, vi } from "vitest";
import {
  createBrowserFileAdapter,
  createNativeFileAdapter,
  type NativeTransport,
} from "@forma/file-io";
import { emptyProject, serializeProject } from "@forma/document";

function nativeFixture() {
  let destination = "original.v3d";
  let pending: { token: string; path: string } | null = null;
  let generation = 0;
  let contents = serializeProject(emptyProject("Opened"));
  let cancel = false;
  let saveError = false;
  const transport: NativeTransport = {
    async openCandidate() {
      if (cancel) return null;
      pending = { token: String(++generation), path: "candidate.v3d" };
      return { candidateToken: pending.token, text: contents };
    },
    acceptCandidate: vi.fn(async (token) => {
      if (!pending || pending.token !== token) throw Error("stale");
      destination = pending.path;
      pending = null;
    }),
    rejectCandidate: vi.fn(async (token) => {
      if (pending?.token === token) pending = null;
    }),
    save: vi.fn(async () => {
      if (saveError) throw Error("permission denied");
      if (cancel) return false;
      destination = "saved.v3d";
      return true;
    }),
    async resetDestination() {
      destination = "";
      pending = null;
    },
  };
  return {
    adapter: createNativeFileAdapter(transport),
    transport,
    get destination() {
      return destination;
    },
    set contents(text: string) {
      contents = text;
    },
    set cancel(value: boolean) {
      cancel = value;
    },
    set saveError(value: boolean) {
      saveError = value;
    },
  };
}
describe("native file acceptance protocol", () => {
  it("keeps the original path until explicit acceptance of a valid document", async () => {
    const f = nativeFixture(),
      candidate = (await f.adapter.open())!;
    expect(f.destination).toBe("original.v3d");
    expect(f.transport.acceptCandidate).not.toHaveBeenCalled();
    expect((await f.adapter.accept(candidate)).name).toBe("Opened");
    expect(f.destination).toBe("candidate.v3d");
    await expect(f.adapter.accept(candidate)).rejects.toThrow();
  });
  it("invalid JSON rejects the candidate and keeps the original destination", async () => {
    const f = nativeFixture();
    f.contents = "{broken";
    await expect(f.adapter.open()).rejects.toThrow(/JSON/);
    expect(f.destination).toBe("original.v3d");
    expect(f.transport.acceptCandidate).not.toHaveBeenCalled();
    expect(f.transport.rejectCandidate).toHaveBeenCalledOnce();
  });
  it("schema errors also keep the path", async () => {
    const f = nativeFixture();
    f.contents = '{"schemaVersion":2}';
    await expect(f.adapter.open()).rejects.toThrow();
    expect(f.destination).toBe("original.v3d");
  });
  it("cancelling the picker and rejecting a valid candidate do not alter the path", async () => {
    const f = nativeFixture();
    f.cancel = true;
    expect(await f.adapter.open()).toBeNull();
    expect(f.destination).toBe("original.v3d");
    f.cancel = false;
    const candidate = (await f.adapter.open())!;
    await f.adapter.reject(candidate);
    expect(f.destination).toBe("original.v3d");
    await expect(f.adapter.accept(candidate)).rejects.toThrow();
  });
  it("never accepts a mutated candidate", async () => {
    const f = nativeFixture(),
      candidate = (await f.adapter.open())!;
    candidate.project.name = "tampered";
    await expect(f.adapter.accept(candidate)).rejects.toThrow();
    expect(f.destination).toBe("original.v3d");
    expect(f.transport.acceptCandidate).not.toHaveBeenCalled();
  });
  it("old candidates cannot override a newer choice or reset", async () => {
    const f = nativeFixture(),
      first = (await f.adapter.open())!,
      second = (await f.adapter.open())!;
    await expect(f.adapter.accept(first)).rejects.toThrow("stale");
    await f.adapter.reject(first);
    expect(f.destination).toBe("original.v3d");
    await f.adapter.accept(second);
    expect(f.destination).toBe("candidate.v3d");
    const third = (await f.adapter.open())!;
    await f.adapter.resetDestination();
    await expect(f.adapter.accept(third)).rejects.toThrow("stale");
    expect(f.destination).toBe("");
  });
  it("cancelled and failed saves leave destination unchanged", async () => {
    const f = nativeFixture();
    f.cancel = true;
    expect(await f.adapter.save(emptyProject(), true)).toEqual({
      status: "cancelled",
    });
    expect(f.destination).toBe("original.v3d");
    f.cancel = false;
    f.saveError = true;
    await expect(f.adapter.save(emptyProject())).rejects.toThrow("permission");
    expect(f.destination).toBe("original.v3d");
    f.saveError = false;
    expect(await f.adapter.save(emptyProject())).toEqual({ status: "saved" });
  });
  it("rejects invalid documents before invoking native save", async () => {
    const f = nativeFixture(),
      project = emptyProject();
    project.camera.zoom = 0;
    await expect(f.adapter.save(project)).rejects.toThrow();
    expect(f.transport.save).not.toHaveBeenCalled();
    expect(f.destination).toBe("original.v3d");
  });
});
describe("browser file semantics", () => {
  it("reports download-started rather than disk-write confirmation", async () => {
    const start = vi.fn(),
      adapter = createBrowserFileAdapter(start),
      project = emptyProject("Сохранить");
    expect(await adapter.save(project)).toEqual({ status: "download-started" });
    expect(start).toHaveBeenCalledWith(
      serializeProject(project),
      "Сохранить.v3d",
    );
  });
  it("does not download invalid state and does not read oversized files", async () => {
    const start = vi.fn(),
      adapter = createBrowserFileAdapter(start),
      project = emptyProject();
    project.camera.zoom = 0;
    await expect(adapter.save(project)).rejects.toThrow();
    expect(start).not.toHaveBeenCalled();
    const text = vi.fn();
    await expect(
      adapter.open({ size: 20_000_001, text } as unknown as File),
    ).rejects.toThrow(/20/);
    expect(text).not.toHaveBeenCalled();
  });
});
