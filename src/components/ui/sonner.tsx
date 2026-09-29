"use client";

import {
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
	OctagonXIcon,
	Loader2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();

	return (
		<Sonner
			theme={theme as ToasterProps["theme"]}
			position="bottom-center"
			mobileOffset={{
				bottom: "calc(env(safe-area-inset-bottom) + 1rem)",
				left: "1rem",
				right: "1rem",
			}}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "1rem",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast:
						"cn-toast material-blur rounded-2xl shadow-[var(--shadow-sheet)] data-[mounted=true]:animate-in data-[mounted=true]:fade-in-0 data-[mounted=true]:slide-in-from-bottom-2",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
