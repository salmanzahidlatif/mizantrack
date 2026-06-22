export type AccountSort = "balance-desc" | "balance-asc" | "title-asc" | "updated-desc";

export const accountSortOptions: Array<{ value: AccountSort; label: string }> = [
	{ value: "balance-desc", label: "Highest balance" },
	{ value: "balance-asc", label: "Lowest balance" },
	{ value: "title-asc", label: "Name (A-Z)" },
	{ value: "updated-desc", label: "Recently updated" },
];

