"use client";

import { format } from "date-fns";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { CARD_SURFACE } from "@/lib/motion";
import { UNASSIGNED_PROJECT_ID } from "@/lib/reports/reportEngine";
import {
	createProject,
	deleteProject,
	setTransactionTag,
	updateProject,
} from "@/lib/reports/reportRepository";
import { cn } from "@/lib/utils";

import type { ReportProject, ReportProjectGroup } from "@/types";

interface ReportProjectsSectionProps {
	userId: string;
	projects: ReportProject[];
	groups: ReportProjectGroup[];
	grandTotal: number;
}

interface ProjectFormValues {
	title: string;
	note: string;
}

export function ReportProjectsSection({
	userId,
	projects,
	groups,
	grandTotal,
}: ReportProjectsSectionProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const grandTotalCurrency = groups.find((group) => group.currency)?.currency;
	// The engine synthesises placeholder projects (updatedAt 0) for unassigned or
	// orphaned payments; they are shown only while they still hold payments.
	const visibleGroups = groups.filter(
		(group) => group.payments.length > 0 || group.project.updatedAt !== 0
	);

	async function handleCreate(values: ProjectFormValues) {
		if (!values.title.trim()) return;

		try {
			await createProject(userId, { title: values.title, note: values.note });
			setIsAdding(false);
			toast.success("Project added.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not add the project.");
		}
	}

	async function handleUpdate(projectId: string, values: ProjectFormValues) {
		try {
			await updateProject(projectId, { title: values.title, note: values.note });
			setEditingId(null);
			toast.success("Project updated.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not update the project.");
		}
	}

	async function handleDelete(project: ReportProject) {
		try {
			await deleteProject(userId, project.id);
			toast.success(`${project.title} deleted. Its payments are now unassigned.`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not delete the project.");
		}
	}

	async function handleReassign(transactionId: string, projectId: string) {
		try {
			await setTransactionTag(userId, {
				transactionId,
				role: "plot-payment",
				projectId: projectId === UNASSIGNED_PROJECT_ID ? undefined : projectId,
				confirmed: true,
			});
			toast.success("Payment moved.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not move the payment.");
		}
	}

	return (
		<section
			className={cn(CARD_SURFACE, "space-y-4 p-4")}
			aria-labelledby="report-projects-heading">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id="report-projects-heading" className="text-sm font-semibold">
						Plot payments
					</h2>
					<p className="text-xs text-muted-foreground">
						Confirmed property payments grouped by project.
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add project
				</Button>
			</div>

			{isAdding && (
				<ProjectForm
					onSave={(values) => void handleCreate(values)}
					onCancel={() => setIsAdding(false)}
				/>
			)}

			{visibleGroups.length === 0 ? (
				<p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
					No projects yet. Add one, then confirm a plot payment to file it here.
				</p>
			) : (
				<div className="space-y-3">
					{visibleGroups.map((group) => {
						const isSynthetic = group.project.updatedAt === 0;

						if (editingId === group.project.id) {
							return (
								<ProjectForm
									key={group.project.id}
									initialValues={{
										title: group.project.title,
										note: group.project.note ?? "",
									}}
									onSave={(values) => void handleUpdate(group.project.id, values)}
									onCancel={() => setEditingId(null)}
								/>
							);
						}

						return (
							<div key={group.project.id} className="rounded-xl border bg-card p-3">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">{group.project.title}</p>
										{group.project.note && (
											<p className="truncate text-xs text-muted-foreground">{group.project.note}</p>
										)}
										<p className="text-xs text-muted-foreground">
											{group.payments.length} payment{group.payments.length === 1 ? "" : "s"}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<CurrencyAmount
											amount={group.total}
											currency={group.currency}
											className="text-sm"
										/>
										{!isSynthetic && (
											<>
												<Button
													size="sm"
													variant="ghost"
													aria-label={`Rename ${group.project.title}`}
													onClick={() => setEditingId(group.project.id)}
													className="h-8 w-8 p-0">
													<Edit2 className="h-3.5 w-3.5" />
												</Button>
												<Button
													size="sm"
													variant="ghost"
													aria-label={`Delete ${group.project.title}`}
													onClick={() => void handleDelete(group.project)}
													className="h-8 w-8 p-0 text-destructive hover:text-destructive">
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</>
										)}
									</div>
								</div>

								{group.payments.length === 0 ? (
									<p className="mt-2 text-xs text-muted-foreground">
										No payments confirmed for this project yet.
									</p>
								) : (
									<ul className="mt-3 space-y-2">
										{group.payments.map((payment) => (
											<li
												key={payment.transactionId}
												className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/35 p-2">
												<div className="min-w-0">
													<p className="truncate text-sm">{payment.title}</p>
													<p className="text-xs text-muted-foreground">
														{format(payment.date, "d MMM yyyy")}
													</p>
												</div>
												<div className="flex items-center gap-2">
													<CurrencyAmount
														amount={payment.amount}
														currency={payment.currency}
														className="text-sm"
													/>
													<Select
														value={
															group.project.id === UNASSIGNED_PROJECT_ID
																? UNASSIGNED_PROJECT_ID
																: group.project.id
														}
														onValueChange={(projectId) =>
															void handleReassign(payment.transactionId, projectId)
														}>
														<SelectTrigger size="sm" className="w-40" aria-label="Move payment">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value={UNASSIGNED_PROJECT_ID}>Unassigned</SelectItem>
															{projects.map((project) => (
																<SelectItem key={project.id} value={project.id}>
																	{project.title}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						);
					})}
				</div>
			)}

			{visibleGroups.length > 0 && (
				<div className="flex items-center justify-between rounded-xl bg-muted/35 p-3">
					<span className="text-sm font-medium">Grand total</span>
					<CurrencyAmount amount={grandTotal} currency={grandTotalCurrency} className="text-base" />
				</div>
			)}
		</section>
	);
}

interface ProjectFormProps {
	initialValues?: ProjectFormValues;
	onSave: (values: ProjectFormValues) => void;
	onCancel: () => void;
}

function ProjectForm({ initialValues, onSave, onCancel }: ProjectFormProps) {
	const [title, setTitle] = useState(initialValues?.title ?? "");
	const [note, setNote] = useState(initialValues?.note ?? "");

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!title.trim()) return;
		onSave({ title, note });
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-accent/50 p-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1">
					<Label className="text-xs">Project title *</Label>
					<Input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="e.g. BWC 7 Marla Overseas Block"
						required
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Note</Label>
					<Input
						value={note}
						onChange={(event) => setNote(event.target.value)}
						placeholder="Optional"
					/>
				</div>
			</div>
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
