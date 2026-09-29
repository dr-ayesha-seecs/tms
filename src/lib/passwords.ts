import bcrypt from "bcryptjs";
import type { Role } from "./types";

/** Non-student default initial password (forced change on first login). */
export const DEFAULT_STAFF_PASSWORD = "Mnsuam@123";

export function defaultPasswordFor(role: Role, registrationNo: string | null | undefined): string {
  if (role === "student") {
    const reg = (registrationNo || "").trim();
    if (!reg) throw new Error("Student registration number is required to set default password");
    return reg;
  }
  return DEFAULT_STAFF_PASSWORD;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function validateNewPassword(password: string): string | null {
  if (!password || password.length < 8) return "Password must be at least 8 characters";
  return null;
}
