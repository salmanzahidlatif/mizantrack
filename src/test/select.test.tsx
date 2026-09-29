import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

function LongSelect() {
	const [value, setValue] = useState("");
	const options = Array.from({ length: 40 }, (_, index) => ({
		id: `category-${index + 1}`,
		label: `Category ${index + 1}`,
	}));

	return (
		<div>
			<Select value={value} onValueChange={setValue}>
				<SelectTrigger aria-label="Category">
					<SelectValue placeholder="Select category" />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.id} value={option.id}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<div data-testid="selected-value">{value}</div>
		</div>
	);
}

beforeAll(() => {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: () => {},
	});
});

afterEach(() => {
	cleanup();
});

describe("Select", () => {
	it("renders the last option in a long list and allows selecting it", async () => {
		render(<LongSelect />);

		fireEvent.click(screen.getByRole("combobox", { name: "Category" }));

		const lastOption = await screen.findByRole("option", { name: "Category 40" });
		expect(lastOption).toBeInTheDocument();

		fireEvent.click(lastOption);

		await waitFor(() => {
			expect(screen.getByTestId("selected-value")).toHaveTextContent("category-40");
		});
	});
});
