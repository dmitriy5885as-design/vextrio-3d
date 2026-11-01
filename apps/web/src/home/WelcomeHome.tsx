import { useEffect, useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { APP_RELEASE_LABEL } from "@forma/shared";
import type { useRecovery } from "../useRecovery";
import type { useRecentProjects } from "./useRecentProjects";
import { HomeSidebar, type HomePage } from "./HomeSidebar";
import { HeroSection } from "./HeroSection";
import { QuickActions } from "./QuickActions";
import { RecentProjects } from "./RecentProjects";
import { TemplateGallery } from "./TemplateGallery";
import { LearningSection } from "./LearningSection";
import { EditorSettings } from "./EditorSettings";
import type { TemplateId } from "./templates";
export function WelcomeHome({
  onNew,
  onOpen,
  onResume,
  onAbout,
  onRestore,
  busy,
  hasDocument,
  projectName,
  dirty,
  recovery,
  recent,
  error,
}: {
  onNew: (template: TemplateId) => void;
  onOpen: (recentId?: string) => void;
  onResume: () => void;
  onAbout: () => void;
  onRestore: () => void;
  busy: boolean;
  hasDocument: boolean;
  projectName: string;
  dirty: boolean;
  recovery: ReturnType<typeof useRecovery>;
  recent: ReturnType<typeof useRecentProjects>;
  error: string;
}) {
  const [page, setPage] = useState<HomePage>("home"),
    [notice, setNotice] = useState(""),
    [lessonId, setLessonId] = useState<string | null>(null);
  useEffect(() => {
    void recent.refresh();
  }, [recent.refresh]);
  const projects = (
    <RecentProjects
      entries={recent.entries}
      error={recent.error}
      busy={busy}
      all={page === "projects"}
      onOpen={(entry) => {
        if (entry.source === "browser") {
          setNotice(
            `Выберите локальный файл «${entry.fileName}» заново. Браузер не сохраняет доступ к его пути.`,
          );
          onOpen();
        } else onOpen(entry.id);
      }}
      onRemove={(id) => void recent.remove(id)}
      onClear={() => void recent.clear()}
      onBrowse={() => onOpen()}
      onAll={() => setPage("projects")}
    />
  );
  return (
    <div className="vextrio-home" data-testid="vextrio-home">
      <HomeSidebar
        page={page}
        onNavigate={(page) => {
          setLessonId(null);
          setPage(page);
        }}
        onAbout={onAbout}
      />
      <main className="home-main" id="home-main">
        <header className="home-topline">
          <span className="home-version">
            <span className="mint-dot" /> VEXTRIO 3D ·{" "}
            <span data-testid="app-version">{APP_RELEASE_LABEL}</span>
          </span>
          <span className="home-free-label">
            Бесплатно · Без регистрации · Файлы остаются у вас
          </span>
          {hasDocument && (
            <button
              className="home-text-link home-resume"
              disabled={busy}
              onClick={onResume}
            >
              <ArrowLeft size={15} />В редактор
            </button>
          )}
        </header>
        {hasDocument && (
          <div className="home-current">
            <span>
              <strong>{projectName}</strong>
              <small>
                {dirty ? "Есть несохранённые изменения" : "Текущий проект"}
              </small>
            </span>
            <button disabled={busy} onClick={onResume}>
              Продолжить работу
              <ArrowRight size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="home-notice" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="home-notice" role="status">
            {notice}
          </div>
        )}
        {(recovery.snapshot || recovery.error) && (
          <section
            className="recovery-card home-recovery"
            data-testid="recovery-card"
          >
            <div>
              <strong>Локальная автокопия</strong>
              {recovery.snapshot && (
                <p>
                  {recovery.snapshot.project.name} ·{" "}
                  {new Date(recovery.snapshot.savedAt).toLocaleString("ru-RU")}
                </p>
              )}
              {recovery.error && <p role="alert">{recovery.error}</p>}
              <small>Автокопия не перезаписывает файл на диске.</small>
            </div>
            <div>
              {recovery.snapshot && (
                <button disabled={busy || recovery.busy} onClick={onRestore}>
                  Восстановить проект
                </button>
              )}
              <button
                disabled={busy || recovery.busy}
                onClick={() => void recovery.discard()}
              >
                Удалить автокопию
              </button>
            </div>
          </section>
        )}
        {page === "home" && (
          <>
            <div className="home-hero-layout">
              <HeroSection />
              <QuickActions
                onNew={() => onNew("empty")}
                onOpen={() => onOpen()}
                onTemplates={() => setPage("templates")}
                busy={busy}
              />
            </div>
            {projects}
            <LearningSection
              compact
              onChoose={(id) => {
                setLessonId(id);
                setPage("learning");
              }}
              onAll={() => setPage("learning")}
              onNew={onNew}
            />
          </>
        )}
        {page === "projects" && (
          <>
            <p className="home-lead">
              Файлы, которые вы действительно открывали или сохраняли на этом
              устройстве.
            </p>
            {projects}
            <div className="home-project-actions">
              <button
                className="home-primary"
                disabled={busy}
                onClick={() => onNew("empty")}
              >
                Новый проект
              </button>
              <button disabled={busy} onClick={() => onOpen()}>
                Открыть .v3d
              </button>
            </div>
          </>
        )}
        {page === "templates" && (
          <TemplateGallery onChoose={onNew} busy={busy} />
        )}
        {page === "learning" && (
          <LearningSection
            key={lessonId}
            initialLesson={lessonId}
            onAll={() => setPage("learning")}
            onNew={onNew}
          />
        )}
        {page === "settings" && (
          <section className="home-settings">
            <h1>Настройки</h1>
            <p className="home-lead">
              Ваше рабочее пространство — здесь и в редакторе.
            </p>
            <EditorSettings />
          </section>
        )}
      </main>
    </div>
  );
}
