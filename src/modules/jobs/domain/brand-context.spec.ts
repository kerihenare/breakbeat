import { brandContextToText } from "./brand-context";

describe("brandContextToText", () => {
	it("renders description + industry + aliases as prompt-ready lines", () => {
		const text = brandContextToText({
			aliases: ["Acme Inc", "Acme Corp"],
			description: "A developer tools company.",
			industry: "Software",
		});
		expect(text).toContain("A developer tools company.");
		expect(text).toContain("Software");
		expect(text).toContain("Acme Inc");
	});
	it("omits empty fields cleanly", () => {
		const text = brandContextToText({
			aliases: [],
			description: "Just a description.",
			industry: null,
		});
		expect(text).toBe("Just a description.");
	});
});
