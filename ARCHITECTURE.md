# Thesis TMS — Architecture

## Stack
- **Next.js 14** App Router + TypeScript + Tailwind CSS
- **SQLite**. Production on Netlify uses **Turso** (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`): real SQL tables through `@libsql/client`. Local dev uses `data/tms.sqlite`. Firebase Firestore (`src/lib/firestore-store.ts`) is used only when Firebase credentials are set, and those credentials take priority over Turso. On a serverless host with neither configured, the file is written under `/tmp` and is not durable.
- Cookie session (`tms_session` = user id) for demo role login — no external auth

## Data model

```
users
  id, email, name, role (admin|faculty|student|external_examiner), department, title

ideas
  id, title, abstract, domain, slots, slots_filled, status
  (open|interest_pending|gec_forming|converted|closed), faculty_id

interests
  id, idea_id, student_id, statement, status (pending|accepted|rejected|withdrawn)

projects
  id, idea_id, title, abstract, domain, student_id, supervisor_id,
  stage (gec_formation|proposal|research|in_house|final|complete),
  status (... pipeline statuses ...), progress_pct, acb_approved

gec_members
  id, project_id, user_id, gec_role
  (undergraduate: supervisor|co_supervisor|internal_examiner|external_examiner;
   postgraduate: supervisor|member|special_member),
  invited_at, accepted_at

meetings — weekly logs (agenda, attendance JSON, notes, next_actions)
milestones — progress items with % and status
defences — proposal | in_house | final + schedule/result
documents — vault with version, type tags, requires_signatures
forms — TH-1, TH-1A, TH-2, TH-2A, TH-3-INTERNAL, TH-3, TH-4 + JSON payload
signatures — target_type (document|form), method (typed|canvas), signature_data JSON/text, role_label, signed_at
activity — audit trail
```

## Workflow gates
1. Faculty floats idea → student interest
2. Supervisor accepts → project draft + GEC invites
3. TH-1 created; all GEC e-sign → optional **Simulate ACB** → idea `converted`, project `active`
4. Later forms (TH-2…) require signed TH-1
5. TH-2 schedules proposal defence; TH-2A / defence result advances to research
6. TH-3-INTERNAL / TH-3 for in-house & final; TH-4 completion clears graduation

## API surface (`/api/*`)
- `auth/login|logout|me`, `users`, `seed` (reset DB)
- `ideas`, `ideas/[id]`, `interests`, `interests/[id]`
- `projects`, `projects/[id]` (+ `gec`, `meetings`, `milestones`, `defences`, `documents`, `forms`, `advance`)
- `signatures`

## UI
Role sidebar shell; project hub tabs: Overview | Progress | Meetings | Defences | Documents | GEC & Signatures.
E-sign modal: typed name or canvas stroke → persisted signature row with badges.

## Persistence notes
DB auto-migrates and auto-seeds when `users` is empty. Re-seed: `POST /api/seed` as admin (in Firestore mode this publishes a freshly seeded DB as the next version), or delete `data/tms.sqlite*` locally.
Firestore layout and concurrency: see README → Database.


## Program tracks & form templates
- `ideas.program_type` / `projects.program_type`: `FYP` | `MS_THESIS`
- `form_templates`: per-track configurable stages (`code`, `display_name`, `description`, `sort_order`, `enabled`, `requires_esign`, `category`)
- Runtime forms store stable `form_type` = template `code` (e.g. `gec_formation`); UI shows `display_name`
- Admin: `/admin`, `/admin/forms` — edit / reorder / reset defaults per track
- Defaults: MS Thesis uses NUST-style TH-* labels; FYP uses FYP-1…FYP-5 labels (all editable)
