import { programBadgeClass, programLabel } from "@/lib/program";

export function ProgramBadge({ programType }: { programType: string | null | undefined }) {
  return <span className={programBadgeClass(programType)}>{programLabel(programType)}</span>;
}
