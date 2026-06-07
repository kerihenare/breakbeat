import { shipBatch } from "./victoria-logs.transport";

describe("shipBatch (VictoriaLogs jsonline)", () => {
	it("POSTs newline-delimited JSON to the jsonline endpoint", async () => {
		const calls: { url: string; body: string }[] = [];
		const fakeFetch = (async (url: string, init: { body: string }) => {
			calls.push({ body: init.body, url });
			return { ok: true, status: 204 } as Response;
		}) as unknown as typeof fetch;
		await shipBatch(
			"http://vl:9428",
			[
				{ msg: "a", time: 1 },
				{ msg: "b", time: 2 },
			],
			fakeFetch,
		);
		expect(calls[0].url).toContain("/insert/jsonline");
		expect(calls[0].body.trim().split("\n")).toHaveLength(2);
	});

	it("does not throw when the endpoint errors (fail-open) and reports once", async () => {
		let warns = 0;
		const failing = (async () => {
			throw new Error("connrefused");
		}) as unknown as typeof fetch;
		await expect(
			shipBatch("http://vl:9428", [{ msg: "x", time: 1 }], failing, () => {
				warns++;
			}),
		).resolves.toBeUndefined();
		expect(warns).toBe(1);
	});
});
