import {
  ORDER_STATUSES,
  type OrderSortField,
  type OrderStatus,
  type SortDirection,
} from "@sarh/shared";

export type SortOption = { sort: OrderSortField; direction: SortDirection };

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Newest first", value: { sort: "createdAt", direction: "desc" } },
  { label: "Oldest first", value: { sort: "createdAt", direction: "asc" } },
  { label: "Amount: high to low", value: { sort: "totalCents", direction: "desc" } },
  { label: "Amount: low to high", value: { sort: "totalCents", direction: "asc" } },
];

const sortKey = ({ sort, direction }: SortOption) => `${sort}:${direction}`;

type Props = {
  search: string;
  onSearchChange: (search: string) => void;
  status: OrderStatus | undefined;
  onStatusChange: (status: OrderStatus | undefined) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
};

export function OrdersToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
}: Props) {
  return (
    <div className="toolbar" role="search">
      <label className="field field--grow">
        <span className="field__label">Search</span>
        <input
          type="search"
          placeholder="Customer name or email"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Status</span>
        <select
          value={status ?? ""}
          onChange={(event) =>
            onStatusChange((event.target.value || undefined) as OrderStatus | undefined)
          }
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value[0]!.toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Sort by</span>
        <select
          value={sortKey(sort)}
          onChange={(event) => {
            const option = SORT_OPTIONS.find(
              (candidate) => sortKey(candidate.value) === event.target.value,
            );
            if (option) onSortChange(option.value);
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={sortKey(option.value)} value={sortKey(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
