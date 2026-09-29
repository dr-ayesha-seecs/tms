import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { FILLED_SQL_FOR, placesLabel } from "@/lib/idea-capacity";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { CreateIdeaForm } from "@/components/CreateIdeaForm";
import { ProgramBadge } from "@/components/ProgramBadge";
import { DbBanner } from "@/components/DbBanner";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function IdeasPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const db = await getDb();
  const ideas = await db
    .prepare(
      `SELECT i.*, ${FILLED_SQL_FOR("i")} as places_filled, u.name as faculty_name,
        (SELECT COUNT(*) FROM interests x WHERE x.idea_id = i.id) as interest_count
       FROM ideas i JOIN users u ON u.id = i.faculty_id
       ORDER BY i.created_at DESC`
    )
    .all() as {
    id: string;
    title: string;
    abstract: string;
    domain: string;
    slots: number;
    places_filled: number;
    status: string;
    faculty_name: string;
    interest_count: number;
    program_type: string;
  }[];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <DbBanner />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-navy">Research Ideas</h1>
            <p className="text-sm text-slate-500">Faculty float ideas; students express interest.</p>
          </div>
        </div>

        {(user.role === "faculty" || user.role === "admin") && <CreateIdeaForm />}

        <div className="grid gap-4">
          {ideas.map((idea) => (
            <Link key={idea.id} href={`/ideas/${idea.id}`} className="card p-5 hover:border-teal-300 transition block">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-navy text-lg">{idea.title}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {idea.faculty_name} · {idea.domain}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ProgramBadge programType={idea.program_type} />
                  <StatusBadge status={idea.status} />
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-600 line-clamp-2">{idea.abstract}</p>
              <div className="mt-3 flex gap-4 text-xs text-slate-500">
                <span data-testid="idea-places">{placesLabel(idea.places_filled, idea.slots)}</span>
                <span>Interests: {idea.interest_count}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
