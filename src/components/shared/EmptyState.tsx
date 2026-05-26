import { cn } from "@/lib/utils";

interface EmptyStateProps {
	title: string;
	description?: string;
	action?: {
		label: string;
		onClick: () => void;
	};
	icon?: React.ReactNode;
	className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-10 text-center",
				className
			)}>
			{icon && <div className="text-muted-foreground">{icon}</div>}
			<div>
				<p className="text-sm font-semibold text-foreground">{title}</p>
				{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
			</div>
			{action && (
				<button
					type="button"
					onClick={action.onClick}
					className="mt-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
					{action.label}
				</button>
			)}
		</div>
	);
}
