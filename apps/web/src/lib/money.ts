const money = new Intl.NumberFormat("en-SA", { style: "currency", currency: "SAR" });

export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

const MONEY_INPUT = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** Parses user input such as "12", "12.5" or "12.50" into integer cents without floating-point math. */
export function parseMoneyInput(value: string): number | null {
  const match = MONEY_INPUT.exec(value.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
