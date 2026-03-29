/** @type {import("prettier").Config} */
const config = {
	semi: true,
	singleQuote: false,
	jsxSingleQuote: false,
	trailingComma: "es5",
	printWidth: 100,
	tabWidth: 2,
	useTabs: true,
	bracketSpacing: true,
	bracketSameLine: true,
	arrowParens: "always",
	endOfLine: "lf",
	plugins: ["prettier-plugin-tailwindcss"],
	tailwindStylesheet: "./src/app/globals.css",
	tailwindFunctions: ["cn", "clsx", "cva"],
};

export default config;
