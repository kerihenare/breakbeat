/**
 * Validate that an untrusted string is a member of a closed set before
 * narrowing to the union type — used at the persistence boundary so DB text
 * columns can't silently smuggle invalid values into the domain via `as`.
 */
export function parseEnum<T extends string>(
	value: string,
	allowed: readonly T[],
	label: string,
): T {
	if ((allowed as readonly string[]).includes(value)) return value as T;
	throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
}

export function parseEnumOrNull<T extends string>(
	value: string | null,
	allowed: readonly T[],
	label: string,
): T | null {
	return value === null ? null : parseEnum(value, allowed, label);
}
