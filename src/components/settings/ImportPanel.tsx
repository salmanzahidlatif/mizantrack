"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importHysabKytab } from "@/lib/import/hysabKytab";

interface ImportPanelProps {
	userId: string;
}

interface ImportResult {
	accounts: number;
	categories: number;
	transactions: number;
	transfersPaired: number;
}

export function ImportPanel({ userId }: ImportPanelProps) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);
	const [result, setResult] = useState<ImportResult | null>(null);

	async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		setImporting(true);
		try {
			const res = await importHysabKytab(file, userId);
			setResult(res);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Import failed";
			toast.error(msg);
		} finally {
			setImporting(false);
			// Reset input so the same file can be re-imported
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-border bg-card p-4">
			<div>
				<h2 className="font-semibold">Import Data</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Import your Hysab Kytab backup (.xlsx file)
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
					{importing ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Importing…
						</>
					) : (
						<>
							<FileUp className="mr-2 h-4 w-4" />
							Choose HK File
						</>
					)}
				</Button>
				<span className="text-xs text-muted-foreground">.xlsx files only</span>
			</div>

			{/* Hidden file input */}
			<input
				ref={fileRef}
				type="file"
				accept=".xlsx"
				className="hidden"
				onChange={(e) => {
					void handleFile(e);
				}}
			/>

			{/* Result dialog */}
			<Dialog open={!!result} onOpenChange={() => setResult(null)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Import Complete</DialogTitle>
					</DialogHeader>
					{result && (
						<div className="space-y-3 py-2">
							<div className="divide-y divide-border rounded-lg border border-border">
								{[
									{ label: "Accounts imported", value: result.accounts },
									{ label: "Categories imported", value: result.categories },
									{ label: "Transactions imported", value: result.transactions },
									{ label: "Transfers paired", value: result.transfersPaired },
								].map(({ label, value }) => (
									<div key={label} className="flex justify-between px-4 py-2 text-sm">
										<span className="text-muted-foreground">{label}</span>
										<span className="font-medium">{value}</span>
									</div>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								Re-importing the same file will not create duplicates.
							</p>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
