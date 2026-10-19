import { describe, expect, it } from "vitest";
import { draftTotalCents, emptyItem, parseDraft, type OrderDraft } from "./order-draft";

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    customerName: "Sara Ali",
    customerEmail: "sara@example.com",
    items: [
      { ...emptyItem(), productName: "Lamp", quantity: "2", unitPrice: "45" },
      { ...emptyItem(), productName: "Notebook", quantity: "1", unitPrice: "12.50" },
    ],
    ...overrides,
  };
}

describe("parseDraft", () => {
  it("converts a valid draft into an API request with integer cents and a computed total", () => {
    expect(parseDraft(draft())).toEqual({
      ok: true,
      input: {
        customerName: "Sara Ali",
        customerEmail: "sara@example.com",
        items: [
          { productName: "Lamp", quantity: 2, unitPriceCents: 4_500 },
          { productName: "Notebook", quantity: 1, unitPriceCents: 1_250 },
        ],
        totalCents: 10_250,
      },
    });
  });

  it("reports every invalid field under the API's dotted paths", () => {
    const result = parseDraft(
      draft({
        customerName: " ",
        customerEmail: "not-an-email",
        items: [{ ...emptyItem(), productName: "", quantity: "1.5", unitPrice: "free" }],
      }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual([
      "customerEmail",
      "customerName",
      "items.0.productName",
      "items.0.quantity",
      "items.0.unitPriceCents",
    ]);
  });
});

describe("draftTotalCents", () => {
  it("keeps a running total, counting lines that do not parse yet as zero", () => {
    const partial = draft();
    partial.items.push({ ...emptyItem(), productName: "Pen", quantity: "3", unitPrice: "abc" });

    expect(draftTotalCents(partial)).toBe(10_250);
  });
});
