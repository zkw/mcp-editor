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

export function matchAnchorTemplate(source: string, template: string): string {
	const [prefix, suffix] = validateSinglePlaceholder(template);
	ensureUniqueAnchorMatch(source, prefix, suffix, "template");
	return `${prefix}${PLACEHOLDER}${suffix}`;
}

const MAX_TOKEN_THRESHOLD = 8000;
const ESTIMATED_CHARS_PER_TOKEN = 4;

interface BracketNode {
    openIndex: number;
    closeIndex: number;
    openChar: string;
    closeChar: string;
    length: number;
    parentSameTypeIndex?: number;
    sameTypeChildren: number;
    folded: boolean;
}

interface FoldCandidate {
    kind: "bracket" | "raw";
    start: number;
    end: number;
    length: number;
    openIndex: number;
    node?: BracketNode;
    parentSameTypeIndex?: number;
    sameTypeChildren?: number;
    folded: boolean;
}

function estimateTokenCount(text: string): number {
    return Math.max(1, Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN));
}

function sortCandidates(a: FoldCandidate, b: FoldCandidate): number {
    if (a.length !== b.length) {
            return b.length - a.length;
    }
    return b.openIndex - a.openIndex;
}

function parseBracketNodes(source: string): BracketNode[] {
    const openToClose: Record<string, string> = {
            "(": ")",
            "{": "}",
            "[": "]",
    };
    const closeToOpen: Record<string, string> = {
            ")": "(",
            "}": "{",
            "]": "[",
    };

    const stack: Array<{ char: string; index: number }> = [];
    const typeStacks: Record<string, Array<number>> = {
            "(": [],
            "{": [],
            "[": [],
    };
    const nodes: BracketNode[] = [];

    for (let index = 0; index < source.length; index++) {
            const char = source[index];
            if (openToClose[char]) {
                    stack.push({ char, index });
                    typeStacks[char].push(nodes.length);
                    continue;
            }

            const expectedOpen = closeToOpen[char];
            if (expectedOpen) {
                    const lastOpen = stack[stack.length - 1];
                    if (lastOpen && lastOpen.char === expectedOpen) {
                            stack.pop();
                            const openTypeStack = typeStacks[expectedOpen];
                            const nodeIndex = openTypeStack.pop();
                            if (nodeIndex === undefined) {
                                    continue;
                            }
                            const parentSameTypeIndex = openTypeStack[openTypeStack.length - 1];
                            const node: BracketNode = {
                                    openIndex: lastOpen.index,
                                    closeIndex: index,
                                    openChar: expectedOpen,
                                    closeChar: char,
                                    length: index - lastOpen.index + 1,
                                    parentSameTypeIndex,
                                    sameTypeChildren: 0,
                                    folded: false,
                            };
                            nodes[nodeIndex] = node;
                    }
            }
    }

    for (const node of nodes) {
            if (node.parentSameTypeIndex !== undefined) {
                    nodes[node.parentSameTypeIndex].sameTypeChildren += 1;
            }
    }

    return nodes;
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
            if (merged.length === 0) {
                    merged.push({ start: range.start, end: range.end });
                    continue;
            }
            const last = merged[merged.length - 1];
            if (range.start <= last.end) {
                    last.end = Math.max(last.end, range.end);
            } else {
                    merged.push({ start: range.start, end: range.end });
            }
    }
    return merged;
}

function buildFoldedSource(source: string, ranges: Array<{ start: number; end: number }>): string {
    const merged = mergeRanges(ranges);
    let result = "";
    let cursor = 0;
    for (const range of merged) {
            if (cursor < range.start) {
                    result += source.slice(cursor, range.start);
            }
            result += PLACEHOLDER;
            cursor = range.end;
    }
    if (cursor < source.length) {
            result += source.slice(cursor);
    }
    return result;
}

function buildRawCandidates(source: string, bracketNodes: BracketNode[]): FoldCandidate[] {
    const bracketRanges = bracketNodes
            .map((node) => ({ start: node.openIndex, end: node.closeIndex + 1 }))
            .sort((a, b) => a.start - b.start || a.end - b.end);
    const mergedBracketRanges = mergeRanges(bracketRanges);
    const rawCandidates: FoldCandidate[] = [];
    let cursor = 0;

    function addChunks(rangeStart: number, rangeEnd: number) {
            const spanLength = rangeEnd - rangeStart;
            if (spanLength <= 0) {
                    return;
            }
            const chunkSize = Math.max(1, Math.ceil(Math.sqrt(spanLength)));
            for (let chunkStart = rangeStart; chunkStart < rangeEnd; chunkStart += chunkSize) {
                    const chunkEnd = Math.min(rangeEnd, chunkStart + chunkSize);
                    rawCandidates.push({
                            kind: "raw",
                            start: chunkStart,
                            end: chunkEnd,
                            length: chunkEnd - chunkStart,
                            openIndex: chunkStart,
                            folded: false,
                    });
            }
    }

    for (const bracketRange of mergedBracketRanges) {
            if (cursor < bracketRange.start) {
                    addChunks(cursor, bracketRange.start);
            }
            cursor = Math.max(cursor, bracketRange.end);
    }

    if (cursor < source.length) {
            addChunks(cursor, source.length);
    }

    return rawCandidates;
}

function rangesEqual(a: Array<{ start: number; end: number }>, b: Array<{ start: number; end: number }>): boolean {
    if (a.length !== b.length) {
            return false;
    }
    for (let index = 0; index < a.length; index++) {
            if (a[index].start !== b[index].start || a[index].end !== b[index].end) {
                    return false;
            }
    }
    return true;
}

function createBracketCandidate(node: BracketNode): FoldCandidate {
    return {
            kind: "bracket",
            start: node.openIndex + 1,
            end: node.closeIndex,
            length: node.length,
            openIndex: node.openIndex,
            node,
            parentSameTypeIndex: node.parentSameTypeIndex,
            sameTypeChildren: node.sameTypeChildren,
            folded: false,
    };
}

export function foldSource(source: string): string {
    if (estimateTokenCount(source) <= MAX_TOKEN_THRESHOLD) {
            return source;
    }

    const nodes = parseBracketNodes(source);
    const candidateQueue: FoldCandidate[] = [];
    const bracketCandidates = nodes.filter((node) => node.sameTypeChildren === 0).map(createBracketCandidate);
    const rawCandidates = buildRawCandidates(source, nodes);
    candidateQueue.push(...bracketCandidates, ...rawCandidates);
    candidateQueue.sort(sortCandidates);

    let foldedSource = source;
    let selectedRanges: Array<{ start: number; end: number }> = [];

    function addCandidate(candidate: FoldCandidate) {
            const existing = candidateQueue.findIndex(
                    (item) => item.kind === candidate.kind && item.openIndex === candidate.openIndex && item.end === candidate.end,
            );
            if (existing !== -1) {
                    return;
            }
            const insertAt = candidateQueue.findIndex((item) => sortCandidates(candidate, item) < 0);
            if (insertAt === -1) {
                    candidateQueue.push(candidate);
            } else {
                    candidateQueue.splice(insertAt, 0, candidate);
            }
    }

    while (candidateQueue.length > 0 && estimateTokenCount(foldedSource) > MAX_TOKEN_THRESHOLD) {
            const candidate = candidateQueue.shift();
            if (!candidate || candidate.folded) {
                    continue;
            }
            candidate.folded = true;

            const candidateRange =
                    candidate.kind === "bracket"
                            ? { start: candidate.node!.openIndex + 1, end: candidate.node!.closeIndex }
                            : { start: candidate.start, end: candidate.end };

            if (candidateRange.start >= candidateRange.end) {
                    if (candidate.kind === "bracket" && candidate.parentSameTypeIndex !== undefined) {
                            nodes[candidate.parentSameTypeIndex].sameTypeChildren -= 1;
                            if (nodes[candidate.parentSameTypeIndex].sameTypeChildren === 0) {
                                    addCandidate(createBracketCandidate(nodes[candidate.parentSameTypeIndex]));
                            }
                    }
                    continue;
            }

            const mergedRanges = mergeRanges([...selectedRanges, candidateRange]);
            if (rangesEqual(mergedRanges, selectedRanges)) {
                    if (candidate.kind === "bracket" && candidate.parentSameTypeIndex !== undefined) {
                            nodes[candidate.parentSameTypeIndex].sameTypeChildren -= 1;
                            if (nodes[candidate.parentSameTypeIndex].sameTypeChildren === 0) {
                                    addCandidate(createBracketCandidate(nodes[candidate.parentSameTypeIndex]));
                            }
                    }
                    continue;
            }

            selectedRanges = mergedRanges;
            foldedSource = buildFoldedSource(source, selectedRanges);

            if (candidate.kind === "bracket" && candidate.parentSameTypeIndex !== undefined) {
                    nodes[candidate.parentSameTypeIndex].sameTypeChildren -= 1;
                    if (nodes[candidate.parentSameTypeIndex].sameTypeChildren === 0) {
                            addCandidate(createBracketCandidate(nodes[candidate.parentSameTypeIndex]));
                    }
            }
    }

    return foldedSource;
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
