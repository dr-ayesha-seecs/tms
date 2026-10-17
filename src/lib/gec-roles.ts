import type { GecRole } from "./types";

/**
 * Program signal already used by the app: `FYP` is undergraduate.
 * `MS_THESIS` (MS / MPhil / PhD) is postgraduate. Missing values follow
 * `normalizeProgramType` and are treated as postgraduate.
 */
export function isPostgraduateProgram(program: string | null | undefined): boolean {
  return program !== "FYP";
}

export type GecInviteSlot = {
  key: string;
  role: GecRole;
  /** Empty-option text shown in the dropdown. */
  placeholder: string;
  /** Visible label. Undergraduate slots keep the placeholder as the only label. */
  label?: string;
  facultyOnly?: boolean;
};

/** Seats offered when accepting an interest and creating the project. */
export function gecInviteSlots(program: string | null | undefined): GecInviteSlot[] {
  if (isPostgraduateProgram(program)) {
    return [
      { key: "member-1", role: "member", label: "Member", placeholder: "Member…" },
      { key: "member-2", role: "member", label: "Member", placeholder: "Member…" },
      {
        key: "special-member",
        role: "special_member",
        label: "Special Member (optional)",
        placeholder: "Special Member (optional)…",
      },
    ];
  }
  return [
    { key: "co-supervisor", role: "co_supervisor", placeholder: "Co-supervisor…" },
    {
      key: "internal-examiner",
      role: "internal_examiner",
      placeholder: "Internal examiner…",
      facultyOnly: true,
    },
    { key: "external-examiner", role: "external_examiner", placeholder: "External examiner…" },
  ];
}

/** Roles a supervisor may assign after the project exists (not the supervisor seat). */
export function assignableGecRoles(program: string | null | undefined): { value: GecRole; label: string }[] {
  if (isPostgraduateProgram(program)) {
    return [
      { value: "member", label: "Member" },
      { value: "special_member", label: "Special Member (optional)" },
    ];
  }
  return [
    { value: "co_supervisor", label: "Co-supervisor" },
    { value: "internal_examiner", label: "Internal examiner" },
    { value: "external_examiner", label: "External examiner" },
  ];
}

const UNDERGRAD_INVITE_ROLES = new Set<string>(["co_supervisor", "internal_examiner", "external_examiner"]);
const POSTGRAD_INVITE_ROLES = new Set<string>(["member", "special_member"]);

export function roleLabelForGec(role: string): string {
  switch (role) {
    case "supervisor":
      return "Supervisor";
    case "co_supervisor":
      return "Co-Supervisor";
    case "internal_examiner":
      return "Internal Examiner";
    case "external_examiner":
      return "External Examiner";
    case "member":
      return "Member";
    case "special_member":
      return "Special Member";
    default:
      return String(role || "").replace(/_/g, " ");
  }
}

/** Accept-interest payload: invites may be omitted entirely (can be added later). */
export function validateGecInvites(
  program: string | null | undefined,
  invites: { user_id?: string; gec_role?: string }[] | undefined
): string | null {
  const list = (invites || []).filter((inv) => inv && String(inv.user_id || "").trim());
  const postgraduate = isPostgraduateProgram(program);
  const allowed = postgraduate ? POSTGRAD_INVITE_ROLES : UNDERGRAD_INVITE_ROLES;
  const seenUsers = new Set<string>();
  let members = 0;
  let special = 0;
  for (const inv of list) {
    const userId = String(inv.user_id).trim();
    const role = String(inv.gec_role || "").trim();
    if (!allowed.has(role)) {
      return postgraduate
        ? "Postgraduate committee invites must use Member or Special Member"
        : "Undergraduate GEC invites must be co-supervisor, internal examiner, or external examiner";
    }
    if (seenUsers.has(userId)) return "Each person can only be invited to one committee seat";
    seenUsers.add(userId);
    if (role === "member") members += 1;
    if (role === "special_member") special += 1;
  }
  if (postgraduate) {
    if (members > 2) return "A postgraduate committee has two Member seats";
    if (special > 1) return "A postgraduate committee has one optional Special Member seat";
  }
  return null;
}

/** Later invite / role edit on an existing project. */
export function gecRoleAssignmentError(
  program: string | null | undefined,
  role: string,
  existing: { id?: string; user_id: string; gec_role: string }[],
  opts?: { userId?: string; replacingMemberId?: string }
): string | null {
  const postgraduate = isPostgraduateProgram(program);
  const allowed = postgraduate ? POSTGRAD_INVITE_ROLES : UNDERGRAD_INVITE_ROLES;
  const normalized = String(role || "").trim();
  if (!allowed.has(normalized)) {
    return postgraduate
      ? "Postgraduate committee roles are Member or Special Member"
      : "Undergraduate GEC roles are co-supervisor, internal examiner, or external examiner";
  }
  const others = existing.filter((m) => m.gec_role !== "supervisor" && m.id !== opts?.replacingMemberId);
  if (opts?.userId && others.some((m) => m.user_id === opts.userId)) {
    return "This person is already on the committee";
  }
  if (!postgraduate) return null;
  if (normalized === "member" && others.filter((m) => m.gec_role === "member").length >= 2) {
    return "A postgraduate committee already has two Members";
  }
  if (normalized === "special_member" && others.some((m) => m.gec_role === "special_member")) {
    return "A postgraduate committee already has a Special Member";
  }
  return null;
}

/**
 * A complete committee. Postgraduate needs supervisor + two Members
 * (Special Member stays optional). Committees saved before this shape
 * (internal + external examiner) can still be finalized.
 */
export function gecFinalizeError(
  program: string | null | undefined,
  members: { gec_role: string }[]
): string | null {
  const roles = members.map((m) => m.gec_role);
  if (isPostgraduateProgram(program)) {
    const memberCount = roles.filter((r) => r === "member").length;
    const legacyExaminers = roles.includes("internal_examiner") && roles.includes("external_examiner");
    if (!roles.includes("supervisor") || (memberCount < 2 && !legacyExaminers)) {
      return "Postgraduate supervisory committee needs a supervisor and two members. Special Member is optional.";
    }
    return null;
  }
  if (!roles.includes("supervisor") || !roles.includes("internal_examiner") || !roles.includes("external_examiner")) {
    return "GEC needs supervisor, internal examiner, and external examiner";
  }
  return null;
}
