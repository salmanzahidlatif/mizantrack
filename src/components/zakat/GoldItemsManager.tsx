"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";
import { useState } from "react";
import { v4 as uuid } from "uuid";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { GoldItem, GoldPurity } from "@/types";

interface GoldItemsManagerProps {
	userId: string;
	goldPricePerGram: number; // Current market price
	referenceCurrency: string;
}

const PURITY_TO_PURE_GOLD: Record<GoldPurity, number> = {
	"21k": 21 / 24,
	"22k": 22 / 24,
	"24k": 1.0,
};

export function GoldItemsManager({
	userId,
	goldPricePerGram,
	referenceCurrency,
}: GoldItemsManagerProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const goldItems = useLiveQuery(
		() =>
			db.goldItems
				.where("userId")
				.equals(userId)
				.filter(
					(g) =>
						!g.deletedAt &&
						normalizeCurrencyCode(g.currency) === normalizeCurrencyCode(referenceCurrency)
				)
				.toArray(),
		[userId, referenceCurrency]
	);

	const totalPureGold =
		goldItems?.reduce((sum, item) => {
			const pureWeight = item.weight * PURITY_TO_PURE_GOLD[item.purity];
			return sum + pureWeight;
		}, 0) ?? 0;

	const totalValue = totalPureGold * goldPricePerGram;

	async function handleAdd(item: Omit<GoldItem, "id" | "userId" | "currency" | "updatedAt">) {
		await db.goldItems.add({
			...item,
			id: uuid(),
			userId,
			currency: referenceCurrency,
			updatedAt: Date.now(),
		});
		setIsAdding(false);
	}

	async function handleUpdate(id: string, updates: Partial<GoldItem>) {
		await db.goldItems.update(id, { ...updates, updatedAt: Date.now() });
		setEditingId(null);
	}

	async function handleDelete(id: string) {
		await db.goldItems.update(id, { deletedAt: Date.now() });
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium">Gold Inventory</h3>
					<p className="text-xs text-muted-foreground">
						Track your gold holdings with different purities
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add Gold Item
				</Button>
			</div>

			{/* Summary */}
			<div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3">
				<div>
					<p className="text-xs text-muted-foreground">Total Pure Gold</p>
					<p className="text-lg font-bold tabular-nums">{totalPureGold.toFixed(2)}g</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Total Value</p>
					<p className="text-lg font-bold tabular-nums">
						<CurrencyAmount
							amount={totalValue}
							currency={referenceCurrency}
							className="text-lg font-bold"
						/>
					</p>
				</div>
			</div>

			{/* Add Form */}
			{isAdding && (
				<GoldItemForm
					onSave={(data) => void handleAdd(data)}
					onCancel={() => setIsAdding(false)}
					referenceCurrency={referenceCurrency}
				/>
			)}

			{/* Gold Items List */}
			<div className="space-y-2">
				{goldItems?.map((item) =>
					editingId === item.id ? (
						<GoldItemForm
							key={item.id}
							initialData={item}
							onSave={(data) => void handleUpdate(item.id, data)}
							onCancel={() => setEditingId(null)}
							referenceCurrency={referenceCurrency}
						/>
					) : (
						<div
							key={item.id}
							className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<span className="font-medium">{item.title}</span>
									<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
										{item.purity}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									{item.weight}g → {(item.weight * PURITY_TO_PURE_GOLD[item.purity]).toFixed(2)}g
									pure
								</p>
								{item.purchaseDate && (
									<p className="text-xs text-muted-foreground">
										Purchased: {new Date(item.purchaseDate).toLocaleDateString()}
										{item.purchasePrice && (
											<>
												{" "}
												•{" "}
												<CurrencyAmount
													amount={item.purchasePrice}
													currency={referenceCurrency}
													className="font-normal tracking-normal"
												/>
											</>
										)}
									</p>
								)}
							</div>
							<div className="flex items-center gap-1">
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setEditingId(item.id)}
									className="h-8 w-8 p-0">
									<Edit2 className="h-3.5 w-3.5" />
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => void handleDelete(item.id)}
									className="h-8 w-8 p-0 text-destructive hover:text-destructive">
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					)
				)}

				{goldItems?.length === 0 && !isAdding && (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No gold items yet. Add your first item above.
					</p>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Gold Item Form Component
// ============================================================================

interface GoldItemFormProps {
	initialData?: Partial<GoldItem>;
	onSave: (data: Omit<GoldItem, "id" | "userId" | "currency" | "updatedAt">) => void;
	onCancel: () => void;
	referenceCurrency: string;
}

function GoldItemForm({ initialData, onSave, onCancel, referenceCurrency }: GoldItemFormProps) {
	const [title, setTitle] = useState(initialData?.title ?? "");
	const [weight, setWeight] = useState(initialData?.weight ?? 0);
	const [purity, setPurity] = useState<GoldPurity>(initialData?.purity ?? "22k");
	const [purchaseDate, setPurchaseDate] = useState(
		initialData?.purchaseDate ? new Date(initialData.purchaseDate).toISOString().split("T")[0] : ""
	);
	const [purchasePrice, setPurchasePrice] = useState(initialData?.purchasePrice ?? 0);
	const [notes, setNotes] = useState(initialData?.notes ?? "");

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!title || weight <= 0) return;

		onSave({
			title,
			weight,
			purity,
			purchaseDate: purchaseDate ? new Date(purchaseDate).getTime() : undefined,
			purchasePrice: purchasePrice > 0 ? purchasePrice : undefined,
			notes: notes.trim() || undefined,
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-accent/50 p-4">
			<div className="grid gap-3 sm:grid-cols-2">
				{/* Title */}
				<div className="space-y-1">
					<Label className="text-xs">Title *</Label>
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="e.g., Wedding Ring"
						required
					/>
				</div>

				{/* Purity */}
				<div className="space-y-1">
					<Label className="text-xs">Purity *</Label>
					<Select value={purity} onValueChange={(v) => setPurity(v as GoldPurity)}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="21k">21 Karat</SelectItem>
							<SelectItem value="22k">22 Karat</SelectItem>
							<SelectItem value="24k">24 Karat (Pure)</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* Weight */}
				<div className="space-y-1">
					<Label className="text-xs">Weight (grams) *</Label>
					<Input
						type="number"
						min={0}
						step="any"
						value={weight || ""}
						onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
						placeholder="0.00"
						required
					/>
					{weight > 0 && (
						<p className="text-xs text-muted-foreground">
							Pure gold: {(weight * PURITY_TO_PURE_GOLD[purity]).toFixed(2)}g
						</p>
					)}
				</div>

				{/* Purchase Date */}
				<div className="space-y-1">
					<Label className="text-xs">Purchase Date</Label>
					<Input
						type="date"
						value={purchaseDate}
						onChange={(e) => setPurchaseDate(e.target.value)}
					/>
				</div>

				{/* Purchase Price */}
				<div className="space-y-1">
					<Label className="text-xs">Purchase Price ({referenceCurrency})</Label>
					<Input
						type="number"
						min={0}
						step="any"
						value={purchasePrice || ""}
						onChange={(e) => setPurchasePrice(parseFloat(e.target.value) || 0)}
						placeholder="0.00"
					/>
				</div>
			</div>

			{/* Notes */}
			<div className="space-y-1">
				<Label className="text-xs">Notes</Label>
				<Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
			</div>

			{/* Actions */}
			<div className="flex justify-end gap-2">
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					<X className="mr-1.5 h-3.5 w-3.5" />
					Cancel
				</Button>
				<Button type="submit" size="sm">
					<Save className="mr-1.5 h-3.5 w-3.5" />
					Save
				</Button>
			</div>
		</form>
	);
}
