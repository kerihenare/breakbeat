import { Result } from "./result";

function r(): Result {
	return new Result("id", "job", "https://x/y", "x/y", "T", "x", null);
}

describe("Result verification status", () => {
	it("is born null", () => {
		expect(r().verificationStatus).toBeNull();
	});
	it("records a verification status", () => {
		const result = r();
		result.setVerification("uncertain");
		expect(result.verificationStatus).toBe("uncertain");
	});
	it("hydrates from state", () => {
		const result = new Result(
			"id",
			"job",
			"https://x/y",
			"x/y",
			"T",
			"x",
			null,
			null,
			null,
			{ verificationStatus: "verified" },
		);
		expect(result.verificationStatus).toBe("verified");
	});
});
