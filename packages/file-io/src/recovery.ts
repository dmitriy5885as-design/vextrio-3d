import { serializeProject, parseProject, type Document } from "@forma/document";
export interface RecoverySnapshot {
  savedAt: number;
  project: Document;
}
export interface RecoveryStore {
  load(): Promise<RecoverySnapshot | null>;
  save(project: Document): Promise<RecoverySnapshot>;
  remove(): Promise<void>;
}
export function createRecoveryStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): RecoveryStore {
  async function db() {
    if (!factory)
      throw Error(
        "Автокопия недоступна: IndexedDB отключён. Сохраняйте файл .v3d вручную.",
      );
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open("vextrio-recovery", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("snapshots");
      r.onerror = () =>
        reject(Error("Не удалось открыть хранилище автокопии."));
      r.onblocked = () =>
        reject(Error("Хранилище автокопии занято другой вкладкой."));
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
    });
  }
  async function transact(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest,
  ) {
    const database = await db();
    return await new Promise<unknown>((resolve, reject) => {
      const tx = database.transaction("snapshots", mode);
      let value: unknown;
      const request = fn(tx.objectStore("snapshots"));
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => {
        database.close();
        resolve(value);
      };
      tx.onabort = tx.onerror = () => {
        database.close();
        reject(
          Error(
            "Не удалось записать автокопию. Проверьте свободное место и сохраните .v3d вручную.",
          ),
        );
      };
    });
  }
  return {
    async load() {
      const r = (await transact("readonly", (s) => s.get("latest"))) as
        { version?: unknown; savedAt?: unknown; text?: unknown } | undefined;
      if (!r) return null;
      if (
        r.version !== 1 ||
        typeof r.savedAt !== "number" ||
        !Number.isFinite(r.savedAt) ||
        typeof r.text !== "string"
      )
        throw Error("Автокопия повреждена. Исходные .v3d-файлы не изменены.");
      try {
        return { savedAt: r.savedAt, project: parseProject(r.text) };
      } catch {
        throw Error(
          "Автокопия повреждена. Можно удалить её и открыть .v3d вручную.",
        );
      }
    },
    async save(project) {
      const text = serializeProject(project),
        savedAt = Date.now();
      await transact("readwrite", (s) =>
        s.put({ version: 1, savedAt, text }, "latest"),
      );
      return { savedAt, project: parseProject(text) };
    },
    async remove() {
      await transact("readwrite", (s) => s.delete("latest"));
    },
  };
}
// Serialize writes, suppress obsolete callbacks and put discard after in-flight
// writes. A delayed result can never replace the editor document or its history.
export class RecoveryWriter {
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private store: RecoveryStore,
    private saved: (snapshot: RecoverySnapshot) => void,
    private error: (e: unknown) => void,
    private delay = 1200,
  ) {}
  cancel() {
    this.epoch++;
    clearTimeout(this.timer);
  }
  schedule(project: Document) {
    this.cancel();
    const epoch = this.epoch;
    const captured = parseProject(serializeProject(project));
    this.timer = setTimeout(() => {
      this.chain = this.chain
        .catch(() => {})
        .then(async () => {
          if (epoch !== this.epoch) return;
          try {
            const snapshot = await this.store.save(captured);
            if (epoch === this.epoch) this.saved(snapshot);
          } catch (e) {
            if (epoch === this.epoch) this.error(e);
          }
        });
    }, this.delay);
  }
  async discard() {
    this.cancel();
    this.chain = this.chain.catch(() => {}).then(() => this.store.remove());
    await this.chain;
  }
}
