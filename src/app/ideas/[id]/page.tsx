import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser, listUsers } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { FILLED_SQL_FOR, placesLabel } from "@/lib/idea-capacity";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusPipeline } from "@/components/StatusPipeline";
import { IdeaActions } from "@/components/IdeaActions";
import { EditIdeaPanel } from "@/components/EditIdeaPanel";
import { formatDate } from "@/lib/format";
import { ProgramBadge } from "@/components/ProgramBadge";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function IdeaDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const db = await getDb();
  const idea = await db
    .prepare(
      `SELECT i.*, ${FILLED_SQL_FOR("i")} as places_filled, u.name as faculty_name FROM ideas i
       JOIN users u ON u.id = i.faculty_id WHERE i.id = ?`
    )
    .get(params.id) as
    | {
        id: string;
        title: string;
        abstract: string;
        domain: string;
        slots: number;
        places_filled: number;
        status: string;
        faculty_id: string;
        faculty_name: string;
        program_type: string;
        created_at: string;
      }
    | undefined;

  if (!idea) {
    return (
      <AppShell user={user}>
        <div className="card p-8 max-w-lg mx-auto text-center space-y-4">
          <h1 className="text-xl font-bold text-navy">Idea not found</h1>
          <p className="text-sm text-slate-600">
            This idea may have been removed, or the link is outdated. Browse the ideas board to
            find current topics, or post a new one if you are faculty.
          </p>
          <Link href="/ideas" className="btn-primary inline-block text-sm">
            Back to ideas
          </Link>
        </div>
      </AppShell>
    );
  }

  const interests = await db
    .prepare(
      `SELECT x.*, s.name as student_name, s.email as student_email, s.registration_no as student_registration_no FROM interests x
       JOIN users s ON s.id = x.student_id WHERE x.idea_id = ? ORDER BY x.created_at`
    )
    .all(params.id) as {
    id: string;
    student_id: string;
    student_name: string;
    student_email: string;
    student_registration_no: string | null;
    statement: string | null;
    status: string;
    created_at: string;
  }[];

  const myInterest = interests.find((i) => i.student_id === user.id);
  const facultyPool = (await listUsers()).filter(
    (u) => u.role === "faculty" || u.role === "external_examiner"
  );

  const ideaIndex =
    idea.status === "converted" ? 3 : idea.status === "gec_forming" ? 2 : interests.length ? 1 : 0;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <Link href="/ideas" className="text-sm text-teal-700 hover:underline">
          ← Ideas
        </Link>
        <div className="card p-6 space-y-4">
          <div className="flex flex-wrap justify-between gap-2">
            <h1 className="text-2xl font-bold text-navy">{idea.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <ProgramBadge programType={idea.program_type} />
              <StatusBadge status={idea.status} />
            </div>
          </div>
          <StatusPipeline ideaOnly ideaIndex={ideaIndex} />
          <p className="text-sm text-slate-600">{idea.abstract}</p>
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span>Faculty: {idea.faculty_name}</span>
            <span>Domain: {idea.domain}</span>
            <span className="inline-flex items-center gap-1">Level: <ProgramBadge programType={idea.program_type} /></span>
            <span data-testid="idea-places" title="Group size: up to the number of places; filled = students currently on a project from this idea">
              {placesLabel(idea.places_filled, idea.slots)}
            </span>
            <span>Posted: {formatDate(idea.created_at)}</span>
          </div>
        </div>

        <EditIdeaPanel
          idea={{
            id: idea.id,
            title: idea.title,
            abstract: idea.abstract,
            domain: idea.domain,
            slots: idea.slots,
            status: idea.status,
            program_type: idea.program_type,
          }}
          canEdit={user.id === idea.faculty_id || user.role === "admin"}
          isAdmin={user.role === "admin"}
        />

        <IdeaActions
          ideaId={idea.id}
          ideaStatus={idea.status}
          isOwner={user.id === idea.faculty_id || user.role === "admin"}
          isStudent={user.role === "student"}
          isAdmin={user.role === "admin"}
          myInterestId={myInterest?.id}
          myInterestStatus={myInterest?.status}
          interests={interests}
          placesLeft={Math.max(0, Number(idea.slots || 1) - Number(idea.places_filled || 0))}
          facultyPool={facultyPool.map((u) => ({
            id: u.id,
            name: u.name,
            role: u.role,
            title: u.title,
          }))}
        />
      </div>
    </AppShell>
  );
}
