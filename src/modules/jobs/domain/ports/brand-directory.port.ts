import type { BrandContext } from "../brand-context";

export const BRAND_DIRECTORY = Symbol("BRAND_DIRECTORY");

export type BrandCandidate = {
	name: string;
	domain: string;
	iconUrl: string | null;
};

export type BrandProfile = {
	name: string;
	domain: string;
	handles: string[];
};

/**
 * A brand directory (BrandFetch): search disambiguates a name into candidate
 * brands; fetchProfile returns a brand's own domains + social handles;
 * fetchContext returns a compact BrandContext for entity verification.
 */
export interface BrandDirectory {
	search(query: string): Promise<BrandCandidate[]>;
	fetchProfile(domain: string): Promise<BrandProfile | null>;
	fetchContext(domain: string): Promise<BrandContext | null>;
	isConfigured(): boolean;
}
