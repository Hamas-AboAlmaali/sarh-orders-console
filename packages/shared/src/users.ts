import { z } from "zod";

export const USER_ROLES = ["admin", "agent"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  // Bounded so a huge body cannot make the server hash megabytes of input.
  password: z.string().min(1).max(200),
});
export type LoginInput = z.input<typeof loginSchema>;

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
};
