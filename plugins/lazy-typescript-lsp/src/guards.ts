export type Fields = Record<string, unknown>;

export function isFields(value: unknown): value is Fields {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRequestId(value: unknown): value is number | string {
	return typeof value === "number" || typeof value === "string";
}

export function isInteger(value: unknown): value is number {
	return Number.isInteger(value);
}

export function isNaturalNumber(value: unknown): value is number {
	return isInteger(value) && value >= 0;
}
