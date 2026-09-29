# MNSUAM Thesis Management System (TMS)

Thesis workflow demo for **MNS University of Agriculture, Multan**: research ideas → student interest → GEC formation → project tracking → weekly meetings → proposal/in-house/final defences → document vault with e-signatures.

**Branding:** MNSUAM seal + navy / bright-blue academic theme.  
**Copyright:** © Dr. Ayesha Hakim 2026

**Path (workspace):** `/workspace/thesis-tms`

## Production

- **Vercel project:** `mnsuam-thesis-tms`
- **Production URL:** https://mnsuam-thesis-tms.vercel.app

### Database (durable on Vercel)

- **Local/dev:** libSQL file at `data/tms.sqlite`.
- **Production (preferred):** set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` for Turso/libSQL.
- **Production (fallback):** Vercel Blob-backed SQLite (`BLOB_READ_WRITE_TOKEN`) — the DB file is hydrated from / persisted to Blob so ideas survive across serverless instances.
- Seeded users use **fixed UUIDs** so sessions stay stable across redeploys.
- API routes use `export const runtime = 'nodejs'`.

Ideas are labeled **Undergraduate** (`program_type=FYP`) or **Postgraduate** (`program_type=MS_THESIS`).

## Run locally

```bash
cd /workspace/thesis-tms   # or Mac: ~/projects/thesis-tms
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build && npm start
```

Re-seed:

```bash
rm -f data/tms.sqlite data/tms.sqlite-wal data/tms.sqlite-shm && npm run dev
# or Admin → Database → Reseed (as admin)
```

## Seeded accounts (password login)

| Role | Name | Email |
|------|------|-------|
| Admin | TMS Admin | `admin@tms.local` |
| Faculty / Supervisor | Dr. Ahmed Khan | `ahmed.khan@tms.local` |
| Faculty | Dr. Sara Malik | `sara.malik@tms.local` |
| Faculty | Dr. Bilal Raza | `bilal.raza@tms.local` |
| External examiner | Prof. Nadia Hussain | `ext.examiner@tms.local` |
| Student | Ali Raza | `ali.student@tms.local` |
| Student | Fatima Noor | `fatima.student@tms.local` |
| Student | Hassan Mehmood | `hassan.student@tms.local` |

## Admin — Users

1. Login as `admin@tms.local`
2. Open **Admin** → **Users** (`/admin/users`)
3. Add faculty, students, external examiners (or admins)
4. **Bulk upload students** from Excel (`.xlsx`): download the template, fill columns, upload
5. New users get a default password (students: registration number; others: `Mnsuam@123`) and must change it on first login
6. Remove is blocked if the user is still linked to ideas, projects, GEC seats, or interests; you cannot delete yourself

**Excel template columns:** `registration_no*` (required), `name`, `email`, `department*` (must match an existing department; see Departments sheet), `title` (optional). All imported rows become role `student`. Duplicate emails or registration numbers are skipped. Unknown departments are rejected with a list of valid names.

API:
- `GET/POST/DELETE /api/admin/users` (admin session required)
- `GET /api/admin/users/import-template` → `tms-students-template.xlsx`
- `POST /api/admin/users/import` (multipart field `file`)

## Student stage tracker

Admin and faculty can open **Tracker** (`/tracker`) to see **each student as one table row** (Reg No, name, email, department, program, project, supervisor, stage, progress). Pipeline stage (no project → interest → GEC → proposal → research → in-house → final → complete), program, project link, progress, and supervisor. Faculty see supervisees / GEC students / pending interests on their ideas; admin sees everyone.

## Admin — form names by track

1. Login as `admin@tms.local`
2. **Admin** → **Form name settings**
3. Toggle **MS Thesis** / **FYP**, edit labels, Save or Reset

## Features

| Area | Status |
|------|--------|
| Role demo login | Complete |
| Ideas CRUD + student interest | Complete |
| Accept student → project + GEC invite | Complete |
| TH-1…TH-4 forms + validation gates | Complete |
| Weekly meetings / milestones / defences | Complete |
| Document vault + e-signatures | Complete |
| Admin form templates (FYP / MS) | Complete |
| Admin users add/remove | Complete |
| Bulk student Excel import | Complete |
| Student stage tracker | Complete |
| Real SSO / email | Out of scope (demo only) |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data model.

## Passwords

Real email + password login (HMAC-signed httpOnly session cookie; set `SESSION_SECRET` in production).

| Role | Initial password | Forced change |
|------|------------------|---------------|
| Student | Their **registration number** | Yes (`must_change_password`) |
| Faculty / Admin / External examiner | **`Mnsuam@123`** | Yes |

- **Change password:** sidebar → Password (current + new + confirm, min 8 chars).
- **Admin reset:** Admin → Users → Reset password (resets to the default rule; admin never sees the hash/plaintext beyond the known rule).
- **Forgot password:** no email flow — contact the TMS admin (message on the login page).
- Seeded admin: `admin@tms.local` / initial password `Mnsuam@123` (must change on first login).

## Departments

Admin → Departments (`/admin/departments`): add, rename, delete (delete blocked while users still reference the name). Add-user and edit-user forms use a dropdown. Excel import must match an existing department name (case-insensitive).


## Document vault (Google Docs links)

Students no longer upload files. **Project → Documents → Submit document link**: choose type (synopsis, proposal, thesis draft, final thesis, …), title, and an `https://docs.google.com/…` or `https://drive.google.com/…` link. The form lists every GEC member's name and email to share with (Editor access), and a required checkbox confirms sharing. The server rejects non-Google URLs, a missing checkbox, and any file payload. Older records still display. Nothing new is written to Blob storage beyond the `tms.sqlite` database.

## Notifications (in-app, no email)

Computed on every request from current data (no cron). Bell with unread count (sidebar/header), a panel at the top of the dashboard, and `/notifications`. Mark read / dismiss; state lives in `notification_reads`. Pending-action reminders include the PKT date in their key, so a dismissed reminder returns the next day while the action is still pending. Colours: red = overdue/today, amber = within 3 days, blue = info. All times are PKT.

- **Students (all group members):** interest pending; GEC not formed; synopsis/proposal link missing; milestones overdue or due ≤7 days; no meeting in 14 days; meetings within 3 days; defence countdown at 14/7/3/1/0 days (urgent ≤3); required document link missing before a defence; conditional pass (GEC changes).
- **Faculty / GEC / external examiners:** attend defences and meetings 7 days, 1 day, same day, and “Starting soon” (≤2 h); interests awaiting response; document links submitted; e-signatures pending; defence results not entered (supervisor).
- **Admin:** defences without results, defences in the next 7 days, projects with no activity in 30 days, pending interests.

Meetings can have an optional time (PKT) and a venue or link.
