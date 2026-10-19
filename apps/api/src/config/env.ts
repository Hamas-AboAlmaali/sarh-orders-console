import { config } from "dotenv";
import { z } from "zod";

config({ quiet: true });

// The value shipped in .env.example, so a copied example file is usable locally but not in production.
const EXAMPLE_JWT_SECRET = "dev-only-secret-replace-me-before-deploying-anywhere";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    PORT: z.coerce.number().int().positive().default(3001),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  })
  .refine((env) => env.NODE_ENV !== "production" || env.JWT_SECRET !== EXAMPLE_JWT_SECRET, {
    path: ["JWT_SECRET"],
    message: "JWT_SECRET still has the .env.example value; generate a real secret for production",
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
