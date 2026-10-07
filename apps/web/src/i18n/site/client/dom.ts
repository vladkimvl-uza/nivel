// The small part of the DOM the controllers of the page touch. A real element fits these shapes; a test brings a plain object.
// (The controllers never look at layout in a frame loop except through the numbers they were given.)

/** The window with its globals (`URL`, `Image`, `ResizeObserver` ...): the `Window` interface alone does not carry them. */
export type Win = Window & typeof globalThis;

export interface ClassListLike {
  add(...names: string[]): void;
  remove(...names: string[]): void;
  toggle(name: string, force?: boolean): boolean;
  contains(name: string): boolean;
}

export interface StyleLike {
  setProperty(name: string, value: string): void;
  opacity: string;
  transform: string;
}

export interface ElLike {
  classList: ClassListLike;
  style: StyleLike;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

/** Writes a value only when it changed: a write of the same value still costs a style recalculation. */
export function memo<T>(): (next: T, write: (value: T) => void) => void {
  let last: T | undefined;
  let has = false;
  return (next, write) => {
    if (has && last === next) return;
    has = true;
    last = next;
    write(next);
  };
}
