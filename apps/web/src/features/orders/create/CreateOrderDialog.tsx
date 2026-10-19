import { MAX_ITEMS_PER_ORDER, type OrderDetail } from "@sarh/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, isRetryableError } from "../../../lib/api-client";
import { formatMoney } from "../../../lib/money";
import {
  draftTotalCents,
  emptyDraft,
  emptyItem,
  parseDraft,
  type FieldErrors,
  type ItemDraft,
  type OrderDraft,
} from "./order-draft";
import { useCreateOrder } from "./use-create-order";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (order: OrderDetail) => void;
};

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field__error">{message}</span> : null;
}

export function CreateOrderDialog({ open, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { createOrder, isPending, failureCount, error, reset } = useCreateOrder();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function clearErrors(matches: (path: string) => boolean) {
    setFieldErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([path]) => !matches(path))),
    );
  }

  function updateCustomer(field: "customerName" | "customerEmail", value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    clearErrors((path) => path === field);
  }

  function updateItem(index: number, field: keyof Omit<ItemDraft, "id">, value: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
    const errorField = field === "unitPrice" ? "unitPriceCents" : field;
    clearErrors((path) => path === `items.${index}.${errorField}` || path === "totalCents");
  }

  function removeItem(index: number) {
    setDraft((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }));
    clearErrors((path) => path.startsWith("items") || path === "totalCents");
  }

  function addItem() {
    setDraft((current) => ({ ...current, items: [...current.items, emptyItem()] }));
    clearErrors((path) => path === "items");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const parsed = parseDraft(draft);
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    try {
      const order = await createOrder(parsed.input);
      setDraft(emptyDraft());
      reset();
      onCreated(order);
    } catch (caught) {
      if (caught instanceof ApiError && caught.issues.length > 0) {
        setFieldErrors(
          Object.fromEntries(caught.issues.map((issue) => [issue.path, issue.message])),
        );
      }
    }
  }

  const submitLabel = !isPending ? "Create order" : failureCount > 0 ? "Retrying…" : "Creating…";
  const serverError =
    error && !(error instanceof ApiError && error.issues.length > 0) ? error : null;

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      onClose={onClose}
      aria-labelledby="create-order-title"
    >
      <form className="order-form" onSubmit={handleSubmit} noValidate>
        <header className="dialog__header">
          <h2 id="create-order-title">New order</h2>
          <button type="button" className="button--ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="order-form__customer">
          <label className="field">
            <span className="field__label">Customer name</span>
            <input
              value={draft.customerName}
              onChange={(event) => updateCustomer("customerName", event.target.value)}
              aria-invalid={Boolean(fieldErrors.customerName)}
              autoComplete="off"
            />
            <FieldError message={fieldErrors.customerName} />
          </label>
          <label className="field">
            <span className="field__label">Customer email</span>
            <input
              type="email"
              value={draft.customerEmail}
              onChange={(event) => updateCustomer("customerEmail", event.target.value)}
              aria-invalid={Boolean(fieldErrors.customerEmail)}
              autoComplete="off"
            />
            <FieldError message={fieldErrors.customerEmail} />
          </label>
        </div>

        <fieldset className="order-form__items">
          <legend className="field__label">Items</legend>
          {draft.items.map((item, index) => (
            <div key={item.id} className="item-row">
              <label className="field field--grow">
                <span className="visually-hidden">Product {index + 1}</span>
                <input
                  placeholder="Product"
                  value={item.productName}
                  onChange={(event) => updateItem(index, "productName", event.target.value)}
                  aria-invalid={Boolean(fieldErrors[`items.${index}.productName`])}
                />
                <FieldError message={fieldErrors[`items.${index}.productName`]} />
              </label>
              <label className="field field--narrow">
                <span className="visually-hidden">Quantity {index + 1}</span>
                <input
                  inputMode="numeric"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(event) => updateItem(index, "quantity", event.target.value)}
                  aria-invalid={Boolean(fieldErrors[`items.${index}.quantity`])}
                />
                <FieldError message={fieldErrors[`items.${index}.quantity`]} />
              </label>
              <label className="field field--price">
                <span className="visually-hidden">Unit price {index + 1}</span>
                <input
                  inputMode="decimal"
                  placeholder="Unit price (SAR)"
                  value={item.unitPrice}
                  onChange={(event) => updateItem(index, "unitPrice", event.target.value)}
                  aria-invalid={Boolean(fieldErrors[`items.${index}.unitPriceCents`])}
                />
                <FieldError message={fieldErrors[`items.${index}.unitPriceCents`]} />
              </label>
              <button
                type="button"
                className="button--ghost"
                onClick={() => removeItem(index)}
                disabled={draft.items.length === 1}
                aria-label={`Remove item ${index + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <FieldError message={fieldErrors.items} />
          <button
            type="button"
            onClick={addItem}
            disabled={draft.items.length >= MAX_ITEMS_PER_ORDER}
          >
            Add item
          </button>
        </fieldset>

        <div className="order-form__total">
          <span>Total</span>
          <strong>{formatMoney(draftTotalCents(draft))}</strong>
        </div>
        <FieldError message={fieldErrors.totalCents} />

        {serverError && (
          <p className="notice notice--error" role="alert">
            {serverError.message}
            {isRetryableError(serverError) &&
              " — submitting again is safe and will not create a duplicate order."}
          </p>
        )}

        <footer className="dialog__footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button--primary" disabled={isPending}>
            {submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
