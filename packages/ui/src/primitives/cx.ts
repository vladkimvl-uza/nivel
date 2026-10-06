/** Joins class names, skipping the empty ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** A required text is not empty or blank: an empty label would silently remove what the component exists for. */
export function assertText(value: unknown, name: string, component: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${component}: ${name} is required and must not be empty`);
  }
}
