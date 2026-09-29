"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useHaptics } from "@/hooks/useHaptics";

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const haptics = useHaptics();

	const handleToggle = () => {
		haptics.selection();
		setTheme(theme === "dark" ? "light" : "dark");
	};

	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={handleToggle}
			className="press-scale tappable relative h-10 w-10 rounded-full transition-colors duration-[var(--dur-base)] ease-[var(--ease-ios)] hover:bg-accent/80 motion-reduce:transition-none">
			<Sun className="h-4 w-4 scale-100 rotate-0 opacity-100 transition-all duration-[var(--dur-base)] ease-[var(--ease-spring)] motion-reduce:transition-none dark:scale-0 dark:-rotate-90 dark:opacity-0" />
			<Moon className="absolute h-4 w-4 scale-0 rotate-90 opacity-0 transition-all duration-[var(--dur-base)] ease-[var(--ease-spring)] motion-reduce:transition-none dark:scale-100 dark:rotate-0 dark:opacity-100" />
			<span className="sr-only">Toggle theme</span>
		</Button>
	);
}
