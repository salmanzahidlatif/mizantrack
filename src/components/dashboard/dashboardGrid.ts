export const DASHBOARD_GRID_CLASSNAME =
	"touch-pan-y space-y-4 md:grid md:grid-cols-12 md:items-stretch md:gap-5 md:space-y-0 xl:gap-6";

export const DASHBOARD_GRID_CELL_CLASSNAMES = [
	"md:col-span-5 md:flex xl:col-span-4",
	"md:col-span-7 md:flex xl:col-span-4",
	"md:col-span-12 md:flex xl:col-span-4",
	"md:col-span-12 md:block",
	"md:col-span-12 md:flex lg:col-span-7",
	"md:col-span-6 md:flex lg:col-span-5",
	"md:col-span-6 md:flex lg:col-span-5",
	"md:col-span-6 md:flex lg:col-span-7",
] as const;

export const DASHBOARD_GRID_CELLS = {
	whatYouHave: DASHBOARD_GRID_CELL_CLASSNAMES[0],
	summary: DASHBOARD_GRID_CELL_CLASSNAMES[1],
	accountDistribution: DASHBOARD_GRID_CELL_CLASSNAMES[2],
	metrics: DASHBOARD_GRID_CELL_CLASSNAMES[3],
	cashFlow: DASHBOARD_GRID_CELL_CLASSNAMES[4],
	spending: DASHBOARD_GRID_CELL_CLASSNAMES[5],
	category: DASHBOARD_GRID_CELL_CLASSNAMES[6],
	budgets: DASHBOARD_GRID_CELL_CLASSNAMES[7],
} as const;
