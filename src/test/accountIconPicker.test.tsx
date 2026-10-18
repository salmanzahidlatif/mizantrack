import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountIconPicker } from "@/components/accounts/AccountIconPicker";
import { AccountIcon } from "@/components/icons/AccountIcon";
import {
	ACCOUNT_ICON_OPTIONS,
	ACCOUNT_ICON_REGISTRY,
} from "@/components/icons/accountIconRegistry";
import { ACCOUNT_ICON_KEYS } from "@/lib/accountIcons";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function ControlledPicker({
	initialValue,
	onChange,
}: {
	initialValue?: string;
	onChange: (value: string | undefined) => void;
}) {
	const [value, setValue] = useState<string | undefined>(initialValue);

	return (
		<AccountIconPicker
			value={value}
			automaticIcon="generic.cash"
			onChange={(next) => {
				setValue(next);
				onChange(next);
			}}
		/>
	);
}

function openPicker() {
	fireEvent.click(screen.getByRole("button", { name: /^Account icon:/ }));
}

describe("account icon registry", () => {
	it("draws every icon key with a label, a group and a colour", () => {
		for (const key of ACCOUNT_ICON_KEYS) {
			const definition = ACCOUNT_ICON_REGISTRY[key];
			expect(definition, key).toBeDefined();
			expect(definition.label.length, key).toBeGreaterThan(0);
			expect(definition.color.length, key).toBeGreaterThan(0);
			expect(definition.Icon, key).toBeTruthy();
		}

		expect(ACCOUNT_ICON_OPTIONS.map((option) => option.key).sort()).toEqual(
			[...ACCOUNT_ICON_KEYS].sort()
		);
	});

	it("renders brand marks as inline svg rather than an image request", () => {
		const { container } = render(<AccountIcon icon="bank.meezan" className="h-6 w-6" />);
		const svg = container.querySelector("svg");

		expect(svg).toBeInstanceOf(SVGElement);
		expect(svg).toHaveClass("h-6", "w-6");
		expect(svg?.querySelector("text")?.textContent).toBe("MZN");
		expect(container.querySelector("img")).toBeNull();
	});

	it("renders a legacy emoji stored on an account without crashing", () => {
		render(<AccountIcon account={{ currency: "PKR", icon: "💎", title: "Cash" }} />);

		expect(screen.getByText("💎")).toBeInTheDocument();
	});

	it("infers the icon when an account has no explicit value", () => {
		const { container } = render(
			<AccountIcon account={{ currency: "PKR", title: "Meezan - Current" }} />
		);

		expect(container.querySelector("text")?.textContent).toBe("MZN");
	});
});

describe("AccountIconPicker", () => {
	it("opens a searchable, grouped icon list", () => {
		render(<ControlledPicker onChange={vi.fn()} />);
		openPicker();

		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Banks" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Wallets" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Generic" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Meezan Bank" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "MCB Bank" })).toBeInTheDocument();
	});

	it("filters the list by name and keyword", () => {
		render(<ControlledPicker onChange={vi.fn()} />);
		openPicker();

		fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "mcb" } });
		expect(screen.getByRole("button", { name: "MCB Bank" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Meezan Bank" })).not.toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Search icons"), {
			target: { value: "standard chartered" },
		});
		expect(screen.getByRole("button", { name: "Standard Chartered" })).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "zzzz" } });
		expect(screen.getByText("No icons found.")).toBeInTheDocument();
	});

	it("stores the chosen icon key", () => {
		const onChange = vi.fn();
		render(<ControlledPicker onChange={onChange} />);
		openPicker();

		fireEvent.click(screen.getByRole("button", { name: "Meezan Bank" }));

		expect(onChange).toHaveBeenCalledWith("bank.meezan");
		expect(screen.getByRole("button", { name: "Account icon: Meezan Bank" })).toBeInTheDocument();
	});

	it("clears the explicit icon when Automatic is chosen", () => {
		const onChange = vi.fn();
		render(<ControlledPicker initialValue="bank.meezan" onChange={onChange} />);
		openPicker();

		fireEvent.click(screen.getByRole("button", { name: /Automatic/ }));

		expect(onChange).toHaveBeenCalledWith(undefined);
		expect(
			screen.getByRole("button", { name: "Account icon: Automatic (Cash)" })
		).toBeInTheDocument();
	});

	it("keeps a legacy emoji selection visible until it is changed", () => {
		render(<ControlledPicker initialValue="💎" onChange={vi.fn()} />);

		expect(screen.getByRole("button", { name: "Account icon: Custom icon" })).toBeInTheDocument();
		expect(screen.getByText("💎")).toBeInTheDocument();
	});
});
