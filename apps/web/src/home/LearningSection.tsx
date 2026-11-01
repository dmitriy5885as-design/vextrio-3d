import { useState } from "react";
import {
  PlayCircle,
  BookOpen,
  Layers,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import type { TemplateId } from "./templates";
const lessons = [
  {
    id: "first",
    title: "Первая объёмная модель",
    subtitle: "Прямоугольник, размеры и Push/Pull",
    icon: PlayCircle,
    steps: [
      "Создайте проект «Архитектура». Нажмите R и укажите первый угол в сцене.",
      "В поле размера введите 4m;3m и нажмите Enter. Получится грань 12 м².",
      "Нажмите Space и выберите грань. Нажмите P, введите 3m и подтвердите Enter.",
      "Колесо мыши меняет масштаб. Средняя кнопка вращает вид, Shift + средняя кнопка перемещает камеру.",
      "Сохраните проект через Ctrl+S. В браузере проверьте скачанный .v3d в папке загрузок.",
    ],
  },
  {
    id: "precision",
    title: "Точные построения",
    subtitle: "Привязки, числовой ввод и отмена",
    icon: BookOpen,
    steps: [
      "L начинает последовательность отрезков, R — прямоугольник, C — окружность, A — дугу.",
      "Наведите указатель на конец или середину ребра. Маркер и подпись показывают текущую привязку.",
      "Вводите размеры с единицами: 250mm, 25cm или 0.25m. Для прямоугольника разделяйте ширину и высоту точкой с запятой.",
      "Enter подтверждает числовой ввод, Esc отменяет незавершённое построение.",
      "Ctrl+Z отменяет завершённую команду, Ctrl+Y повторяет её. Preview не записывается в историю.",
    ],
  },
  {
    id: "projects",
    title: "Проекты и компоненты",
    subtitle: "Группы, файлы и восстановление",
    icon: Layers,
    steps: [
      "Сохраняйте проект в .v3d: формат содержит геометрию, материалы и структуру модели.",
      "Для независимых частей используйте группы. Двойной щелчок входит в контекст группы; перед правкой проверьте активный контекст.",
      "Экземпляры компонента используют одну геометрию. Для независимой правки сначала отделите экземпляр.",
      "Локальная автокопия помогает восстановить последний редактируемый проект, но не заменяет файл на диске.",
      "В меню «Файл» доступен экспорт OBJ и STL. STL предназначен для геометрии; общие булевы операции пока не поддерживаются.",
    ],
  },
] as const;
export function LearningSection({
  compact = false,
  onAll,
  onNew,
  initialLesson = null,
  onChoose,
}: {
  compact?: boolean;
  initialLesson?: string | null;
  onChoose?: (id: string) => void;
  onAll: () => void;
  onNew: (template: TemplateId) => void;
}) {
  const [lesson, setLesson] = useState<string | null>(initialLesson),
    active = lessons.find((l) => l.id === lesson);
  return (
    <section className="home-learning">
      <div className="home-section-heading">
        {compact ? <h2>Полезные материалы</h2> : <h1>Обучение</h1>}
        {compact && (
          <button className="home-text-link" onClick={onAll}>
            Перейти к обучению
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      {active && !compact ? (
        <article className="home-lesson">
          <button className="home-text-link" onClick={() => setLesson(null)}>
            <ArrowLeft size={16} />
            Все инструкции
          </button>
          <h2>{active.title}</h2>
          <ol>
            {active.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button
            className="home-primary"
            onClick={() => onNew("architecture")}
          >
            Начать в новом проекте
          </button>
        </article>
      ) : (
        <div className="home-learning-grid">
          {lessons.map((l) => (
            <button
              className="home-learning-card"
              key={l.id}
              onClick={() => {
                if (compact) {
                  if (onChoose) onChoose(l.id);
                  else onAll();
                } else setLesson(l.id);
              }}
            >
              <l.icon size={30} />
              <span>
                <strong>{l.title}</strong>
                <small>{l.subtitle}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
