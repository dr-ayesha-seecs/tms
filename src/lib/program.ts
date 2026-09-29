import type { ProgramType } from "./types";

/** DB values stay FYP / MS_THESIS; UI labels are Undergraduate / Postgraduate. */
export function programLabel(program: string | null | undefined): "Undergraduate" | "Postgraduate" {
  return program === "FYP" ? "Undergraduate" : "Postgraduate";
}

export function programBadgeClass(program: string | null | undefined): string {
  return program === "FYP"
    ? "inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 text-xs font-semibold"
    : "inline-flex items-center rounded-full bg-indigo-100 text-indigo-900 px-2.5 py-0.5 text-xs font-semibold";
}

export function normalizeProgramType(value: unknown): ProgramType {
  return value === "FYP" ? "FYP" : "MS_THESIS";
}
