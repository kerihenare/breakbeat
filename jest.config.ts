import type { Config } from "jest";

const config: Config = {
	collectCoverageFrom: ["**/*.ts"],
	coverageDirectory: "../coverage",
	moduleFileExtensions: ["js", "json", "ts"],
	rootDir: "src",
	setupFiles: ["reflect-metadata"],
	testEnvironment: "node",
	testRegex: ".*\\.spec\\.ts$",
	transform: {
		"^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
	},
};

export default config;
