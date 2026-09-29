"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { useHaptics } from "@/hooks/useHaptics";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";

type DrawerSnapPoint = number | string;
type DrawerRootProps = Omit<
	React.ComponentProps<typeof DrawerPrimitive.Root>,
	"snapPoints" | "activeSnapPoint" | "setActiveSnapPoint" | "fadeFromIndex"
>;
type DrawerProps = DrawerRootProps & {
	enableSnapPoints?: boolean;
	snapPoints?: DrawerSnapPoint[];
	activeSnapPoint?: DrawerSnapPoint | null;
	setActiveSnapPoint?: (snapPoint: DrawerSnapPoint | null) => void;
	fadeFromIndex?: number;
};
type DrawerContentProps = React.ComponentProps<typeof DrawerPrimitive.Content> & {
	showHandle?: boolean;
};

const DEFAULT_DRAWER_SNAP_POINTS: DrawerSnapPoint[] = [0.6, 0.95];

function Drawer({
	enableSnapPoints = false,
	snapPoints,
	activeSnapPoint,
	setActiveSnapPoint,
	fadeFromIndex,
	shouldScaleBackground = true,
	scrollLockTimeout = 250,
	repositionInputs = false,
	snapToSequentialPoint = true,
	...props
}: DrawerProps) {
	const { light } = useHaptics();
	const resolvedSnapPoints = React.useMemo(() => {
		if (snapPoints?.length) {
			return snapPoints;
		}

		if (enableSnapPoints) {
			return DEFAULT_DRAWER_SNAP_POINTS;
		}

		return undefined;
	}, [enableSnapPoints, snapPoints]);
	const [internalActiveSnapPoint, setInternalActiveSnapPoint] =
		React.useState<DrawerSnapPoint | null>(() => resolvedSnapPoints?.[0] ?? null);
	const currentActiveSnapPoint =
		activeSnapPoint !== undefined ? activeSnapPoint : internalActiveSnapPoint;
	const handleSnapPointChange = React.useCallback(
		(nextSnapPoint: DrawerSnapPoint | null) => {
			if (nextSnapPoint !== currentActiveSnapPoint) {
				light();
			}

			if (activeSnapPoint === undefined) {
				setInternalActiveSnapPoint(nextSnapPoint);
			}

			setActiveSnapPoint?.(nextSnapPoint);
		},
		[activeSnapPoint, currentActiveSnapPoint, light, setActiveSnapPoint]
	);

	React.useEffect(() => {
		if (!resolvedSnapPoints?.length || activeSnapPoint !== undefined) {
			return;
		}

		if (internalActiveSnapPoint === null || !resolvedSnapPoints.includes(internalActiveSnapPoint)) {
			setInternalActiveSnapPoint(resolvedSnapPoints[0] ?? null);
		}
	}, [activeSnapPoint, internalActiveSnapPoint, resolvedSnapPoints]);

	const snapPointProps = resolvedSnapPoints?.length
		? {
				activeSnapPoint: currentActiveSnapPoint,
				fadeFromIndex: fadeFromIndex ?? resolvedSnapPoints.length - 1,
				setActiveSnapPoint: handleSnapPointChange,
				snapPoints: resolvedSnapPoints,
			}
		: {};

	return (
		<DrawerPrimitive.Root
			data-slot="drawer"
			shouldScaleBackground={shouldScaleBackground}
			scrollLockTimeout={scrollLockTimeout}
			repositionInputs={repositionInputs}
			snapToSequentialPoint={snapToSequentialPoint}
			{...snapPointProps}
			{...props}
		/>
	);
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
	return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
	return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
	return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
	className,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
	return (
		<DrawerPrimitive.Overlay
			data-slot="drawer-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/20 duration-[var(--dur-base)] ease-[var(--ease-out-expo)] supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
				className
			)}
			{...props}
		/>
	);
}

function DrawerContent({
	className,
	children,
	showHandle = true,
	style,
	...props
}: DrawerContentProps) {
	const { isKeyboardOpen } = useKeyboardInset();

	return (
		<DrawerPortal data-slot="drawer-portal">
			<DrawerOverlay />
			<DrawerPrimitive.Content
				data-slot="drawer-content"
				data-keyboard-open={isKeyboardOpen ? "true" : "false"}
				className={cn(
					"group/drawer-content fixed z-50 flex h-auto [transform:translateZ(0)] flex-col overflow-y-auto overscroll-contain border-border/60 bg-popover text-sm text-popover-foreground shadow-[var(--shadow-sheet)] outline-none [-webkit-overflow-scrolling:touch] [backface-visibility:hidden] data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[88dvh] data-[vaul-drawer-direction=bottom]:rounded-t-3xl data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--keyboard-inset,0px))] data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:rounded-r-3xl data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:rounded-l-3xl data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[88dvh] data-[vaul-drawer-direction=top]:rounded-b-3xl data-[vaul-drawer-direction=top]:border-b data-[vaul-snap-points=true]:h-[calc(100dvh_-_env(safe-area-inset-top,0px)_-_1rem)] data-[vaul-snap-points=true]:max-h-[95dvh] data-[vaul-drawer-direction=left]:sm:max-w-sm data-[vaul-drawer-direction=right]:sm:max-w-sm",
					"data-[vaul-drawer-direction=bottom]:slide-up-sheet motion-reduce:animate-none motion-reduce:transition-none",
					className
				)}
				style={style}
				{...props}>
				{showHandle && (
					<div className="hidden shrink-0 touch-none px-4 pt-3 pb-2 group-data-[vaul-drawer-direction=bottom]/drawer-content:block">
						<DrawerPrimitive.Handle className="mx-auto !h-1.5 !w-12 !rounded-full !bg-muted-foreground/30 transition-[opacity,transform,background-color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] active:scale-110 active:!bg-muted-foreground/45" />
					</div>
				)}
				{children}
			</DrawerPrimitive.Content>
		</DrawerPortal>
	);
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="drawer-header"
			className={cn(
				"flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-0.5 md:text-left",
				className
			)}
			{...props}
		/>
	);
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="drawer-footer"
			className={cn("pb-safe mt-auto flex flex-col gap-2 p-4", className)}
			{...props}
		/>
	);
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
	return (
		<DrawerPrimitive.Title
			data-slot="drawer-title"
			className={cn("font-heading text-base font-medium text-foreground", className)}
			{...props}
		/>
	);
}

function DrawerDescription({
	className,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
	return (
		<DrawerPrimitive.Description
			data-slot="drawer-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Drawer,
	DrawerPortal,
	DrawerOverlay,
	DrawerTrigger,
	DrawerClose,
	DrawerContent,
	DrawerHeader,
	DrawerFooter,
	DrawerTitle,
	DrawerDescription,
};
