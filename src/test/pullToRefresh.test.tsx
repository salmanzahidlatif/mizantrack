import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePullToRefresh } from "@/hooks/usePullToRefresh";

function Harness({ onRefresh }: { onRefresh: () => Promise<void> }) {
	const ref = useRef<HTMLDivElement>(null);
	const pullToRefresh = usePullToRefresh({
		containerRef: ref,
		onRefresh,
	});

	return (
		<>
			<div ref={ref} data-testid="scroll-root">
				<div>Scrollable content</div>
			</div>
			{pullToRefresh.indicator}
		</>
	);
}

class TestPointerEvent extends MouseEvent {
	pointerId: number;
	pointerType: string;
	isPrimary: boolean;

	constructor(type: string, init: PointerEventInit = {}) {
		super(type, init);
		this.pointerId = init.pointerId ?? 1;
		this.pointerType = init.pointerType ?? "touch";
		this.isPrimary = init.isPrimary ?? true;
	}
}

describe("pull-to-refresh", () => {
	beforeEach(() => {
		Object.defineProperty(window, "PointerEvent", {
			configurable: true,
			value: TestPointerEvent,
		});
		Element.prototype.setPointerCapture = vi.fn();
		Element.prototype.releasePointerCapture = vi.fn();
		Element.prototype.hasPointerCapture = vi.fn(() => true);
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));
	});

	it("forces a refresh after a downward pull from the top", async () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined);
		render(<Harness onRefresh={onRefresh} />);
		const root = screen.getByTestId("scroll-root");

		await act(async () => {
			fireEvent.pointerDown(root, {
				pointerId: 1,
				pointerType: "touch",
				isPrimary: true,
				button: 0,
				clientX: 40,
				clientY: 0,
			});
			fireEvent.pointerMove(root, {
				pointerId: 1,
				pointerType: "touch",
				isPrimary: true,
				clientX: 42,
				clientY: 96,
			});
		});

		expect(screen.getByText("Release to refresh")).toBeInTheDocument();

		await act(async () => {
			fireEvent.pointerUp(root, {
				pointerId: 1,
				pointerType: "touch",
				isPrimary: true,
				clientX: 42,
				clientY: 96,
			});
		});

		await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
	});

	it("ignores gestures inside swipe-navigation opt-out regions", async () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined);
		render(
			<Harness
				onRefresh={async () => {
					await onRefresh();
				}}
			/>
		);
		const root = screen.getByTestId("scroll-root");
		const ignored = document.createElement("button");
		ignored.setAttribute("data-swipe-navigation-ignore", "");
		root.appendChild(ignored);

		fireEvent.pointerDown(ignored, {
			pointerId: 1,
			pointerType: "touch",
			isPrimary: true,
			button: 0,
			clientX: 40,
			clientY: 0,
		});
		fireEvent.pointerMove(root, {
			pointerId: 1,
			pointerType: "touch",
			isPrimary: true,
			clientX: 42,
			clientY: 120,
		});
		fireEvent.pointerUp(root, {
			pointerId: 1,
			pointerType: "touch",
			isPrimary: true,
			clientX: 42,
			clientY: 120,
		});

		expect(onRefresh).not.toHaveBeenCalled();
	});
});
