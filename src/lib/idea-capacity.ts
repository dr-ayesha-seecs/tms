import type { TmsDb } from "./db";

/**
 * Places filled on an idea = distinct students currently on projects created from it
 * (project_students). Computed live so it can never drift when interests are withdrawn
 * or deleted, projects are deleted, group members change, or status is edited.
 * (An "accepted interest without a project" only arises after a project is deleted,
 * so it is deliberately NOT counted.)
 */
export const FILLED_SQL_FOR = (ideaAlias: string) =>
  `(SELECT COUNT(DISTINCT ps.student_id) FROM project_students ps
     JOIN projects p ON p.id = ps.project_id WHERE p.idea_id = ${ideaAlias}.id)`;

export async function countFilledPlaces(
  db: TmsDb,
  ideaId: string,
  excludeProjectId?: string
): Promise<number> {
  const row = (await db
    .prepare(
      `SELECT COUNT(DISTINCT ps.student_id) as c FROM project_students ps
       JOIN projects p ON p.id = ps.project_id
       WHERE p.idea_id = ? ${excludeProjectId ? "AND p.id <> ?" : ""}`
    )
    .get(...(excludeProjectId ? [ideaId, excludeProjectId] : [ideaId]))) as { c: number } | undefined;
  return Number(row?.c || 0);
}

/** Keep the legacy stored ideas.slots_filled column in sync (all ideas, or one). Returns rows changed. */
export async function recomputeSlotsFilled(db: TmsDb, ideaId?: string | null): Promise<number> {
  const where = ideaId ? "AND ideas.id = ?" : "";
  const res = (await db
    .prepare(
      `UPDATE ideas SET slots_filled = ${FILLED_SQL_FOR("ideas")}
       WHERE slots_filled IS NOT ${FILLED_SQL_FOR("ideas")} ${where}`
    )
    .run(...(ideaId ? [ideaId] : []))) as { changes?: number } | undefined;
  return Number(res?.changes || 0);
}

export function placesLabel(filled: number, slots: number): string {
  const s = Math.max(1, Number(slots) || 1);
  return `Students: ${Number(filled) || 0} of ${s} place${s === 1 ? "" : "s"} filled`;
}
