export type ProgramType = "FYP" | "MS_THESIS";

export type FormCategory =
  | "gec"
  | "meeting"
  | "proposal"
  | "progress"
  | "inhouse"
  | "final"
  | "completion"
  | "document";

export interface FormTemplate {
  id: string;
  program_type: ProgramType;
  code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  enabled: number; // 0|1
  requires_esign: number;
  category: FormCategory;
}

/** Stable workflow codes used in forms.form_type and validation gates */
export const FORM_CODES = {
  GEC_FORMATION: "gec_formation",
  GEC_CHANGE: "gec_change",
  PROPOSAL_SCHEDULE: "proposal_schedule",
  PROPOSAL_RESULT: "proposal_result",
  MID_EVALUATION: "mid_evaluation",
  INHOUSE_DEFENCE: "inhouse_defence",
  FINAL_DEFENCE: "final_defence",
  COMPLETION: "completion",
} as const;

export type DefaultTemplateInput = Omit<FormTemplate, "id" | "program_type">;

export const MS_THESIS_DEFAULTS: DefaultTemplateInput[] = [
  {
    code: FORM_CODES.GEC_FORMATION,
    display_name: "TH-1 GEC Formation",
    description: "Form Guidance & Examination Committee; e-sign by all members",
    sort_order: 10,
    enabled: 1,
    requires_esign: 1,
    category: "gec",
  },
  {
    code: FORM_CODES.GEC_CHANGE,
    display_name: "TH-1A GEC Change",
    description: "Optional change to GEC membership",
    sort_order: 20,
    enabled: 1,
    requires_esign: 1,
    category: "gec",
  },
  {
    code: FORM_CODES.PROPOSAL_SCHEDULE,
    display_name: "TH-2 Proposal Defence Schedule",
    description: "Schedule proposal defence; attach synopsis & slides",
    sort_order: 30,
    enabled: 1,
    requires_esign: 1,
    category: "proposal",
  },
  {
    code: FORM_CODES.PROPOSAL_RESULT,
    display_name: "TH-2A Proposal Defence Result",
    description: "Record proposal defence outcome with GEC e-signs",
    sort_order: 40,
    enabled: 1,
    requires_esign: 1,
    category: "proposal",
  },
  {
    code: FORM_CODES.INHOUSE_DEFENCE,
    display_name: "TH-3 Internal In-house Defence",
    description: "In-house / internal defence before final",
    sort_order: 50,
    enabled: 1,
    requires_esign: 1,
    category: "inhouse",
  },
  {
    code: FORM_CODES.FINAL_DEFENCE,
    display_name: "TH-3 Final Defence",
    description: "Final defence schedule and result",
    sort_order: 60,
    enabled: 1,
    requires_esign: 1,
    category: "final",
  },
  {
    code: FORM_CODES.COMPLETION,
    display_name: "TH-4 Completion / Clearance",
    description: "Graduation clearance with GEC e-signs",
    sort_order: 70,
    enabled: 1,
    requires_esign: 1,
    category: "completion",
  },
];

export const FYP_DEFAULTS: DefaultTemplateInput[] = [
  {
    code: FORM_CODES.GEC_FORMATION,
    display_name: "FYP-1 Supervisor & Panel",
    description: "Assign supervisor and evaluation panel",
    sort_order: 10,
    enabled: 1,
    requires_esign: 1,
    category: "gec",
  },
  {
    code: FORM_CODES.PROPOSAL_SCHEDULE,
    display_name: "FYP-2 Proposal",
    description: "Project proposal submission and defence schedule",
    sort_order: 20,
    enabled: 1,
    requires_esign: 1,
    category: "proposal",
  },
  {
    code: FORM_CODES.MID_EVALUATION,
    display_name: "FYP-3 Mid Evaluation",
    description: "Mid-term progress evaluation",
    sort_order: 30,
    enabled: 1,
    requires_esign: 1,
    category: "progress",
  },
  {
    code: FORM_CODES.FINAL_DEFENCE,
    display_name: "FYP-4 Final Defence",
    description: "Final year project defence",
    sort_order: 40,
    enabled: 1,
    requires_esign: 1,
    category: "final",
  },
  {
    code: FORM_CODES.COMPLETION,
    display_name: "FYP-5 Project Completion",
    description: "Final clearance and grade submission",
    sort_order: 50,
    enabled: 1,
    requires_esign: 1,
    category: "completion",
  },
];

export function defaultsFor(program: ProgramType): DefaultTemplateInput[] {
  return program === "FYP" ? FYP_DEFAULTS : MS_THESIS_DEFAULTS;
}
