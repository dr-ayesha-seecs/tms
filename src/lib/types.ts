export type Role =
  | "admin"
  | "faculty"
  | "student"
  | "external_examiner";

export type IdeaStatus = "open" | "interest_pending" | "gec_forming" | "converted" | "closed";

export type ProjectStage =
  | "gec_formation"
  | "proposal"
  | "research"
  | "in_house"
  | "final"
  | "complete";

export type ProjectStatus =
  | "draft"
  | "acb_pending"
  | "active"
  | "proposal_scheduled"
  | "proposal_passed"
  | "research"
  | "in_house_scheduled"
  | "in_house_passed"
  | "final_scheduled"
  | "final_passed"
  | "completed"
  | "on_hold";

export type GecRole =
  | "supervisor"
  | "co_supervisor"
  | "internal_examiner"
  | "external_examiner";

export type ProgramType = "FYP" | "MS_THESIS";

/** Stable form code (not display label) — labels come from form_templates */
export type FormType = string;

export type DocType =
  | "synopsis"
  | "proposal"
  | "slides"
  | "thesis_draft"
  | "final_thesis"
  | "form"
  | "meeting_notes"
  | "other";

export type DefenceType = "proposal" | "in_house" | "final";
export type DefenceResult = "pending" | "pass" | "conditional_pass" | "fail";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string | null;
  title: string | null;
  registration_no: string | null;
  password_hash?: string | null;
  must_change_password?: number;
  created_at: string;
}

export interface Department {
  id: string;
  name: string;
  created_at: string;
}

export interface Idea {
  id: string;
  title: string;
  abstract: string;
  domain: string;
  slots: number;
  slots_filled: number;
  status: IdeaStatus;
  faculty_id: string;
  program_type: ProgramType;
  created_at: string;
  updated_at: string;
  faculty_name?: string;
  interest_count?: number;
}

export interface Interest {
  id: string;
  idea_id: string;
  student_id: string;
  statement: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: string;
  student_name?: string;
  idea_title?: string;
}

export interface ProjectStudent {
  project_id: string;
  student_id: string;
  name?: string;
  email?: string;
  registration_no?: string | null;
  added_at?: string;
}

export interface Project {
  id: string;
  idea_id: string | null;
  title: string;
  abstract: string;
  domain: string;
  student_id: string;
  supervisor_id: string;
  stage: ProjectStage;
  status: ProjectStatus;
  progress_pct: number;
  acb_approved: number;
  program_type: ProgramType;
  created_at: string;
  updated_at: string;
  student_name?: string;
  student_registration_no?: string | null;
  supervisor_name?: string;
  students?: ProjectStudent[];
}

export interface GecMember {
  id: string;
  project_id: string;
  user_id: string;
  gec_role: GecRole;
  invited_at: string;
  accepted_at: string | null;
  user_name?: string;
  user_email?: string;
  user_title?: string;
}

export interface Meeting {
  id: string;
  project_id: string;
  meeting_date: string;
  agenda: string;
  attendance: string; // JSON array of user ids / names
  notes: string;
  next_actions: string;
  created_by: string;
  created_at: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "pending" | "in_progress" | "done" | "blocked";
  progress_pct: number;
  updated_at: string;
}

export interface Defence {
  id: string;
  project_id: string;
  defence_type: DefenceType;
  scheduled_at: string | null;
  venue: string | null;
  result: DefenceResult;
  comments: string | null;
  synopsis_doc_id: string | null;
  slides_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  title: string;
  doc_type: DocType;
  version: number;
  file_name: string | null;
  content_text: string | null;
  external_url: string | null;
  shared_with_gec: number;
  uploaded_by: string;
  requires_signatures: number;
  created_at: string;
  uploader_name?: string;
}

export interface Signature {
  id: string;
  target_type: "document" | "form";
  target_id: string;
  project_id: string;
  user_id: string;
  role_label: string;
  method: "typed" | "canvas";
  signature_data: string; // typed name or canvas dataURL / JSON
  signed_at: string;
  user_name?: string;
}

export interface FormRecord {
  id: string;
  project_id: string;
  form_type: FormType;
  status: "draft" | "pending_signatures" | "signed" | "approved";
  payload: string; // JSON
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  project_id: string | null;
  actor_id: string | null;
  action: string;
  detail: string | null;
  created_at: string;
  actor_name?: string;
}

export const STAGE_PIPELINE = [
  { key: "idea", label: "Idea" },
  { key: "interest", label: "Interest" },
  { key: "gec", label: "GEC" },
  { key: "project", label: "Project" },
  { key: "proposal", label: "Proposal" },
  { key: "research", label: "Research" },
  { key: "in_house", label: "In-house" },
  { key: "final", label: "Final" },
  { key: "complete", label: "Complete" },
] as const;

export function stageToPipelineIndex(stage: ProjectStage, status: ProjectStatus): number {
  if (status === "completed" || stage === "complete") return 8;
  if (stage === "final" || status === "final_scheduled" || status === "final_passed") return 7;
  if (stage === "in_house" || status === "in_house_scheduled" || status === "in_house_passed") return 6;
  if (stage === "research" || status === "research") return 5;
  if (
    stage === "proposal" ||
    status === "proposal_scheduled" ||
    status === "proposal_passed"
  )
    return 4;
  if (status === "active" || status === "acb_pending") return 3;
  if (stage === "gec_formation") return 2;
  return 3;
}
