const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" });

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}
