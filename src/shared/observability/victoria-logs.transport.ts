import build from "pino-abstract-transport";

type Json = Record<string, unknown>;

/**
 * POST a batch of log lines to VictoriaLogs' JSON-line ingestion endpoint.
 * Fail-open: a transport error is reported once but never rethrown, so log
 * shipping problems can never block a request or crash the service. stdout
 * remains the source of truth.
 */
export async function shipBatch(
	baseUrl: string,
	lines: Json[],
	fetchImpl: typeof fetch = fetch,
	onError: (err: unknown) => void = defaultWarn,
): Promise<void> {
	if (lines.length === 0) return;
	const body = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
	const url = `${baseUrl.replace(/\/$/, "")}/insert/jsonline?_stream_fields=service&_msg_field=msg&_time_field=time`;
	try {
		const res = await fetchImpl(url, {
			body,
			headers: { "content-type": "application/x-ndjson" },
			method: "POST",
		});
		if (!res.ok) onError(new Error(`VictoriaLogs responded ${res.status}`));
	} catch (err) {
		onError(err); // fail-open: never rethrow
	}
}

let warned = false;
function defaultWarn(err: unknown): void {
	if (warned) return; // throttle: one warning per process
	warned = true;
	process.stderr.write(
		`[victoria-logs] log shipping failing, continuing on stdout only: ${String(err)}\n`,
	);
}

// pino transport entrypoint: batches lines and flushes them to VictoriaLogs on
// a size threshold OR a time interval, so low-volume logs still arrive promptly
// (not only when 50 accumulate or the process exits).
export default async function (opts: {
	url: string;
	batchSize?: number;
	flushIntervalMs?: number;
}) {
	const batchSize = opts.batchSize ?? 50;
	const flushIntervalMs = opts.flushIntervalMs ?? 1000;
	let buffer: Json[] = [];

	const flush = async (): Promise<void> => {
		if (buffer.length === 0) return;
		const batch = buffer;
		buffer = [];
		await shipBatch(opts.url, batch);
	};

	const timer = setInterval(() => {
		void flush();
	}, flushIntervalMs);
	timer.unref();

	return build(
		async (source) => {
			for await (const obj of source) {
				buffer.push(obj as Json);
				if (buffer.length >= batchSize) await flush();
			}
		},
		{
			async close() {
				clearInterval(timer);
				await flush();
			},
		},
	);
}
