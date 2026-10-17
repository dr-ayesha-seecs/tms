# Rebuild the database from a JSON export

The live app stores one SQLite file. When that file cannot be downloaded from Firestore, an admin can save the JSON and CSV the website already returns, and this script loads them into a new SQLite file using the same tables as `src/lib/db.ts`.

The export contains student personal data. The GitHub repository is public. Do not commit the export, the generated `.sqlite` file, or a copy of either. `tms-export*` and `*.sqlite` are gitignored.

## Command

From the repository root, with Firebase and Turso variables unset (the script refuses to run if they are set, so it cannot write to the live store):

```bash
npx tsx scripts/import-from-export.ts uploads/tms-export.tar.gz --out data/tms.sqlite
```

A folder works the same way:

```bash
npx tsx scripts/import-from-export.ts /path/to/export-folder --out data/tms.sqlite
```

The script replaces the local development database at `data/tms.sqlite` (that is the file `npm run dev` opens) and copies it to `--out` when that path is different. Restart the dev server after an import. The first boot runs the normal schema migration. It does not re-seed users when the file already has rows.

Re-run the same command on a fresh export immediately before switching hosts, so nothing saved after this snapshot is left behind.

Exit code 0 means every manifest count that names a table matches the file. Exit code 2 means the file was still written, but at least one of those counts disagrees (the JSON summary on stdout has both sides). Rows that could not be inserted are counted under `warnings` and are not printed.

## What the export is expected to contain

- `users.json`, `departments.json` (or `departments`)
- form-template JSON for each program
- `ideas.json` and `ideas/{id}.json`
- `projects.json` and `projects/{id}.json`
- `activity.csv`
- `MANIFEST.md` with counts

Ids and timestamps from those files are kept. GEC role values are stored as they appear in the export.

## Passwords

The export has no password hashes. Every user is given a hash from the app's own `hashPassword` / `defaultPasswordFor` and `must_change_password = 1`:

- Students: their registration number
- Faculty, admin, and external examiners: the staff default `Mnsuam@123`

The admin account uses that same default and is also marked must-change. Login still succeeds; the site then sends the user to the password page.

## What stays empty or approximate

`login_failures`, `notification_reads`, and `user_visits` are created and left empty.

Activity comes from `activity.csv`. Project ids are read from links that contain `/projects/{id}`. The CSV has no row id and no seconds, so those rows get new ids and a timestamp at the start of that minute (Pakistan time). Where a project JSON includes the original activity row for the same minute, action, and detail, the script keeps that original id and timestamp instead. Rows the CSV never contained cannot be invented.

There are no uploaded PDFs in this database. Documents are Google Docs/Drive links.
