import type { SVGProps } from "react";

export function DirhamSign({ className, ...props }: SVGProps<SVGSVGElement>) {
	const classes = ["inline-block h-[0.82em] w-[0.82em] shrink-0 align-[-0.08em]", className]
		.filter(Boolean)
		.join(" ");

	return (
		<svg
			{...props}
			aria-hidden="true"
			className={classes}
			data-testid="dirham-sign"
			fill="none"
			focusable="false"
			height="0.82em"
			viewBox="0 0 64 64"
			width="0.82em">
			<path
				d="M20 9h13c13.3 0 22.5 9.4 22.5 23S46.3 55 33 55H20V9Z"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeWidth="7"
			/>
			<path
				d="M5 26.5h48M5 37.5h48"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="5.5"
			/>
		</svg>
	);
}
