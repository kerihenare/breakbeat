import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
	it("resolves with the promise value when it settles in time", async () => {
		await expect(withTimeout(Promise.resolve(42), 1000, "x")).resolves.toBe(42);
	});

	it("rejects with a labelled error when the promise is too slow", async () => {
		const slow = new Promise<number>((resolve) => setTimeout(resolve, 50, 1));
		await expect(withTimeout(slow, 5, "redis ping")).rejects.toThrow(
			/redis ping timed out after 5ms/,
		);
	});
});
