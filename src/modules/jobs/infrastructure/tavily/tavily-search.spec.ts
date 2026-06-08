import type { AppConfigService } from "../../../../shared/config/app-config.service";
import type { SearchQuery } from "../../domain/services/search-queries";

const mockSearch = jest.fn();
jest.mock("@tavily/core", () => ({
	tavily: () => ({ search: mockSearch }),
}));

// Imported after the mock is registered so the adapter binds to the stub.
import { TavilySearch } from "./tavily-search";

function configStub(
	values: Record<string, string | undefined>,
): AppConfigService {
	return {
		get: (key: string) => values[key],
		isProduction: false,
	} as unknown as AppConfigService;
}

const query: SearchQuery = {
	options: {
		excludeDomains: [],
		maxResults: 20,
		searchDepth: "advanced",
		topic: "general",
	},
	query: "Acme news",
};

describe("TavilySearch", () => {
	afterEach(() => mockSearch.mockReset());

	it("carries Tavily's relevance score onto each SearchHit", async () => {
		mockSearch.mockResolvedValue({
			results: [
				{
					content: "snippet",
					score: 0.66,
					title: "About Acme",
					url: "https://news.example.com/acme",
				},
			],
		});
		const provider = new TavilySearch(configStub({ TAVILY_API_KEY: "k" }));
		const [hit] = await provider.search(query);
		expect(hit.score).toBe(0.66);
	});

	it("maps a missing score to null", async () => {
		mockSearch.mockResolvedValue({
			results: [{ title: "About Acme", url: "https://news.example.com/acme" }],
		});
		const provider = new TavilySearch(configStub({ TAVILY_API_KEY: "k" }));
		const [hit] = await provider.search(query);
		expect(hit.score).toBeNull();
	});
});
