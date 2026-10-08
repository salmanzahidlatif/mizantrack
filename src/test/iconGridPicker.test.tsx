import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconGridPicker, type IconGridPickerItem } from "@/components/shared/IconGridPicker";

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		error: vi.fn(),
		heavy: vi.fn(),
		light: vi.fn(),
		medium: vi.fn(),
		selection: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

beforeEach(() => {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

function item(id: string, title: string): IconGridPickerItem {
	return { icon: "🏷️", id, title };
}

function ControlledIconGridPicker({
	initialValue,
	items,
}: {
	initialValue: string;
	items: IconGridPickerItem[];
}) {
	const [value, setValue] = useState(initialValue);

	return <IconGridPicker label="Category" items={items} value={value} onChange={setValue} />;
}

describe("IconGridPicker", () => {
	it("renders tiles in a single horizontal scroll row in the supplied usage order", () => {
		const { container } = render(
			<IconGridPicker
				label="Category"
				items={[item("most", "Most used"), item("next", "Next used"), item("least", "Least used")]}
				value={undefined}
				onChange={vi.fn()}
			/>
		);

		const scroller = container.querySelector("[data-slot='icon-grid-picker-scroll']");
		const group = screen.getByRole("radiogroup", { name: "Category" });
		const radios = within(group).getAllByRole("radio");

		expect(scroller).toBeInstanceOf(HTMLElement);
		expect(scroller).toHaveAttribute("data-orientation", "horizontal");
		expect(scroller).toHaveClass("no-scrollbar", "overflow-x-auto", "overflow-y-hidden");
		expect(scroller).not.toHaveClass("max-h-72", "sm:max-h-80", "overflow-y-auto");
		expect(group).toHaveClass("flex", "flex-nowrap");
		expect(group).not.toHaveClass("grid");
		expect(radios.map((radio) => radio.getAttribute("title"))).toEqual([
			"Most used",
			"Next used",
			"Least used",
		]);
	});

	it("calls onChange when a tile is selected", () => {
		const onChange = vi.fn();

		render(
			<IconGridPicker
				label="Account"
				items={[item("cash", "Cash"), item("bank", "Bank")]}
				value="cash"
				onChange={onChange}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: "Bank" }));

		expect(onChange).toHaveBeenCalledWith("bank");
	});

	it("exposes the selected tile with radio selected state", () => {
		render(
			<IconGridPicker
				label="Account"
				items={[item("cash", "Cash"), item("bank", "Bank")]}
				value="bank"
				onChange={vi.fn()}
			/>
		);

		expect(screen.getByRole("radio", { name: "Bank" })).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("radio", { name: "Cash" })).toHaveAttribute("aria-checked", "false");
	});

	it("scrolls the selected tile into view without scrolling the page", () => {
		const scrollIntoView = vi.fn();
		Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		const { container, rerender } = render(
			<IconGridPicker
				label="Account"
				items={[item("cash", "Cash"), item("bank", "Bank"), item("card", "Card")]}
				value="cash"
				onChange={vi.fn()}
			/>
		);
		const scroller = container.querySelector("[data-slot='icon-grid-picker-scroll']");
		if (!scroller) throw new Error("Expected icon picker scroller");
		Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 100 });
		Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 500 });

		scrollIntoView.mockClear();
		rerender(
			<IconGridPicker
				label="Account"
				items={[item("cash", "Cash"), item("bank", "Bank"), item("card", "Card")]}
				value="card"
				onChange={vi.fn()}
			/>
		);

		expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
	});

	it("moves selection with arrow, home, and end keys", () => {
		render(
			<ControlledIconGridPicker
				initialValue="next"
				items={[item("most", "Most used"), item("next", "Next used"), item("least", "Least used")]}
			/>
		);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Next used" }), {
			key: "ArrowRight",
		});
		expect(screen.getByRole("radio", { name: "Least used" })).toHaveAttribute(
			"aria-checked",
			"true"
		);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Least used" }), {
			key: "ArrowLeft",
		});
		expect(screen.getByRole("radio", { name: "Next used" })).toHaveAttribute(
			"aria-checked",
			"true"
		);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Next used" }), { key: "Home" });
		expect(screen.getByRole("radio", { name: "Most used" })).toHaveAttribute(
			"aria-checked",
			"true"
		);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Most used" }), { key: "End" });
		expect(screen.getByRole("radio", { name: "Least used" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
	});

	it("shows search for larger lists and filters visible tiles", () => {
		const items = Array.from({ length: 13 }, (_, index) =>
			item(`item-${index}`, index === 8 ? "Fuel" : `Category ${index}`)
		);

		render(<IconGridPicker label="Category" items={items} value={undefined} onChange={vi.fn()} />);

		fireEvent.change(screen.getByRole("searchbox", { name: "Search Category" }), {
			target: { value: "fuel" },
		});

		expect(screen.getByRole("radio", { name: "Fuel" })).toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: "Category 1" })).not.toBeInTheDocument();
	});
});
