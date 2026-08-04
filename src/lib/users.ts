/**
 * Mock account directory, stands in for Sperto/CRM-backed auth until the
 * client provides API docs and credentials (see the "Client Requirement
 * Discovery Questionnaire", §2 and §7). Swap `findUser` for a real API call
 * when that lands; nothing else in the login flow should need to change.
 *
 * Three roles:
 * - admin: sees everything (every manager's and every staff member's activity).
 * - sales_manager: oversight only, reads *their own team's* sales staff
 *   session reports (via `managerEmail` below) and doesn't run client
 *   presentations themselves.
 * - sales_staff: runs the actual client presentations (lead lookup to Earth
 *   to VR/cards showcase), with no reporting access. Each is assigned to
 *   exactly one manager via `managerEmail`, and that's the "team" a manager's
 *   dashboard is scoped to.
 */
export type Role = "admin" | "sales_manager" | "sales_staff";

import { verifyPassword } from "./password";

export type User = {
  email: string;
  /** `salt:hash` (scrypt) — never a plaintext password, see src/lib/password.ts. */
  passwordHash: string;
  name: string;
  role: Role;
  /** Only meaningful for sales_staff: which manager's team they're on. */
  managerEmail?: string;
  /** ISO date they joined, if known — drives the "New Joiner" tag (first 30
   * days) so a manager doesn't unfairly benchmark a brand-new hire against
   * staff who've been running presentations for months. Left unset for
   * existing staff below since their actual join dates aren't on file here;
   * set it when adding a real new hire. */
  joiningDate?: string;
};

/** True for the first 30 days after `joiningDate` — unset means "not known
 * to be new," not "definitely not new," since existing mock staff don't have
 * a real join date on file. */
export function isNewJoiner(user: Pick<User, "joiningDate">, now: number): boolean {
  if (!user.joiningDate) return false;
  const joinedAt = new Date(user.joiningDate).getTime();
  if (Number.isNaN(joinedAt)) return false;
  return now - joinedAt < 30 * 24 * 60 * 60 * 1000;
}

export const USERS: User[] = [
  {
    email: "admin@futeservices.com",
    // admin123
    passwordHash:
      "0c14dfb30c222d222a0e78f2daa8af18:0979c78b3b6a713bdf09022b14f1b82c4fbc3770261c1b8611f84f4365e68e427e88ccd55351e6cc42ba4e11b4712843b6d03b348f43cea9194efc4abad132d2",
    name: "Admin",
    role: "admin",
  },
  {
    email: "manager@futeservices.com",
    // manager123
    passwordHash:
      "ab9eedd6498fa9df1da2df9630f29740:3b8fb6b30d5d5d1c5d2fd1e4b1930efae54ac018bc925dab2f6bda338ed60444e98323256f13d262e5a420a7633251a3dd16e9152ca33cb23faeb73cc203b58f",
    name: "Priya Kulkarni",
    role: "sales_manager",
  },
  {
    email: "staff@futeservices.com",
    // staff123
    passwordHash:
      "4644e62880d7921d78bf033a87f2da01:c4305fd8233a9961753343754031a441d878e4bc8986020c10a97ce884bf3f25e705eff26805f676a3b1cc910e69f2f6397f1d18ace7b260c048294100bd7da3",
    name: "Sales Staff",
    role: "sales_staff",
    managerEmail: "manager@futeservices.com",
  },
  {
    email: "aditya@futeservices.com",
    // staff123
    passwordHash:
      "4644e62880d7921d78bf033a87f2da01:c4305fd8233a9961753343754031a441d878e4bc8986020c10a97ce884bf3f25e705eff26805f676a3b1cc910e69f2f6397f1d18ace7b260c048294100bd7da3",
    name: "Aditya Rane",
    role: "sales_staff",
    managerEmail: "manager@futeservices.com",
  },
  {
    email: "sneha@futeservices.com",
    // staff123
    passwordHash:
      "4644e62880d7921d78bf033a87f2da01:c4305fd8233a9961753343754031a441d878e4bc8986020c10a97ce884bf3f25e705eff26805f676a3b1cc910e69f2f6397f1d18ace7b260c048294100bd7da3",
    name: "Sneha Iyer",
    role: "sales_staff",
    managerEmail: "manager@futeservices.com",
  },
];

export function findUser(email: string, password: string): User | null {
  const normalized = email.trim().toLowerCase();
  const user = USERS.find((u) => u.email === normalized);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export function findUserByEmail(email: string): User | null {
  const normalized = email.trim().toLowerCase();
  return USERS.find((u) => u.email === normalized) ?? null;
}
