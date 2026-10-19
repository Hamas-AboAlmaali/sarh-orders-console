import { describe, expect, it } from "vitest";
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("stores a salted scrypt hash, not the password, and verifies it", async () => {
    const hash = await hashPassword("correct horse");

    expect(hash).not.toContain("correct horse");
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    await expect(verifyPassword("correct horse", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse");

    await expect(verifyPassword("correct horsE", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("uses a fresh salt for every hash", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);

    expect(first).not.toBe(second);
    await expect(verifyPassword("same", first)).resolves.toBe(true);
    await expect(verifyPassword("same", second)).resolves.toBe(true);
  });

  it("rejects a plain-text password left in the column", async () => {
    await expect(verifyPassword("admin123", "admin123")).resolves.toBe(false);
  });

  it("checks unknown emails against a dummy hash and always fails", async () => {
    await expect(verifyAgainstDummyHash("anything")).resolves.toBe(false);
  });
});
