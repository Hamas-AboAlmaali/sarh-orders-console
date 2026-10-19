import { createOrderSchema, sumLineItems, type CreateOrderInput } from "@sarh/shared";
import { parseMoneyInput } from "../../../lib/money";

/** What the form holds: raw strings exactly as typed, converted only on submit. */
export type ItemDraft = { id: number; productName: string; quantity: string; unitPrice: string };
export type OrderDraft = { customerName: string; customerEmail: string; items: ItemDraft[] };

/** Errors keyed by the same dotted paths the API uses, e.g. "items.0.quantity". */
export type FieldErrors = Record<string, string>;

// Stable React keys, so removing a middle line does not shift input state between rows.
let nextItemId = 0;

export const emptyItem = (): ItemDraft => ({
  id: nextItemId++,
  productName: "",
  quantity: "1",
  unitPrice: "",
});
export const emptyDraft = (): OrderDraft => ({
  customerName: "",
  customerEmail: "",
  items: [emptyItem()],
});

function parseQuantity(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

/** Running total for display while typing; lines that do not parse yet count as zero. */
export function draftTotalCents(draft: OrderDraft): number {
  return sumLineItems(
    draft.items.map((item) => ({
      quantity: parseQuantity(item.quantity) ?? 0,
      unitPriceCents: parseMoneyInput(item.unitPrice) ?? 0,
    })),
  );
}

/** Converts the draft into an API request, validated by the same schema the server enforces. */
export function parseDraft(
  draft: OrderDraft,
): { ok: true; input: CreateOrderInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const items = draft.items.map((item, index) => {
    const quantity = parseQuantity(item.quantity);
    const unitPriceCents = parseMoneyInput(item.unitPrice);
    if (quantity === null) errors[`items.${index}.quantity`] = "Enter a whole number";
    if (unitPriceCents === null)
      errors[`items.${index}.unitPriceCents`] = "Enter an amount like 12.50";
    return {
      productName: item.productName,
      quantity: quantity ?? 0,
      unitPriceCents: unitPriceCents ?? 0,
    };
  });
  const input: CreateOrderInput = {
    customerName: draft.customerName,
    customerEmail: draft.customerEmail,
    items,
    totalCents: sumLineItems(items),
  };

  const result = createOrderSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors[issue.path.join(".")] ??= issue.message;
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input };
}
