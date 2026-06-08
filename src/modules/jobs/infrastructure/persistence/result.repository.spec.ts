import { rowToResult } from "./result.repository";

const baseRow = {
	confidence: null,
	contentType: null,
	createdAt: new Date(),
	exclusionCode: null,
	exclusionDetail: null,
	id: "11111111-1111-1111-1111-111111111111",
	jobId: "22222222-2222-2222-2222-222222222222",
	normalizedUrl: "x/y",
	publishedDate: null,
	score: null,
	sentiment: null,
	snippet: null,
	sourceDomain: "x",
	status: "included",
	title: "T",
	url: "https://x/y",
	verificationStatus: "uncertain",
};

describe("rowToResult verification mapping", () => {
	it("maps verification_status onto the domain", () => {
		expect(rowToResult(baseRow).verificationStatus).toBe("uncertain");
	});
	it("maps null verification_status to null", () => {
		expect(
			rowToResult({ ...baseRow, verificationStatus: null }).verificationStatus,
		).toBeNull();
	});
});
