import { EXCLUSION_CODES } from "./exclusion";

describe("exclusion codes", () => {
	it("includes off_topic (entity-mismatch) in the closed set", () => {
		expect(EXCLUSION_CODES).toContain("off_topic");
	});
});
