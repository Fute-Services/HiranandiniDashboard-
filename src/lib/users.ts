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

export type User = {
  email: string;
  password: string;
  name: string;
  role: Role;
  /** Only meaningful for sales_staff: which manager's team they're on. */
  managerEmail?: string;
};

export const USERS: User[] = [
  {
    email: "admin@hiranandani.com",
    password: "admin123",
    name: "Admin",
    role: "admin",
  },
  {
    email: "manager@hiranandani.com",
    password: "manager123",
    name: "Priya Kulkarni",
    role: "sales_manager",
  },
  {
    email: "staff@hiranandani.com",
    password: "staff123",
    name: "Sales Staff",
    role: "sales_staff",
    managerEmail: "manager@hiranandani.com",
  },
];

export function findUser(email: string, password: string): User | null {
  const normalized = email.trim().toLowerCase();
  return (
    USERS.find(
      (u) => u.email === normalized && u.password === password,
    ) ?? null
  );
}

export function findUserByEmail(email: string): User | null {
  const normalized = email.trim().toLowerCase();
  return USERS.find((u) => u.email === normalized) ?? null;
}
