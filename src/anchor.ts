const PLACEHOLDER = "......";
const MAX_ANCHOR_SAMPLES = 5;

export class AnchorRewriteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AnchorRewriteError";
	}
}

export function buildLineOffsets(text: string): number[] {
	const offsets: number[] = [0];
	for (let idx = 0; idx < text.length; idx++) {
		if (text[idx] === "\n" && idx + 1 < text.length) {
			offsets.push(idx + 1);
		}
	}
	return offsets;
}

export function getLineNumber(lineOffsets: number[], index: number): number {
	let low = 0;
	let high = lineOffsets.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lineOffsets[mid] <= index) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return Math.max(1, high + 1);
}

export function getLineText(text: string, lineOffsets: number[], lineNumber: number): string {
	const start = lineOffsets[lineNumber - 1];
	const end = lineNumber < lineOffsets.length ? lineOffsets[lineNumber] : text.length;
	let line = text.slice(start, end);
	if (line.endsWith("\n")) {
		line = line.slice(0, -1);
	}
	if (line.endsWith("\r")) {
		line = line.slice(0, -1);
	}
	return line;
}

export function containsAnchorPlaceholder(text: string): boolean {
	return text.includes(PLACEHOLDER);
}

export function findAllOccurrences(text: string, pattern: string): number[] {
	const positions: number[] = [];
	if (pattern.length === 0) {
		return positions;
	}
	let index = 0;
	while (true) {
		const found = text.indexOf(pattern, index);
		if (found === -1) break;
		positions.push(found);
		index = found + 1;
	}
	return positions;
}

function findFirstAtOrAfter(sorted: number[], target: number): number | undefined {
	let low = 0;
	let high = sorted.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (sorted[mid] < target) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return low < sorted.length ? sorted[low] : undefined;
}

function validateSinglePlaceholder(template: string): [string, string] {
	const segments = template.split(PLACEHOLDER);
	if (segments.length !== 2) {
		throw new AnchorRewriteError(
			`Template must contain exactly one anchor placeholder '${PLACEHOLDER}'.`,
		);
	}

	const [prefix, suffix] = segments;
	requireNonEmptyAnchor(prefix, suffix);
	return [prefix, suffix];
}

function buildCandidates(prefixPositions: number[], suffixPositions: number[], prefixLength: number) {
	const candidates: Array<{ prefixStart: number; suffixStart: number }> = [];
	for (const prefixStart of prefixPositions) {
		const prefixEnd = prefixStart + prefixLength;
		const suffixStart = findFirstAtOrAfter(suffixPositions, prefixEnd);
		if (suffixStart !== undefined) {
			candidates.push({ prefixStart, suffixStart });
		}
	}
	return candidates;
}

function buildAnchorError(
	prefix: string,
	suffix: string,
	source: string,
	prefixPositions: number[],
	suffixPositions: number[],
	candidatesLength: number,
	contextLabel: string,
): AnchorRewriteError {
	const lineOffsets = buildLineOffsets(source);
	const prefixInfo = describeMatches(prefix, source, lineOffsets, prefixPositions);
	const suffixInfo = describeMatches(suffix, source, lineOffsets, suffixPositions);
	const problem = candidatesLength === 0 ? "cannot be resolved" : "is not unique";
	return new AnchorRewriteError(
		`[System Error] Pattern ambiguity detected.\n` +
		`The prefix "${prefix}" and suffix "${suffix}" combination ${problem}.\n\n` +
		`${prefixInfo}\n\n${suffixInfo}\n\n` +
		`Action Required: Please provide longer, more specific context for the ${contextLabel} ` +
		`so the pattern matches exactly ONE block in the file.`,
	);
}

function ensureUniqueAnchorMatch(
	source: string,
	prefix: string,
	suffix: string,
	contextLabel: string,
): { prefixStart: number; suffixStart: number } {
	const prefixPositions = findAllOccurrences(source, prefix);
	const suffixPositions = findAllOccurrences(source, suffix);

	if (prefixPositions.length === 0) {
		throw new AnchorRewriteError(
			`[System Error] Pattern ambiguity detected.\n` +
			`The prefix "${prefix}" does not exist in the source file. ` +
			`Please use exact source text for the ${contextLabel}.`,
		);
	}
	if (suffixPositions.length === 0) {
		throw new AnchorRewriteError(
			`[System Error] Pattern ambiguity detected.\n` +
			`The suffix "${suffix}" does not exist in the source file. ` +
			`Please use exact source text for the ${contextLabel}.`,
		);
	}

	const candidates = buildCandidates(prefixPositions, suffixPositions, prefix.length);
	if (candidates.length !== 1) {
		throw buildAnchorError(prefix, suffix, source, prefixPositions, suffixPositions, candidates.length, contextLabel);
	}
	return candidates[0];
}

function describeMatches(label: string, source: string, lineOffsets: number[], positions: number[]): string {
	if (positions.length === 0) {
		return `Found "${label}" at no locations.`;
	}
	const count = Math.min(MAX_ANCHOR_SAMPLES, positions.length);
	const lines = positions.slice(0, count).map((pos) => {
		const lineNumber = getLineNumber(lineOffsets, pos);
		const excerpt = getLineText(source, lineOffsets, lineNumber);
		return `- Line ${lineNumber}: '${excerpt}'`;
	});
	const more = positions.length > count ? `\n- ...and ${positions.length - count} more occurrences` : "";
	return [`Found "${label}" at the following lines:`, ...lines, more].filter(Boolean).join("\n");
}

function requireNonEmptyAnchor(prefix: string, suffix: string): void {
	if (prefix.length === 0 || suffix.length === 0) {
		throw new AnchorRewriteError(
			`Anchor placeholder must be framed by non-empty prefix and suffix. ` +
			`Each "......" must be surrounded by exact source anchors on both sides.`,
		);
	}
}

export function rewriteWithAnchors(source: string, anchorText: string): string {
	if (!containsAnchorPlaceholder(anchorText)) {
		return anchorText;
	}

	const segments = anchorText.split(PLACEHOLDER);
	if (segments.length < 2) {
		throw new AnchorRewriteError("Malformed anchor content: expected at least one anchor placeholder.");
	}

	const replacements: string[] = [];
	for (let index = 0; index < segments.length - 1; index++) {
		const prefix = segments[index];
		const suffix = segments[index + 1];
		requireNonEmptyAnchor(prefix, suffix);

		const { prefixStart, suffixStart } = ensureUniqueAnchorMatch(source, prefix, suffix, "anchor");
		replacements.push(source.slice(prefixStart + prefix.length, suffixStart));
	}

	let result = "";
	for (let index = 0; index < replacements.length; index++) {
		result += segments[index];
		result += replacements[index];
	}
	result += segments[segments.length - 1];
	return result;
}
