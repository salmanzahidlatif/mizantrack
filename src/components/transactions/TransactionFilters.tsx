"use client";

import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useFilterStore } from "@/store/filter-store";

import type { Account, FilterPeriod, TransactionType } from "@/types";

const PERIOD_OPTIONS: { value: FilterPeriod; label: string }[] = [
	{ value: "today", label: "Today" },
	{ value: "week", label: "This Week" },
	{ value: "month", label: "This Month" },
	{ value: "quarter", label: "This Quarter" },
	{ value: "half-year", label: "Half Year" },
	{ value: "year", label: "This Year" },
	{ value: "fiscal-year", label: "Fiscal Year" },
];

const TYPE_OPTIONS: { value: TransactionType | "All"; label: string }[] = [
	{ value: "All", label: "All Types" },
	{ value: "Expense", label: "Expense" },
	{ value: "Income", label: "Income" },
	{ value: "Transfer", label: "Transfer" },
];

interface TransactionFiltersProps {
	accounts: Account[];
}

export function TransactionFilters({ accounts }: TransactionFiltersProps) {
	const {
		period,
		accountId,
		transactionType,
		searchQuery,
		setPeriod,
		setAccountId,
		setTransactionType,
		setSearchQuery,
		reset,
	} = useFilterStore();

	const isFiltered =
		period !== "month" || accountId !== null || transactionType !== "All" || searchQuery !== "";

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				{/* Period */}
				<Select value={period} onValueChange={(v) => setPeriod(v as FilterPeriod)}>
					<SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PERIOD_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} className="text-xs">
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Account */}
				<Select
					value={accountId ?? "all"}
					onValueChange={(v) => setAccountId(v === "all" ? null : v)}>
					<SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
						<SelectValue placeholder="All Accounts" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all" className="text-xs">
							All Accounts
						</SelectItem>
						{accounts.map((a) => (
							<SelectItem key={a.id} value={a.id} className="text-xs">
								{a.title}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Type */}
				<Select
					value={transactionType}
					onValueChange={(v) => setTransactionType(v as TransactionType | "All")}>
					<SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TYPE_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} className="text-xs">
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{isFiltered && (
					<Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={reset}>
						<X className="mr-1 h-3 w-3" />
						Reset
					</Button>
				)}
			</div>

			{/* Search */}
			<div className="relative">
				<Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="h-8 pl-8 text-xs"
					placeholder="Search description or place…"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={() => setSearchQuery("")}
						className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground">
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}
