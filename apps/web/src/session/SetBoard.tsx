import { useRef, useState, type KeyboardEvent } from 'react';

export interface SetView {
  task: 'select' | 'identify';
  total: number;
  elements: { id: string }[];
  marked?: string[];
  options?: { n: number; d: number; label: string }[];
  item_singular: string;
  item_plural: string;
}

function columnsFor(total: number): number {
  if (total <= 12) return Math.min(total, 6);
  if (total <= 24) return 6;
  if (total <= 40) return 8;
  return 10;
}

/**
 * The set, rendered from the engine's data (the design spec §12: quantities come from data, never from pictures).
 * In "select" items each element is a toggle; arrow keys move between them, Space or Enter toggles.
 * In "identify" items the marked elements are shown and nothing is interactive.
 */
export function SetBoard({
  view,
  selected,
  onToggle,
  readOnly,
}: {
  view: SetView;
  selected: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  readOnly?: boolean;
}) {
  const columns = columnsFor(view.total);
  const [focusIndex, setFocusIndex] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const marked = new Set(view.marked ?? []);
  const interactive = view.task === 'select' && !readOnly && onToggle;

  const move = (index: number) => {
    const next = Math.max(0, Math.min(view.elements.length - 1, index));
    setFocusIndex(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + columns,
      ArrowUp: index - columns,
      Home: 0,
      End: view.elements.length - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      move(keys[event.key]!);
    }
  };

  return (
    <div
      className="set-board"
      role={interactive ? 'group' : 'img'}
      aria-label={
        interactive
          ? `${view.total} ${view.item_plural}. Use arrow keys to move and Space to mark.`
          : `${view.total} ${view.item_plural}, ${marked.size || selected.size} marked.`
      }
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {view.elements.map((element, index) => {
        const isOn = view.task === 'identify' ? marked.has(element.id) : selected.has(element.id);
        const className = `set-board__item${isOn ? ' is-on' : ''}${view.task === 'identify' ? ' is-marked-style' : ''}`;
        if (!interactive) return <span key={element.id} className={className} aria-hidden="true" />;
        return (
          <button
            key={element.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            className={className}
            aria-pressed={isOn}
            aria-label={`${view.item_singular} ${index + 1}`}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              setFocusIndex(index);
              onToggle(element.id);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        );
      })}
    </div>
  );
}
