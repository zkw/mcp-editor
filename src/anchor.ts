const PLACEHOLDER = "......";
const MIN_ANCHOR_LENGTH = 80;

export class AnchorRewriteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AnchorRewriteError";
	}
}

export function containsAnchorPlaceholder(text: string): boolean {
	return text.includes(PLACEHOLDER);
}

function buildLPS(pattern: string): Int32Array {
	const m = pattern.length;
	const lps = new Int32Array(m);
	let len = 0;
	for (let i = 1; i < m; i++) {
		while (len > 0 && pattern[i] !== pattern[len]) {
			len = lps[len - 1];
		}
		if (pattern[i] === pattern[len]) {
			len++;
		}
		lps[i] = len;
	}
	return lps;
}

function findLongestPrefixMatch(pattern: string, text: string): { length: number; positions: number[] } {
	if (pattern.length === 0 || text.length === 0) {
		return { length: 0, positions: [] };
	}

	const m = pattern.length;
	const lps = buildLPS(pattern);
	let maxLen = 0;
	let positions: number[] = [];
	let j = 0;

	for (let i = 0; i < text.length; i++) {
		while (j > 0 && text[i] !== pattern[j]) {
			j = lps[j - 1];
		}
		if (text[i] === pattern[j]) {
			j++;
		}

		if (j > maxLen) {
			maxLen = j;
			positions = [i - j + 1];
		} else if (j === maxLen && j > 0) {
			positions.push(i - j + 1);
		}

		if (j === m) {
			j = lps[j - 1];
		}
	}

	return { length: maxLen, positions };
}

function reverseString(str: string): string {
	let res = "";
	for (let i = str.length - 1; i >= 0; i--) {
		res += str[i];
	}
	return res;
}

function ensureUniqueAnchorMatch(
	source: string,
	sourceRev: string,
	prefixSeg: string,
	suffixSeg: string,
	contextLabel: string,
): { prefixEnd: number; suffixStart: number } {
	// 1. Find longest matching suffix of prefixSeg
	const prefixSegRev = reverseString(prefixSeg);
	const pm = findLongestPrefixMatch(prefixSegRev, sourceRev);
	
	if (pm.length < MIN_ANCHOR_LENGTH) {
		throw new AnchorRewriteError(
			`[System Error] Prefix anchor for ${contextLabel} is too short (${pm.length} characters matched, minimum ${MIN_ANCHOR_LENGTH} required).\n` +
			`The longest matching part was: "${prefixSeg.slice(-pm.length)}"\n` +
			`Action Required: Please provide a longer, exact code prefix before the "${PLACEHOLDER}" placeholder.`
		);
	}
	if (pm.positions.length > 1) {
		throw new AnchorRewriteError(
			`[System Error] Prefix anchor for ${contextLabel} is not unique (${pm.positions.length} occurrences found).\n` +
			`The longest matching part was: "${prefixSeg.slice(-pm.length)}"\n` +
			`Action Required: Please provide more specific context surrounding this code block.`
		);
	}

	// Calculate absolute end position of prefix anchor in source
	const prefixAnchorStart = source.length - pm.positions[0] - pm.length;
	const prefixAnchorEnd = prefixAnchorStart + pm.length;

	// 2. Find longest matching prefix of suffixSeg
	const sm = findLongestPrefixMatch(suffixSeg, source);

	if (sm.length < MIN_ANCHOR_LENGTH) {
		throw new AnchorRewriteError(
			`[System Error] Suffix anchor for ${contextLabel} is too short (${sm.length} characters matched, minimum ${MIN_ANCHOR_LENGTH} required).\n` +
			`The longest matching part was: "${suffixSeg.slice(0, sm.length)}"\n` +
			`Action Required: Please provide a longer, exact code suffix after the "${PLACEHOLDER}" placeholder.`
		);
	}
	if (sm.positions.length > 1) {
		throw new AnchorRewriteError(
			`[System Error] Suffix anchor for ${contextLabel} is not unique (${sm.positions.length} occurrences found).\n` +
			`The longest matching part was: "${suffixSeg.slice(0, sm.length)}"\n` +
			`Action Required: Please provide more specific context surrounding this code block.`
		);
	}

	const suffixAnchorStart = sm.positions[0];

	if (suffixAnchorStart < prefixAnchorEnd) {
		throw new AnchorRewriteError(
			`[System Error] Anchor order violation for ${contextLabel}.\n` +
			`The suffix anchor occurs before the prefix anchor in the source file.\n` +
			`Prefix End: ${prefixAnchorEnd}, Suffix Start: ${suffixAnchorStart}`
		);
	}

	return { prefixEnd: prefixAnchorEnd, suffixStart: suffixAnchorStart };
}

export function rewriteWithAnchors(source: string, anchorText: string): string {
	if (!containsAnchorPlaceholder(anchorText)) {
		return anchorText;
	}

	const segments = anchorText.split(PLACEHOLDER);
	if (segments.length < 2) {
		throw new AnchorRewriteError("Malformed anchor content: expected at least one anchor placeholder.");
	}

	const sourceRev = reverseString(source);
	const replacements: string[] = [];
	for (let index = 0; index < segments.length - 1; index++) {
		const prefix = segments[index];
		const suffix = segments[index + 1];

		const { prefixEnd, suffixStart } = ensureUniqueAnchorMatch(source, sourceRev, prefix, suffix, `anchor #${index + 1}`);
		replacements.push(source.slice(prefixEnd, suffixStart));
	}

	let result = "";
	for (let index = 0; index < replacements.length; index++) {
		result += segments[index];
		result += replacements[index];
	}
	result += segments[segments.length - 1];
	return result;
}
