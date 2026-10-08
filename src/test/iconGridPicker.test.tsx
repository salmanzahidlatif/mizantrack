import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function item(id: string, title: string): IconGridPickerItem {
	return { icon: "🏷️", id, title };
}

describe("IconGridPicker", () => {
	it("renders tiles in the supplied usage order", () => {
		render(
			<IconGridPicker
				label="Category"
				items={[item("most", "Most used"), item("next", "Next used"), item("least", "Least used")]}
				value={undefined}
				onChange={vi.fn()}
			/>
		);

		const radios = within(screen.getByRole("radiogroup", { name: "Category" })).getAllByRole(
			"radio"
		);

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
