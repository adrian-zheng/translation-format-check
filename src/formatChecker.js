const RULE_LABELS = {
  dash: "Em dash / en dash spacing",
  quote: "Full-width quote",
  ellipsis: "Ellipsis",
  space: "Extra space"
};

const QUOTE_MAP = new Map([
  ["“", "\""],
  ["”", "\""],
  ["„", "\""],
  ["＂", "\""],
  ["「", "\""],
  ["」", "\""],
  ["『", "\""],
  ["』", "\""],
  ["‘", "'"],
  ["’", "'"],
  ["‚", "'"],
  ["＇", "'"]
]);

export const demoSamples = [
  {
    title: "Product brochure paragraph",
    text: "“The Aurora desk”—designed for hybrid teams…  brings  focus to shared work."
  },
  {
    title: "Legal-style sentence",
    text: "The supplier–not the distributor—must confirm “final acceptance”… before shipment."
  },
  {
    title: "Marketing note",
    text: "Customers said ‘it feels premium’……  but the launch copy still  needs cleanup."
  },
  {
    title: "Training material",
    text: "Module 3—Quality Review explains how to flag “ambiguous terms”  and  revise them."
  }
];

function recordChange(changes, rule, before, after, index) {
  if (before === after) {
    return null;
  }

  const change = {
    id: changes.length + 1,
    rule,
    label: RULE_LABELS[rule],
    before,
    after,
    index
  };

  changes.push(change);
  return change;
}

function compactCorrectionSegments(segments) {
  const compacted = [];

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    const previous = compacted.at(-1);
    if (previous && previous.change === segment.change) {
      previous.text += segment.text;
    } else {
      compacted.push({ ...segment });
    }
  }

  return compacted;
}

function sliceCorrectionSegments(segments, start, end) {
  const sliced = [];
  let offset = 0;

  for (const segment of segments) {
    const segmentStart = offset;
    const segmentEnd = offset + segment.text.length;
    offset = segmentEnd;

    if (segmentEnd <= start || segmentStart >= end) {
      continue;
    }

    const localStart = Math.max(start - segmentStart, 0);
    const localEnd = Math.min(end - segmentStart, segment.text.length);
    sliced.push({
      text: segment.text.slice(localStart, localEnd),
      change: segment.change
    });
  }

  return sliced;
}

function replaceInState(state, pattern, rule, replacementFor) {
  const nextSegments = [];
  let cursor = 0;

  for (const match of state.text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = match[0];
    const replacement = replacementFor(match);
    const preservePrefixLength = replacement.preservePrefixLength ?? 0;
    const changedBefore = replacement.changedBefore ?? before.slice(preservePrefixLength);
    const changedAfter = replacement.changedAfter ?? replacement.after;
    const changeIndex = index + (replacement.changeIndexOffset ?? preservePrefixLength);

    nextSegments.push(...sliceCorrectionSegments(state.segments, cursor, index));
    nextSegments.push(
      ...sliceCorrectionSegments(state.segments, index, index + preservePrefixLength)
    );

    const change = recordChange(
      state.changes,
      rule,
      changedBefore,
      changedAfter,
      changeIndex
    );
    if (changedAfter) {
      nextSegments.push({ text: changedAfter, change });
    }

    cursor = index + before.length;
  }

  nextSegments.push(...sliceCorrectionSegments(state.segments, cursor, state.text.length));

  return {
    text: nextSegments.map((segment) => segment.text).join(""),
    segments: compactCorrectionSegments(nextSegments),
    changes: state.changes
  };
}

function replaceQuotes(state) {
  return replaceInState(state, /[“”„＂「」『』‘’‚＇]/g, "quote", (match) => {
    return {
      after: QUOTE_MAP.get(match[0])
    };
  });
}

function replaceEllipses(state) {
  return replaceInState(state, /…+/g, "ellipsis", () => {
    return {
      after: "..."
    };
  });
}

function replaceDashes(state) {
  return replaceInState(state, /[ \t\u00a0]*[—–][ \t\u00a0]*/g, "dash", () => {
    return {
      after: " – "
    };
  });
}

function replaceLeadingLineSpaces(state) {
  return replaceInState(state, /(^|\n)([ \t\u00a0]+)/g, "space", (match) => {
    return {
      after: match[1],
      changedBefore: match[2],
      changedAfter: "",
      preservePrefixLength: match[1].length,
      changeIndexOffset: match[1].length
    };
  });
}

function replaceTrailingLineSpaces(state) {
  return replaceInState(state, /[ \t\u00a0]+(?=\n|$)/g, "space", () => {
    return {
      after: "",
      changedAfter: ""
    };
  });
}

function replaceLineEdgeSpaces(state) {
  return replaceTrailingLineSpaces(replaceLeadingLineSpaces(state));
}

function replaceExtraSpaces(state) {
  return replaceInState(state, /[ \t\u00a0]{2,}/g, "space", () => {
    return {
      after: " "
    };
  });
}

function createInitialState(originalText) {
  return {
    text: originalText,
    segments: originalText ? [{ text: originalText, change: null }] : [],
    changes: []
  };
}

function stripNullChanges(segments) {
  return segments.map((segment) => {
    if (segment.change) {
      return segment;
    }

    return {
      text: segment.text,
      change: null
    };
  });
}

function assertCorrectionState(state) {
  const segmentText = state.segments.map((segment) => segment.text).join("");
  if (segmentText !== state.text) {
    throw new Error("Corrected segments do not match corrected text.");
  }
}

function runCorrections(originalText) {
  let state = createInitialState(originalText);

  state = replaceQuotes(state);
  state = replaceEllipses(state);
  state = replaceDashes(state);
  state = replaceLineEdgeSpaces(state);
  state = replaceExtraSpaces(state);

  assertCorrectionState(state);

  return {
    correctedText: state.text,
    changes: state.changes,
    correctedSegments: stripNullChanges(state.segments)
  };
}

function createIssueCounts() {
  return {
    dash: 0,
    quote: 0,
    ellipsis: 0,
    space: 0
  };
}

function pushSegment(segments, type, text) {
  if (!text) {
    return;
  }

  const previous = segments.at(-1);
  if (previous?.type === type) {
    previous.text += text;
    return;
  }

  segments.push({ type, text });
}

function createCoarseDiff(originalText, correctedText) {
  let prefixLength = 0;
  const shortestLength = Math.min(originalText.length, correctedText.length);

  while (
    prefixLength < shortestLength &&
    originalText[prefixLength] === correctedText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < shortestLength - prefixLength &&
    originalText[originalText.length - 1 - suffixLength] ===
      correctedText[correctedText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const segments = [];
  pushSegment(segments, "same", originalText.slice(0, prefixLength));
  pushSegment(
    segments,
    "removed",
    originalText.slice(prefixLength, originalText.length - suffixLength)
  );
  pushSegment(
    segments,
    "added",
    correctedText.slice(prefixLength, correctedText.length - suffixLength)
  );
  pushSegment(segments, "same", originalText.slice(originalText.length - suffixLength));
  return segments;
}

export function createDiffSegments(originalText, correctedText) {
  const original = String(originalText ?? "");
  const corrected = String(correctedText ?? "");

  if (original === corrected) {
    return original ? [{ type: "same", text: original }] : [];
  }

  if (original.length * corrected.length > 1500000) {
    return createCoarseDiff(original, corrected);
  }

  const rows = original.length + 1;
  const cols = corrected.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));

  for (let row = original.length - 1; row >= 0; row -= 1) {
    for (let col = corrected.length - 1; col >= 0; col -= 1) {
      table[row][col] =
        original[row] === corrected[col]
          ? table[row + 1][col + 1] + 1
          : Math.max(table[row + 1][col], table[row][col + 1]);
    }
  }

  const segments = [];
  let row = 0;
  let col = 0;

  while (row < original.length && col < corrected.length) {
    if (original[row] === corrected[col]) {
      pushSegment(segments, "same", original[row]);
      row += 1;
      col += 1;
    } else if (table[row][col + 1] >= table[row + 1][col]) {
      pushSegment(segments, "added", corrected[col]);
      col += 1;
    } else {
      pushSegment(segments, "removed", original[row]);
      row += 1;
    }
  }

  pushSegment(segments, "removed", original.slice(row));
  pushSegment(segments, "added", corrected.slice(col));
  return segments;
}

export function analyzeText(rawText) {
  const originalText = String(rawText ?? "");
  const { correctedText, changes, correctedSegments } = runCorrections(originalText);

  const issueCounts = createIssueCounts();
  for (const change of changes) {
    issueCounts[change.rule] += 1;
  }

  return {
    originalText,
    correctedText,
    correctedSegments,
    changes,
    issueCounts,
    hasChanges: changes.length > 0
  };
}
