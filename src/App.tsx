import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import "./App.css";

type SegmentField =
  | "onset"
  | "nucleus"
  | "coda";

type SelectedItem =
  | {
      type: "syllable";
      syllableId: string;
    }
  | {
      type: "branch";
      syllableId: string;
      field: SegmentField;
    }
  | {
      type: "segment";
      syllableId: string;
      field: SegmentField;
      index: number;
    }
  | {
      type: "shared";
      syllableId: string;
    }
  | null;

type ActiveSound =
  | {
      type: "segment";
      syllableId: string;
      field: SegmentField;
      index: number;
    }
  | {
      type: "shared";
      syllableId: string;
    }
  | null;

type SoundDragSource =
  Exclude<ActiveSound, null>;

type SoundDropTarget = {
  syllableId: string;
  field: SegmentField;
  insertionIndex?: number;
  anchorIndex?: number;
  position?: "before" | "after";
} | null;

interface MotionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SoundFlightSnapshot {
  rect: MotionRect;
  value: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
}

interface PendingSoundFlight
  extends SoundFlightSnapshot {
  targetLocation: string;
}

type BranchKind =
  | "onset"
  | "coda";

type FontChoice =
  | "system-sans"
  | "ipa-serif"
  | "traditional-serif"
  | "monospace";

interface TreeColors {
  canvasBackground: string;
  line: string;
  wordFill: string;
  wordOutline: string;
  wordText: string;
  syllableFill: string;
  syllableOutline: string;
  syllableText: string;
  onsetRhymeFill: string;
  onsetRhymeOutline: string;
  onsetRhymeText: string;
  nucleusCodaFill: string;
  nucleusCodaOutline: string;
  nucleusCodaText: string;
  terminalFill: string;
  terminalOutline: string;
  terminalText: string;
  sharedFill: string;
  sharedOutline: string;
  sharedText: string;
}

type TreeColorKey =
  keyof TreeColors;

interface CanvasSnapshot {
  word: string;
  syllables: Syllable[];
  plainStyle: boolean;
  treeFontSize: number;
  treeBold: boolean;
  treeItalic: boolean;
  fontFamily: FontChoice;
  treeColors: TreeColors;
  pngTransparent: boolean;
}

interface Syllable {
  id: string;
  onset: string[];
  nucleus: string[];
  coda: string[];
  hasOnset: boolean;
  hasCoda: boolean;
  primary: boolean;
  sharedToNext: string;
}

interface Preset {
  name: string;
  word: string;
  syllables: Omit<Syllable, "id">[];
}

interface SyllableDrag {
  kind: "syllable";
  syllableId: string;
  pointerId: number;
  startClientX: number;
  currentClientX: number;
}

interface BranchDrag {
  kind: "branch";
  syllableId: string;
  field: BranchKind;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
}

type DragState =
  | SyllableDrag
  | BranchDrag
  | null;

interface LayoutColumn {
  syllable: Syllable;
  index: number;
  centerX: number;
  onsetX: number;
  rhymeX: number;
  nucleusX: number;
  codaX: number;
  onsetVisible: boolean;
  codaVisible: boolean;
}

interface CanvasLayout {
  width: number;
  height: number;
  rootX: number;
  rootY: number;
  sigmaY: number;
  branchY: number;
  subbranchY: number;
  terminalY: number;
  columns: LayoutColumn[];
  insertionXs: number[];
}

const STORAGE_KEY =
  "syllable-tree-builder-state-v15";

const SOUND_DRAG_DATA_TYPE =
  "application/x-syllable-sound";

function getSoundLocationKey(
  syllableId: string,
  field: SegmentField,
  index: number,
): string {
  return `segment:${syllableId}:${field}:${index}`;
}

function getSharedLocationKey(
  syllableId: string,
): string {
  return `shared:${syllableId}`;
}

const defaultTreeColors: TreeColors = {
  canvasBackground: "#fffdf9",
  line: "#268b72",
  wordFill: "#1f3d57",
  wordOutline: "#1f3d57",
  wordText: "#ffffff",
  syllableFill: "#faece8",
  syllableOutline: "#df6b55",
  syllableText: "#b94f3d",
  onsetRhymeFill: "#e6f3f1",
  onsetRhymeOutline: "#269688",
  onsetRhymeText: "#1d746a",
  nucleusCodaFill: "#e8f1f6",
  nucleusCodaOutline: "#2f7ca8",
  nucleusCodaText: "#246587",
  terminalFill: "#faece8",
  terminalOutline: "#efb0a4",
  terminalText: "#b94f3d",
  sharedFill: "#fbf3e3",
  sharedOutline: "#d99a2b",
  sharedText: "#a97418",
};

const colorGroups: Array<{
  label: string;
  fill: TreeColorKey;
  outline: TreeColorKey;
  text: TreeColorKey;
}> = [
  {
    label: "Word",
    fill: "wordFill",
    outline: "wordOutline",
    text: "wordText",
  },
  {
    label: "Syllable",
    fill: "syllableFill",
    outline: "syllableOutline",
    text: "syllableText",
  },
  {
    label: "Onset / Rhyme",
    fill: "onsetRhymeFill",
    outline: "onsetRhymeOutline",
    text: "onsetRhymeText",
  },
  {
    label: "Nucleus / Coda",
    fill: "nucleusCodaFill",
    outline: "nucleusCodaOutline",
    text: "nucleusCodaText",
  },
  {
    label: "Sound boxes",
    fill: "terminalFill",
    outline: "terminalOutline",
    text: "terminalText",
  },
  {
    label: "Shared sound",
    fill: "sharedFill",
    outline: "sharedOutline",
    text: "sharedText",
  },
];

function normalizeTreeColors(
  value: unknown,
): TreeColors {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {
      ...defaultTreeColors,
    };
  }

  const supplied =
    value as Partial<TreeColors>;

  return Object.fromEntries(
    Object.entries(
      defaultTreeColors,
    ).map(([key, fallback]) => [
      key,
      typeof supplied[
        key as TreeColorKey
      ] === "string"
        ? supplied[
            key as TreeColorKey
          ]
        : fallback,
    ]),
  ) as unknown as TreeColors;
}

const fontOptions: Array<{
  id: FontChoice;
  label: string;
  css: string;
  latex: string;
}> = [
  {
    id: "system-sans",
    label: "System sans",
    css: '"Segoe UI", "Arial Unicode MS", Arial, sans-serif',
    latex: "Noto Sans",
  },
  {
    id: "ipa-serif",
    label: "IPA serif",
    css: '"Charis SIL", "Doulos SIL", Georgia, serif',
    latex: "Charis SIL",
  },
  {
    id: "traditional-serif",
    label: "Traditional serif",
    css: 'Georgia, "Times New Roman", serif',
    latex: "TeX Gyre Pagella",
  },
  {
    id: "monospace",
    label: "Monospace",
    css: '"Cascadia Mono", "Courier New", monospace',
    latex: "Noto Sans Mono",
  },
];

const ipaCharts = {
  "Pulmonic consonants": [
    {
      label: "Plosive",
      cells: [
        "p b", "t d", "ʈ ɖ", "c ɟ",
        "k ɡ", "q ɢ", "ʔ",
      ],
    },
    {
      label: "Nasal",
      cells: [
        "m", "ɱ", "n", "ɳ", "ɲ",
        "ŋ", "ɴ",
      ],
    },
    {
      label: "Trill",
      cells: [
        "ʙ", "r", "", "", "", "ʀ", "",
      ],
    },
    {
      label: "Tap / flap",
      cells: [
        "", "ɾ", "ɽ", "", "", "", "",
      ],
    },
    {
      label: "Fricative",
      cells: [
        "ɸ β", "f v", "θ ð", "s z",
        "ʃ ʒ", "ʂ ʐ", "ç ʝ", "x ɣ",
        "χ ʁ", "ħ ʕ", "h ɦ",
      ],
    },
    {
      label: "Lateral fricative",
      cells: [
        "", "", "", "ɬ ɮ", "", "", "",
      ],
    },
    {
      label: "Approximant",
      cells: [
        "", "ʋ", "ɹ", "ɻ", "j", "ɰ", "",
      ],
    },
    {
      label: "Lateral approximant",
      cells: [
        "", "", "l", "ɭ", "ʎ", "ʟ", "",
      ],
    },
  ],
  "Vowels": [
    {
      label: "Close",
      cells: [
        "i y", "ɨ ʉ", "ɯ u",
      ],
    },
    {
      label: "Near-close",
      cells: [
        "ɪ ʏ", "", "ʊ",
      ],
    },
    {
      label: "Close-mid",
      cells: [
        "e ø", "ɘ ɵ", "ɤ o",
      ],
    },
    {
      label: "Mid",
      cells: [
        "", "ə", "",
      ],
    },
    {
      label: "Open-mid",
      cells: [
        "ɛ œ", "ɜ ɞ", "ʌ ɔ",
      ],
    },
    {
      label: "Near-open",
      cells: [
        "æ", "ɐ", "",
      ],
    },
    {
      label: "Open",
      cells: [
        "a ɶ", "", "ɑ ɒ",
      ],
    },
    {
      label: "Course diphthongs",
      cells: [
        "eɪ aɪ ɔɪ", "aʊ", "oʊ",
      ],
    },
  ],
  "Non-pulmonic": [
    {
      label: "Clicks",
      cells: [
        "ʘ", "ǀ", "ǃ", "ǂ", "ǁ",
      ],
    },
    {
      label: "Voiced implosives",
      cells: [
        "ɓ", "ɗ", "ʄ", "ɠ", "ʛ",
      ],
    },
    {
      label: "Ejectives",
      cells: [
        "pʼ", "tʼ", "kʼ", "sʼ", "qʼ",
      ],
    },
  ],
  "Other symbols": [
    {
      label: "Other consonants",
      cells: [
        "ʍ", "w", "ɥ", "ʜ", "ʢ",
        "ʡ", "ɕ", "ʑ", "ɺ", "ɧ",
        "ɫ", "ɾ", "ʔ",
      ],
    },
    {
      label: "Suprasegmentals",
      cells: [
        "ˈ", "ˌ", "ː", "ˑ", "̆",
        ".", "|", "‖", "‿",
      ],
    },
    {
      label: "Diacritics",
      cells: [
        "̥", "̬", "ʰ", "̹", "̜",
        "̟", "̠", "̈", "̽", "̩",
        "̯", "˞", "ʷ", "ʲ", "ˠ",
        "ˤ", "̴", "̝", "̞", "̘",
        "̙", "̪", "̺", "̻", "̃",
        "ⁿ", "ˡ", "̚",
      ],
    },
    {
      label: "Tones",
      cells: [
        "˥", "˦", "˧", "˨", "˩",
        "̌", "̂", "᷄", "᷅", "᷈",
        "ꜛ", "ꜜ", "↑", "↓",
      ],
    },
  ],
} as const;

type IpaChart =
  keyof typeof ipaCharts;

const combiningIpaSymbols =
  new Set([
    "̥", "̬", "ʰ", "̹", "̜",
    "̟", "̠", "̈", "̽", "̩",
    "̯", "˞", "ʷ", "ʲ", "ˠ",
    "ˤ", "̴", "̝", "̞", "̘",
    "̙", "̪", "̺", "̻", "̃",
    "ⁿ", "ˡ", "̚", "ː", "ˑ",
    "̆", "ʼ",
  ]);

const presets: Preset[] = [
  {
    name: "following",
    word: "following",
    syllables: [
      {
        onset: ["f"],
        nucleus: ["ɑ"],
        coda: [],
        hasOnset: true,
        hasCoda: false,
        primary: true,
        sharedToNext: "",
      },
      {
        onset: ["l"],
        nucleus: ["oʊ"],
        coda: [],
        hasOnset: true,
        hasCoda: false,
        primary: false,
        sharedToNext: "",
      },
      {
        onset: [],
        nucleus: ["ɪ"],
        coda: ["ŋ"],
        hasOnset: false,
        hasCoda: true,
        primary: false,
        sharedToNext: "",
      },
    ],
  },
  {
    name: "happy",
    word: "happy",
    syllables: [
      {
        onset: ["h"],
        nucleus: ["æ"],
        coda: [],
        hasOnset: true,
        hasCoda: false,
        primary: true,
        sharedToNext: "p",
      },
      {
        onset: [],
        nucleus: ["i"],
        coda: [],
        hasOnset: false,
        hasCoda: false,
        primary: false,
        sharedToNext: "",
      },
    ],
  },
  {
    name: "cat",
    word: "cat",
    syllables: [
      {
        onset: ["k"],
        nucleus: ["æ"],
        coda: ["t"],
        hasOnset: true,
        hasCoda: true,
        primary: true,
        sharedToNext: "",
      },
    ],
  },
  {
    name: "spring",
    word: "spring",
    syllables: [
      {
        onset: ["s", "p", "ɹ"],
        nucleus: ["ɪ"],
        coda: ["ŋ"],
        hasOnset: true,
        hasCoda: true,
        primary: true,
        sharedToNext: "",
      },
    ],
  },
  {
    name: "window",
    word: "window",
    syllables: [
      {
        onset: ["w"],
        nucleus: ["ɪ"],
        coda: ["n"],
        hasOnset: true,
        hasCoda: true,
        primary: true,
        sharedToNext: "",
      },
      {
        onset: ["d"],
        nucleus: ["oʊ"],
        coda: [],
        hasOnset: true,
        hasCoda: false,
        primary: false,
        sharedToNext: "",
      },
    ],
  },
];

function makeId(): string {
  return `${Date.now()}-${Math.random()}`;
}

function createSyllable(
  values?: Partial<Omit<Syllable, "id">>,
): Syllable {
  return {
    id: makeId(),
    onset: values?.onset
      ? [...values.onset]
      : [],
    nucleus:
      values?.nucleus &&
      values.nucleus.length > 0
        ? [...values.nucleus]
        : ["ə"],
    coda: values?.coda
      ? [...values.coda]
      : [],
    hasOnset:
      values?.hasOnset ??
      Boolean(values?.onset?.length),
    hasCoda:
      values?.hasCoda ??
      Boolean(values?.coda?.length),
    primary:
      values?.primary ?? false,
    sharedToNext:
      values?.sharedToNext ?? "",
  };
}

function normalizeSyllables(
  items: readonly Syllable[],
): Syllable[] {
  if (items.length === 0) {
    return [
      createSyllable({
        primary: true,
      }),
    ];
  }

  const primaryIndex =
    items.findIndex(
      (item) => item.primary,
    );

  return items.map(
    (item, index) => ({
      ...item,
      onset: [...item.onset],
      nucleus:
        item.nucleus.length > 0
          ? [...item.nucleus]
          : [""],
      coda: [...item.coda],
      primary:
        primaryIndex === -1
          ? index === 0
          : index === primaryIndex,
      sharedToNext:
        index === items.length - 1
          ? ""
          : item.sharedToNext,
    }),
  );
}

function cloneSyllables(
  syllables: readonly Syllable[],
): Syllable[] {
  return syllables.map(
    (syllable) => ({
      ...syllable,
      onset: [...syllable.onset],
      nucleus: [...syllable.nucleus],
      coda: [...syllable.coda],
    }),
  );
}

function cloneSnapshot(
  snapshot: CanvasSnapshot,
): CanvasSnapshot {
  return {
    ...snapshot,
    syllables: cloneSyllables(
      snapshot.syllables,
    ),
    treeColors: {
      ...snapshot.treeColors,
    },
  };
}

function snapshotKey(
  snapshot: CanvasSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function loadInitialState(): {
  word: string;
  syllables: Syllable[];
  plainStyle: boolean;
  treeFontSize: number;
  treeBold: boolean;
  treeItalic: boolean;
  fontFamily: FontChoice;
  treeColors: TreeColors;
  pngTransparent: boolean;
} {
  try {
    const raw =
      localStorage.getItem(
        STORAGE_KEY,
      );

    if (!raw) {
      throw new Error(
        "No saved state.",
      );
    }

    const parsed = JSON.parse(
      raw,
    ) as {
      word?: unknown;
      syllables?: unknown;
      plainStyle?: unknown;
      treeFontSize?: unknown;
      treeBold?: unknown;
      treeItalic?: unknown;
      fontFamily?: unknown;
      treeColors?: unknown;
      pngTransparent?: unknown;
    };

    if (
      typeof parsed.word !==
        "string" ||
      !Array.isArray(
        parsed.syllables,
      ) ||
      parsed.syllables.length === 0
    ) {
      throw new Error(
        "Invalid saved state.",
      );
    }

    const syllables =
      parsed.syllables.map(
        (item) => {
          const value =
            item as Partial<Syllable>;

          return createSyllable({
            onset:
              Array.isArray(
                value.onset,
              )
                ? value.onset.map(
                    String,
                  )
                : [],
            nucleus:
              Array.isArray(
                value.nucleus,
              )
                ? value.nucleus.map(
                    String,
                  )
                : ["ə"],
            coda:
              Array.isArray(
                value.coda,
              )
                ? value.coda.map(
                    String,
                  )
                : [],
            hasOnset:
              value.hasOnset === true,
            hasCoda:
              value.hasCoda === true,
            primary:
              value.primary === true,
            sharedToNext:
              typeof value.sharedToNext ===
              "string"
                ? value.sharedToNext
                : "",
          });
        },
      );

    return {
      word: parsed.word,
      syllables:
        normalizeSyllables(
          syllables,
        ),
      plainStyle:
        parsed.plainStyle === true,
      treeFontSize:
        typeof parsed.treeFontSize ===
          "number"
          ? Math.min(
              30,
              Math.max(
                12,
                parsed.treeFontSize,
              ),
            )
          : 20,
      treeBold:
        parsed.treeBold === true,
      treeItalic:
        parsed.treeItalic === true,
      fontFamily:
        fontOptions.some(
          (option) =>
            option.id ===
            parsed.fontFamily,
        )
          ? parsed.fontFamily as FontChoice
          : "system-sans",
      treeColors:
        normalizeTreeColors(
          parsed.treeColors,
        ),
      pngTransparent:
        parsed.pngTransparent !== false,
    };
  } catch {
    return {
      word: "Wd",
      syllables: [
        createSyllable({
          nucleus: [""],
          primary: true,
        }),
      ],
      plainStyle: false,
      treeFontSize: 20,
      treeBold: false,
      treeItalic: false,
      fontFamily: "system-sans",
      treeColors: {
        ...defaultTreeColors,
      },
      pngTransparent: true,
    };
  }
}

function buildLayout(
  syllables: readonly Syllable[],
  treeFontSize: number,
  plainStyle: boolean,
): CanvasLayout {
  const height = 620;
  const rootY = 56;
  const sigmaY = 170;
  const branchY = 300;
  const subbranchY = 405;
  const terminalY = 520;
  const outerMargin = 115;
  const minimumColumnWidth =
    plainStyle ? 235 : 300;
  const terminalSpacing = Math.max(
    plainStyle ? 72 : 94,
    treeFontSize *
      (plainStyle ? 3.5 : 4.25),
  );
  const terminalWidth = Math.max(
    plainStyle ? 70 : 82,
    treeFontSize *
      (plainStyle ? 3.4 : 4.0),
  );
  const branchGap =
    plainStyle ? 36 : 56;
  const optionalBranchOffset =
    Math.max(
      plainStyle ? 78 : 96,
      treeFontSize *
        (plainStyle ? 3.7 : 4.6),
    );

  const columnMetrics =
    syllables.map(
      (syllable, index) => {
        const previousShared =
          index > 0 &&
          Boolean(
            syllables[
              index - 1
            ].sharedToNext.trim(),
          );

        const nextShared =
          index <
            syllables.length - 1 &&
          Boolean(
            syllable.sharedToNext.trim(),
          );

        const onsetVisible =
          syllable.hasOnset ||
          previousShared;

        const codaVisible =
          syllable.hasCoda ||
          nextShared;

        const onsetCount =
          Math.max(
            syllable.hasOnset
              ? syllable.onset.length
              : 0,
            previousShared ? 1 : 0,
          );

        const nucleusCount =
          Math.max(
            1,
            syllable.nucleus.length,
          );

        const codaCount =
          Math.max(
            syllable.hasCoda
              ? syllable.coda.length
              : 0,
            nextShared ? 1 : 0,
          );

        const onsetWidth =
          onsetVisible && onsetCount > 0
            ? terminalWidth +
              Math.max(
                0,
                onsetCount - 1,
              ) * terminalSpacing
            : 0;

        const nucleusWidth =
          terminalWidth +
          Math.max(
            0,
            nucleusCount - 1,
          ) * terminalSpacing;

        const codaWidth =
          codaVisible && codaCount > 0
            ? terminalWidth +
              Math.max(
                0,
                codaCount - 1,
              ) * terminalSpacing
            : 0;

        const rhymeWidth =
          codaVisible
            ? nucleusWidth +
              branchGap +
              codaWidth
            : nucleusWidth;

        const totalSpan =
          onsetVisible
            ? onsetWidth +
              branchGap +
              rhymeWidth
            : rhymeWidth;

        return {
          onsetVisible,
          codaVisible,
          onsetWidth,
          nucleusWidth,
          codaWidth,
          rhymeWidth,
          totalSpan,
          columnWidth: Math.max(
            minimumColumnWidth,
            totalSpan +
              (plainStyle
                ? 110
                : 160),
          ),
        };
      },
    );

  const columnWidths =
    columnMetrics.map(
      (metrics) =>
        metrics.columnWidth,
    );

  const totalColumnsWidth =
    columnWidths.reduce(
      (total, value) =>
        total + value,
      0,
    );

  const width = Math.max(
    900,
    totalColumnsWidth +
      outerMargin * 2,
  );

  const rootX = width / 2;
  const centers: number[] = [];

  if (syllables.length === 1) {
    centers.push(rootX);
  } else {
    let cursor = outerMargin;

    columnWidths.forEach(
      (columnWidth) => {
        centers.push(
          cursor +
            columnWidth / 2,
        );

        cursor += columnWidth;
      },
    );
  }

  const columns =
    syllables.map(
      (syllable, index) => {
        const centerX =
          centers[index];
        const metrics =
          columnMetrics[index];
        const leftEdge =
          centerX -
          metrics.totalSpan / 2;

        const onsetX =
          metrics.onsetVisible
            ? leftEdge +
              metrics.onsetWidth / 2
            : centerX -
              optionalBranchOffset;

        const rhymeLeft =
          metrics.onsetVisible
            ? leftEdge +
              metrics.onsetWidth +
              branchGap
            : leftEdge;

        const rhymeRight =
          rhymeLeft +
          metrics.rhymeWidth;

        const rhymeX =
          (rhymeLeft +
            rhymeRight) /
          2;

        const nucleusX =
          metrics.codaVisible
            ? rhymeLeft +
              metrics.nucleusWidth / 2
            : rhymeX;

        const codaX =
          metrics.codaVisible
            ? rhymeLeft +
              metrics.nucleusWidth +
              branchGap +
              metrics.codaWidth / 2
            : rhymeX +
              optionalBranchOffset;

        return {
          syllable,
          index,
          centerX,
          onsetX,
          rhymeX,
          nucleusX,
          codaX,
          onsetVisible:
            metrics.onsetVisible,
          codaVisible:
            metrics.codaVisible,
        };
      },
    );

  const insertionXs: number[] = [
    outerMargin / 2,
  ];

  for (
    let index = 0;
    index <
    columns.length - 1;
    index += 1
  ) {
    insertionXs.push(
      (columns[index].centerX +
        columns[index + 1]
          .centerX) /
        2,
    );
  }

  insertionXs.push(
    width - outerMargin / 2,
  );

  return {
    width,
    height,
    rootX,
    rootY,
    sigmaY,
    branchY,
    subbranchY,
    terminalY,
    columns,
    insertionXs,
  };
}

function getParallelLines(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length =
    Math.hypot(dx, dy) || 1;
  const offset = 4;

  const ox =
    (-dy / length) * offset;

  const oy =
    (dx / length) * offset;

  return [
    {
      x1: x1 + ox,
      y1: y1 + oy,
      x2: x2 + ox,
      y2: y2 + oy,
    },
    {
      x1: x1 - ox,
      y1: y1 - oy,
      x2: x2 - ox,
      y2: y2 - oy,
    },
  ] as const;
}

function escapeLatex(
  value: string,
): string {
  return value
    .replaceAll(
      "\\",
      "\\textbackslash{}",
    )
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("$", "\\$")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
}

function makeLatexTree(
  word: string,
  syllables: readonly Syllable[],
): string {
  const extraDraws: string[] = [];

  const syllableTrees =
    syllables.map(
      (syllable, index) => {
        const previousShared =
          index > 0
            ? syllables[
                index - 1
              ].sharedToNext.trim()
            : "";

        const nextShared =
          index <
          syllables.length - 1
            ? syllable.sharedToNext.trim()
            : "";

        const onsetVisible =
          syllable.hasOnset ||
          Boolean(previousShared);

        const codaVisible =
          syllable.hasCoda ||
          Boolean(nextShared);

        const onsetName =
          `onset${index}`;

        const sharedName =
          `shared${index}`;

        if (nextShared) {
          extraDraws.push(
            `\\draw (onset${
              index + 1
            }) -- (${sharedName});`,
          );
        }

        const onsetTree =
          onsetVisible
            ? `[O, name=${onsetName} ${
                syllable.onset
                  .map(
                    (segment) =>
                      `[${escapeLatex(
                        segment,
                      )}]`,
                  )
                  .join(" ")
              }]`
            : "";

        const nucleusTree =
          `[N ${
            syllable.nucleus.length >
            0
              ? syllable.nucleus
                  .map(
                    (segment) =>
                      segment
                        ? `[${escapeLatex(
                            segment,
                          )}]`
                        : `[{\\ensuremath{\\varnothing}}]`,
                  )
                  .join(" ")
              : `[{\\ensuremath{\\varnothing}}]`
          }]`;

        const ownCoda =
          syllable.coda
            .map(
              (segment) =>
                `[${escapeLatex(
                  segment,
                )}]`,
            )
            .join(" ");

        const shared =
          nextShared
            ? `[${escapeLatex(
                nextShared,
              )}, name=${sharedName}]`
            : "";

        const codaTree =
          codaVisible
            ? `[C ${ownCoda} ${shared}]`
            : "";

        const sigmaOptions =
          syllable.primary
            ? ", edge={double}"
            : "";

        return `[{\\ensuremath{\\sigma}}${sigmaOptions} ${onsetTree} [R ${nucleusTree} ${codaTree}]]`;
      },
    );

  return `\\begin{forest}
[${escapeLatex(
    word.trim() || "Wd",
  )}
${syllableTrees.join("\n")}
]
${extraDraws.join("\n")}
\\end{forest}`;
}

function makeFullLatex(
  word: string,
  syllables: readonly Syllable[],
  options: {
    fontChoice: FontChoice;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    plainStyle?: boolean;
  },
): string {
  const familyCommand =
    options.fontChoice ===
    "monospace"
      ? "\\ttfamily"
      : options.fontChoice ===
          "system-sans"
        ? "\\sffamily"
        : "\\rmfamily";

  const series =
    options.bold
      ? "\\bfseries"
      : "\\mdseries";

  const shape =
    options.italic
      ? "\\itshape"
      : "\\upshape";

  const lineHeight =
    Math.round(
      options.fontSize * 1.25,
    );

  const unicodeMap = `
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{textcomp}
\\usepackage{tipa}
\\usepackage{newunicodechar}
\\newunicodechar{ə}{\\textipa{@}}
\\newunicodechar{ɪ}{\\textipa{I}}
\\newunicodechar{ʊ}{\\textipa{U}}
\\newunicodechar{ʌ}{\\textipa{V}}
\\newunicodechar{æ}{\\textipa{{}}}
\\newunicodechar{ɑ}{\\textipa{A}}
\\newunicodechar{ɔ}{\\textipa{O}}
\\newunicodechar{ɛ}{\\textipa{E}}
\\newunicodechar{ɚ}{\\textipa{@\\textrhoticity}}
\\newunicodechar{ɝ}{\\textipa{3\\textrhoticity}}
\\newunicodechar{ɜ}{\\textipa{3}}
\\newunicodechar{ɹ}{\\textipa{r\\textturnr}}
\\newunicodechar{ŋ}{\\textipa{N}}
\\newunicodechar{θ}{\\textipa{T}}
\\newunicodechar{ð}{\\textipa{D}}
\\newunicodechar{ʃ}{\\textipa{S}}
\\newunicodechar{ʒ}{\\textipa{Z}}
\\newunicodechar{ʔ}{\\textipa{P}}
\\newunicodechar{ɾ}{\\textipa{R}}
\\newunicodechar{ɲ}{\\textipa{J}}
\\newunicodechar{ʎ}{\\textipa{L}}
\\newunicodechar{ɬ}{\\textipa{K}}
\\newunicodechar{ɮ}{\\textipa{K\\!\\textbeltl}}
\\newunicodechar{ɡ}{g}
\\newunicodechar{ɸ}{\\textipa{F}}
\\newunicodechar{β}{\\textipa{B}}
\\newunicodechar{ç}{\\textipa{C}}
\\newunicodechar{ʝ}{\\textipa{j\\textctj}}
\\newunicodechar{χ}{\\textipa{X}}
\\newunicodechar{ʁ}{\\textipa{R\\!\\textinvscr}}
\\newunicodechar{ħ}{\\textipa{H}}
\\newunicodechar{ʕ}{\\textipa{?\\textrevglotstop}}
\\newunicodechar{ɦ}{\\textipa{h\\textcth}}
\\newunicodechar{ɳ}{\\textipa{n\\textrtailn}}
\\newunicodechar{ʈ}{\\textipa{t\\textrtailt}}
\\newunicodechar{ɖ}{\\textipa{d\\textrtaild}}
\\newunicodechar{ɭ}{\\textipa{l\\textrtaill}}
\\newunicodechar{ɻ}{\\textipa{r\\textrtailr}}
\\newunicodechar{ɽ}{\\textipa{r\\textrtaild}}
\\newunicodechar{ʰ}{\\textsuperscript{h}}
\\newunicodechar{ʷ}{\\textsuperscript{w}}
\\newunicodechar{ʲ}{\\textsuperscript{j}}
\\newunicodechar{ː}{:}
\\newunicodechar{ˑ}{;}
\\newunicodechar{̃}{\\~{}}
\\newunicodechar{̩}{\\textsubring}
\\newunicodechar{̯}{\\textsubarch}
\\newunicodechar{ʼ}{'}
`;

  return `% Compile with pdfLaTeX.
\\documentclass[tikz,border=12pt]{standalone}
${unicodeMap}\\usepackage{forest}
\\forestset{%
  syllable tree/.style={%
    for tree={%
      align=center,%
      parent anchor=south,%
      child anchor=north,%
      l sep=24pt,%
      s sep=18pt,%
      inner sep=1.8pt,%
      font=${familyCommand}\\fontsize{${options.fontSize}}{${lineHeight}}\\selectfont${series}${shape}%
    }%
  }%
}
\\begin{document}
\\begin{forest} syllable tree
${makeLatexTree(word, syllables)
  .replace("\\begin{forest}\n", "")
  .replace("\n\\end{forest}", "")}
\\end{forest}
\\end{document}
`;
}

function App() {
  const [initialState] =
    useState(
      () => loadInitialState(),
    );

  const [word, setWord] =
    useState(initialState.word);

  const [syllables, setSyllables] =
    useState<Syllable[]>(
      initialState.syllables,
    );

  const [
    plainStyle,
    setPlainStyle,
  ] = useState(
    initialState.plainStyle,
  );

  const [
    treeFontSize,
    setTreeFontSize,
  ] = useState(
    initialState.treeFontSize,
  );

  const [
    treeBold,
    setTreeBold,
  ] = useState(
    initialState.treeBold,
  );

  const [
    treeItalic,
    setTreeItalic,
  ] = useState(
    initialState.treeItalic,
  );

  const [zoom, setZoom] =
    useState(1);

  const [
    fontFamily,
    setFontFamily,
  ] = useState<FontChoice>(
    initialState.fontFamily,
  );

  const [
    treeColors,
    setTreeColors,
  ] = useState<TreeColors>(
    initialState.treeColors,
  );

  const [
    pngTransparent,
    setPngTransparent,
  ] = useState(
    initialState.pngTransparent,
  );

  const [
    colorsOpen,
    setColorsOpen,
  ] = useState(false);

  const [
    selectedItem,
    setSelectedItem,
  ] = useState<SelectedItem>(
    null,
  );

  const [
    activeSound,
    setActiveSound,
  ] = useState<ActiveSound>(
    null,
  );

  const [
    soundDragSource,
    setSoundDragSource,
  ] = useState<SoundDragSource | null>(
    null,
  );

  const [
    soundDropTarget,
    setSoundDropTarget,
  ] = useState<SoundDropTarget>(
    null,
  );

  const [
    landedSoundLocation,
    setLandedSoundLocation,
  ] = useState<string | null>(
    null,
  );

  const [
    replaceOnNextIpa,
    setReplaceOnNextIpa,
  ] = useState(false);

  const [
    ipaOpen,
    setIpaOpen,
  ] = useState(false);

  const [
    ipaGroup,
    setIpaGroup,
  ] =
    useState<IpaChart>(
      "Pulmonic consonants",
    );

  const [
    dragState,
    setDragState,
  ] = useState<DragState>(
    null,
  );

  const [
    examplesOpen,
    setExamplesOpen,
  ] = useState(false);

  const [
    exportOpen,
    setExportOpen,
  ] = useState(false);

  const [status, setStatus] =
    useState(
      "Click a syllable, branch, or sound to edit it.",
    );

  const svgRef =
    useRef<SVGSVGElement | null>(
      null,
    );

  const canvasScrollRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const motionRectsRef =
    useRef<Map<string, MotionRect>>(
      new Map(),
    );

  const motionReadyRef =
    useRef(false);

  const soundFlightStartRef =
    useRef<SoundFlightSnapshot | null>(
      null,
    );

  const pendingSoundFlightRef =
    useRef<PendingSoundFlight | null>(
      null,
    );

  const landingTimerRef =
    useRef<number | null>(
      null,
    );

  const historyRef =
    useRef<CanvasSnapshot[]>([
      cloneSnapshot({
        word: initialState.word,
        syllables:
          initialState.syllables,
        plainStyle:
          initialState.plainStyle,
        treeFontSize:
          initialState.treeFontSize,
        treeBold:
          initialState.treeBold,
        treeItalic:
          initialState.treeItalic,
        fontFamily:
          initialState.fontFamily,
        treeColors:
          initialState.treeColors,
        pngTransparent:
          initialState.pngTransparent,
      }),
    ]);

  const historyIndexRef =
    useRef(0);

  const restoringHistoryRef =
    useRef(false);

  const [
    historyVersion,
    setHistoryVersion,
  ] = useState(0);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        word,
        syllables,
        plainStyle,
        treeFontSize,
        treeBold,
        treeItalic,
        fontFamily,
        treeColors,
        pngTransparent,
      }),
    );
  }, [
    word,
    syllables,
    plainStyle,
    treeFontSize,
    treeBold,
    treeItalic,
    fontFamily,
    treeColors,
    pngTransparent,
  ]);

  useEffect(() => {
    const snapshot: CanvasSnapshot = {
      word,
      syllables:
        cloneSyllables(
          syllables,
        ),
      plainStyle,
      treeFontSize,
      treeBold,
      treeItalic,
      fontFamily,
      treeColors: {
        ...treeColors,
      },
      pngTransparent,
    };

    if (
      restoringHistoryRef.current
    ) {
      restoringHistoryRef.current =
        false;
      return;
    }

    const current =
      historyRef.current[
        historyIndexRef.current
      ];

    if (
      current &&
      snapshotKey(current) ===
        snapshotKey(snapshot)
    ) {
      return;
    }

    const nextHistory =
      historyRef.current.slice(
        0,
        historyIndexRef.current + 1,
      );

    nextHistory.push(
      cloneSnapshot(snapshot),
    );

    if (nextHistory.length > 100) {
      nextHistory.shift();
    }

    historyRef.current =
      nextHistory;
    historyIndexRef.current =
      nextHistory.length - 1;
    setHistoryVersion(
      (previous) =>
        previous + 1,
    );
  }, [
    word,
    syllables,
    plainStyle,
    treeFontSize,
    treeBold,
    treeItalic,
    fontFamily,
    treeColors,
    pngTransparent,
  ]);

  const layout = useMemo(
    () =>
      buildLayout(
        syllables,
        treeFontSize,
        plainStyle,
      ),
    [
      syllables,
      treeFontSize,
      plainStyle,
    ],
  );

  const selectedFont =
    useMemo(
      () =>
        fontOptions.find(
          (option) =>
            option.id ===
            fontFamily,
        ) ?? fontOptions[0],
      [fontFamily],
    );

  useLayoutEffect(() => {
    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    const elements = Array.from(
      svg.querySelectorAll<SVGElement>(
        "[data-motion-id]",
      ),
    );

    const nextRects =
      new Map<string, MotionRect>();

    elements.forEach((element) => {
      const id =
        element.getAttribute(
          "data-motion-id",
        );

      if (!id) {
        return;
      }

      const rect =
        element.getBoundingClientRect();

      const current: MotionRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      nextRects.set(id, current);

      if (!motionReadyRef.current) {
        return;
      }

      const previous =
        motionRectsRef.current.get(id);

      if (!previous) {
        element.animate(
          [
            {
              transform:
                "translateY(-9px) scale(0.9)",
              opacity: 0,
            },
            {
              transform:
                "translateY(0) scale(1)",
              opacity: 1,
            },
          ],
          {
            duration: 300,
            easing:
              "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );
        return;
      }

      const deltaX =
        previous.left -
        current.left;
      const deltaY =
        previous.top -
        current.top;

      if (
        Math.abs(deltaX) < 0.75 &&
        Math.abs(deltaY) < 0.75
      ) {
        return;
      }

      element.animate(
        [
          {
            transform: `translate(${deltaX}px, ${deltaY}px)`,
            opacity: 0.9,
          },
          {
            transform:
              "translate(0, 0)",
            opacity: 1,
          },
        ],
        {
          duration: 430,
          easing:
            "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    });

    motionRectsRef.current =
      nextRects;
    motionReadyRef.current = true;

    const pending =
      pendingSoundFlightRef.current;

    if (!pending) {
      return;
    }

    pendingSoundFlightRef.current =
      null;

    window.requestAnimationFrame(() => {
      const target = Array.from(
        svg.querySelectorAll<SVGElement>(
          "[data-sound-location]",
        ),
      ).find(
        (element) =>
          element.getAttribute(
            "data-sound-location",
          ) ===
          pending.targetLocation,
      );

      if (!target) {
        return;
      }

      const targetRect =
        target.getBoundingClientRect();
      const clone =
        document.createElement("div");

      clone.className =
        "sound-flight-clone";
      clone.textContent =
        pending.value;

      Object.assign(
        clone.style,
        {
          position: "fixed",
          left: `${pending.rect.left}px`,
          top: `${pending.rect.top}px`,
          width: `${pending.rect.width}px`,
          height: `${pending.rect.height}px`,
          color: pending.color,
          backgroundColor:
            pending.backgroundColor,
          borderColor:
            pending.borderColor,
          borderStyle: "solid",
          borderWidth: "1px",
          borderRadius:
            pending.borderRadius,
          fontFamily:
            pending.fontFamily,
          fontSize: pending.fontSize,
          fontWeight:
            pending.fontWeight,
          fontStyle:
            pending.fontStyle,
          pointerEvents: "none",
          zIndex: "9999",
        },
      );

      document.body.appendChild(
        clone,
      );

      const deltaX =
        targetRect.left -
        pending.rect.left;
      const deltaY =
        targetRect.top -
        pending.rect.top;
      const scaleX =
        targetRect.width /
        Math.max(
          1,
          pending.rect.width,
        );
      const scaleY =
        targetRect.height /
        Math.max(
          1,
          pending.rect.height,
        );

      const animation =
        clone.animate(
          [
            {
              transform:
                "translate(0, 0) scale(1)",
              opacity: 0.98,
              filter:
                "drop-shadow(0 8px 10px rgba(36,49,63,0.22))",
            },
            {
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
              opacity: 0.16,
              filter:
                "drop-shadow(0 0 0 rgba(36,49,63,0))",
            },
          ],
          {
            duration: 420,
            easing:
              "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );

      animation.onfinish = () => {
        clone.remove();
        setLandedSoundLocation(
          pending.targetLocation,
        );

        if (
          landingTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            landingTimerRef.current,
          );
        }

        landingTimerRef.current =
          window.setTimeout(
            () =>
              setLandedSoundLocation(
                null,
              ),
            520,
          );
      };
    });
  }, [
    layout,
    syllables,
    zoom,
    treeFontSize,
    plainStyle,
    fontFamily,
  ]);

  useEffect(() => {
    return () => {
      if (
        landingTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          landingTimerRef.current,
        );
      }
    };
  }, []);

  const canUndo =
    historyVersion >= 0 &&
    historyIndexRef.current > 0;

  const canRedo =
    historyVersion >= 0 &&
    historyIndexRef.current <
      historyRef.current.length - 1;

  function restoreSnapshot(
    snapshot: CanvasSnapshot,
  ) {
    restoringHistoryRef.current =
      true;
    setWord(snapshot.word);
    setSyllables(
      cloneSyllables(
        snapshot.syllables,
      ),
    );
    setPlainStyle(
      snapshot.plainStyle,
    );
    setTreeFontSize(
      snapshot.treeFontSize,
    );
    setTreeBold(
      snapshot.treeBold,
    );
    setTreeItalic(
      snapshot.treeItalic,
    );
    setFontFamily(
      snapshot.fontFamily,
    );
    setTreeColors({
      ...snapshot.treeColors,
    });
    setPngTransparent(
      snapshot.pngTransparent,
    );
    setSelectedItem(null);
    setActiveSound(null);
    setReplaceOnNextIpa(false);
    setIpaOpen(false);
  }

  function undo() {
    if (!canUndo) {
      setStatus(
        "Nothing to undo.",
      );
      return;
    }

    historyIndexRef.current -= 1;
    restoreSnapshot(
      historyRef.current[
        historyIndexRef.current
      ],
    );
    setHistoryVersion(
      (previous) =>
        previous + 1,
    );
    setStatus("Undid last change.");
  }

  function redo() {
    if (!canRedo) {
      setStatus(
        "Nothing to redo.",
      );
      return;
    }

    historyIndexRef.current += 1;
    restoreSnapshot(
      historyRef.current[
        historyIndexRef.current
      ],
    );
    setHistoryVersion(
      (previous) =>
        previous + 1,
    );
    setStatus("Redid change.");
  }

  function centerTree(
    behavior: ScrollBehavior =
      "smooth",
  ) {
    const scroller =
      canvasScrollRef.current;

    if (!scroller) {
      return;
    }

    window.requestAnimationFrame(
      () => {
        scroller.scrollTo({
          left: Math.max(
            0,
            (
              scroller.scrollWidth -
              scroller.clientWidth
            ) / 2,
          ),
          behavior,
        });
      },
    );
  }

  function fitAndCenterTree() {
    setZoom(1);
    centerTree("smooth");
    setStatus(
      "Tree fitted and centered.",
    );
  }

  function resetTypography() {
    setTreeFontSize(20);
    setTreeBold(false);
    setTreeItalic(false);
    setStatus(
      "Tree typography reset.",
    );
  }

  function updateTreeColor(
    key: TreeColorKey,
    value: string,
  ) {
    setTreeColors(
      (previous) => ({
        ...previous,
        [key]: value,
      }),
    );
  }

  function resetTreeColors() {
    setTreeColors({
      ...defaultTreeColors,
    });
    setStatus(
      "Tree colours reset.",
    );
  }

  useEffect(() => {
    centerTree("smooth");
  }, [
    layout.width,
    layout.height,
    zoom,
  ]);

  useEffect(() => {
    function handleKeyboardShortcut(
      event: KeyboardEvent,
    ) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();

        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (event.key !== "Delete") {
        return;
      }

      const target =
        event.target as HTMLElement | null;

      if (
        target?.matches(
          "input, textarea, select, [contenteditable='true']",
        )
      ) {
        return;
      }

      event.preventDefault();
      deleteSelectedItem();
    }

    window.addEventListener(
      "keydown",
      handleKeyboardShortcut,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyboardShortcut,
      );
  });

  function getSvgPoint(
    clientX: number,
    clientY: number,
  ) {
    const svg = svgRef.current;

    if (!svg) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect =
      svg.getBoundingClientRect();

    return {
      x:
        ((clientX - rect.left) /
          rect.width) *
        layout.width,
      y:
        ((clientY - rect.top) /
          rect.height) *
        layout.height,
    };
  }

  function setPrimary(
    syllableId: string,
  ) {
    setSyllables(
      (previous) =>
        previous.map(
          (syllable) => ({
            ...syllable,
            primary:
              syllable.id ===
              syllableId,
          }),
        ),
    );

    setStatus(
      "Primary stress moved.",
    );
  }

  function insertSyllableAt(
    index: number,
  ) {
    setSyllables(
      (previous) => {
        const next =
          [...previous];

        const created =
          createSyllable();

        next.splice(
          index,
          0,
          created,
        );

        setSelectedItem({
          type: "syllable",
          syllableId:
            created.id,
        });

        return normalizeSyllables(
          next,
        );
      },
    );

    setActiveSound(null);
    setIpaOpen(false);
    setStatus(
      "New syllable inserted.",
    );
  }

  function duplicateSyllable(
    syllableId: string,
  ) {
    setSyllables(
      (previous) => {
        const index =
          previous.findIndex(
            (syllable) =>
              syllable.id ===
              syllableId,
          );

        if (index < 0) {
          return previous;
        }

        const source =
          previous[index];

        const copy =
          createSyllable({
            onset:
              source.onset,
            nucleus:
              source.nucleus,
            coda: source.coda,
            hasOnset:
              source.hasOnset,
            hasCoda:
              source.hasCoda,
            primary: false,
          });

        const next =
          [...previous];

        next.splice(
          index + 1,
          0,
          copy,
        );

        setSelectedItem({
          type: "syllable",
          syllableId:
            copy.id,
        });

        return normalizeSyllables(
          next,
        );
      },
    );

    setStatus(
      "Syllable duplicated.",
    );
  }

  function deleteSyllable(
    syllableId: string,
  ) {
    if (
      syllables.length === 1
    ) {
      setStatus(
        "The tree must keep at least one syllable.",
      );
      return;
    }

    setSyllables(
      (previous) =>
        normalizeSyllables(
          previous.filter(
            (syllable) =>
              syllable.id !==
              syllableId,
          ),
        ),
    );

    setSelectedItem(null);
    setActiveSound(null);
    setIpaOpen(false);
    setStatus(
      "Syllable removed.",
    );
  }

  function moveSyllableToIndex(
    syllableId: string,
    targetIndex: number,
  ) {
    setSyllables(
      (previous) => {
        const sourceIndex =
          previous.findIndex(
            (syllable) =>
              syllable.id ===
              syllableId,
          );

        if (
          sourceIndex < 0 ||
          sourceIndex ===
            targetIndex
        ) {
          return previous;
        }

        const next =
          [...previous];

        const [source] =
          next.splice(
            sourceIndex,
            1,
          );

        next.splice(
          targetIndex,
          0,
          source,
        );

        return normalizeSyllables(
          next,
        );
      },
    );

    setStatus(
      "Syllable reordered.",
    );
  }

  function setBranchVisible(
    syllableId: string,
    field: BranchKind,
    visible: boolean,
  ) {
    setSyllables(
      (previous) =>
        previous.map(
          (syllable) => {
            if (
              syllable.id !==
              syllableId
            ) {
              return syllable;
            }

            if (
              field === "onset"
            ) {
              return {
                ...syllable,
                hasOnset:
                  visible,
                onset: visible
                  ? syllable.onset
                      .length >
                    0
                    ? syllable.onset
                    : [""]
                  : [],
              };
            }

            return {
              ...syllable,
              hasCoda:
                visible,
              coda: visible
                ? syllable.coda
                    .length > 0
                  ? syllable.coda
                  : [""]
                : [],
            };
          },
        ),
    );
  }

  function updateSegment(
    syllableId: string,
    field: SegmentField,
    index: number,
    value: string,
  ) {
    setSyllables(
      (previous) =>
        previous.map(
          (syllable) => {
            if (
              syllable.id !==
              syllableId
            ) {
              return syllable;
            }

            const segments = [
              ...syllable[field],
            ];

            segments[index] =
              value;

            return {
              ...syllable,
              [field]: segments,
            };
          },
        ),
    );
  }

  function addSegment(
    syllableId: string,
    field: SegmentField,
  ) {
    setSyllables(
      (previous) =>
        previous.map(
          (syllable) => {
            if (
              syllable.id !==
              syllableId
            ) {
              return syllable;
            }

            return {
              ...syllable,
              [field]: [
                ...syllable[field],
                "",
              ],
              ...(field ===
              "onset"
                ? {
                    hasOnset:
                      true,
                  }
                : {}),
              ...(field ===
              "coda"
                ? {
                    hasCoda:
                      true,
                  }
                : {}),
            };
          },
        ),
    );

    setStatus(
      "Sound slot added.",
    );
  }

  function removeSegment(
    syllableId: string,
    field: SegmentField,
    index: number,
  ) {
    setSyllables(
      (previous) =>
        previous.map(
          (syllable) => {
            if (
              syllable.id !==
              syllableId
            ) {
              return syllable;
            }

            const nextSegments =
              syllable[field].filter(
                (_, itemIndex) =>
                  itemIndex !==
                  index,
              );

            if (
              field ===
              "nucleus" &&
              nextSegments.length ===
                0
            ) {
              nextSegments.push("");
            }

            return {
              ...syllable,
              [field]:
                nextSegments,
              ...(field ===
                "onset" &&
              nextSegments.length ===
                0
                ? {
                    hasOnset:
                      false,
                  }
                : {}),
              ...(field ===
                "coda" &&
              nextSegments.length ===
                0
                ? {
                    hasCoda:
                      false,
                  }
                : {}),
            };
          },
        ),
    );

    setActiveSound(null);
    setIpaOpen(false);
  }

  function readSoundDragSource(
    event: ReactDragEvent<Element>,
  ): SoundDragSource | null {
    if (soundDragSource) {
      return soundDragSource;
    }

    try {
      const raw =
        event.dataTransfer.getData(
          SOUND_DRAG_DATA_TYPE,
        );

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(
        raw,
      ) as SoundDragSource;

      if (
        parsed.type === "shared" &&
        typeof parsed.syllableId ===
          "string"
      ) {
        return parsed;
      }

      if (
        parsed.type === "segment" &&
        typeof parsed.syllableId ===
          "string" &&
        [
          "onset",
          "nucleus",
          "coda",
        ].includes(parsed.field) &&
        Number.isInteger(
          parsed.index,
        )
      ) {
        return parsed;
      }
    } catch {
      return null;
    }

    return null;
  }

  function startSoundDrag(
    event: ReactDragEvent<HTMLInputElement>,
    source: SoundDragSource,
    value: string,
  ) {
    if (!value.trim()) {
      event.preventDefault();
      setStatus(
        "Add an IPA symbol before moving this sound box.",
      );
      return;
    }

    event.stopPropagation();

    const sourceRect =
      event.currentTarget.getBoundingClientRect();
    const sourceStyle =
      window.getComputedStyle(
        event.currentTarget,
      );

    soundFlightStartRef.current = {
      rect: {
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      },
      value,
      color: sourceStyle.color,
      backgroundColor:
        sourceStyle.backgroundColor,
      borderColor:
        sourceStyle.borderColor,
      borderRadius:
        sourceStyle.borderRadius,
      fontFamily:
        sourceStyle.fontFamily,
      fontSize: sourceStyle.fontSize,
      fontWeight:
        sourceStyle.fontWeight,
      fontStyle:
        sourceStyle.fontStyle,
    };

    event.dataTransfer.effectAllowed =
      "move";
    event.dataTransfer.setData(
      SOUND_DRAG_DATA_TYPE,
      JSON.stringify(source),
    );
    event.dataTransfer.setData(
      "text/plain",
      value,
    );
    setSoundDragSource(source);
    setSoundDropTarget(null);
    setStatus(
      "Drop onto O, N, or C, or place it left/right of another sound box.",
    );
  }

  function finishSoundDrag() {
    setSoundDragSource(null);
    setSoundDropTarget(null);
    soundFlightStartRef.current =
      null;
  }

  function handleSoundDragOver<
    T extends Element,
  >(
    event: ReactDragEvent<T>,
    syllableId: string,
    field: SegmentField,
  ) {
    if (
      !soundDragSource &&
      !event.dataTransfer.types.includes(
        SOUND_DRAG_DATA_TYPE,
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      "move";
    setSoundDropTarget({
      syllableId,
      field,
    });
  }

  function getSoundBoxDropPosition(
    event: ReactDragEvent<HTMLInputElement>,
    targetIndex: number,
  ) {
    const rect =
      event.currentTarget.getBoundingClientRect();

    const position =
      event.clientX <
      rect.left + rect.width / 2
        ? "before"
        : "after";

    return {
      position,
      insertionIndex:
        targetIndex +
        (position === "after"
          ? 1
          : 0),
    } as const;
  }

  function handleSoundBoxDragOver(
    event: ReactDragEvent<HTMLInputElement>,
    targetSyllableId: string,
    targetField: SegmentField,
    targetIndex: number,
  ) {
    if (
      !soundDragSource &&
      !event.dataTransfer.types.includes(
        SOUND_DRAG_DATA_TYPE,
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      "move";

    const dropPosition =
      getSoundBoxDropPosition(
        event,
        targetIndex,
      );

    setSoundDropTarget({
      syllableId:
        targetSyllableId,
      field: targetField,
      anchorIndex:
        targetIndex,
      position:
        dropPosition.position,
      insertionIndex:
        dropPosition.insertionIndex,
    });
  }

  function handleSoundBoxDrop(
    event: ReactDragEvent<HTMLInputElement>,
    targetSyllableId: string,
    targetField: SegmentField,
    targetIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const source =
      readSoundDragSource(
        event,
      );

    if (!source) {
      finishSoundDrag();
      return;
    }

    const dropPosition =
      getSoundBoxDropPosition(
        event,
        targetIndex,
      );

    moveSoundToBranch(
      source,
      targetSyllableId,
      targetField,
      dropPosition.insertionIndex,
    );

    finishSoundDrag();
  }

  function moveSoundToBranch(
    source: SoundDragSource,
    targetSyllableId: string,
    targetField: SegmentField,
    requestedInsertionIndex?: number,
  ) {
    const sameBranch =
      source.type === "segment" &&
      source.syllableId ===
        targetSyllableId &&
      source.field === targetField;

    if (
      sameBranch &&
      requestedInsertionIndex ===
        undefined
    ) {
      setStatus(
        "Drop to the left or right of another box to reorder this branch.",
      );
      return;
    }

    const sourceSyllable =
      syllables.find(
        (syllable) =>
          syllable.id ===
          source.syllableId,
      );

    if (!sourceSyllable) {
      setStatus(
        "The source sound could not be found.",
      );
      return;
    }

    const soundValue =
      source.type === "shared"
        ? sourceSyllable.sharedToNext
        : sourceSyllable[
            source.field
          ][source.index] ?? "";

    if (!soundValue.trim()) {
      setStatus(
        "Blank sound boxes cannot be moved.",
      );
      return;
    }

    const targetSyllable =
      syllables.find(
        (syllable) =>
          syllable.id ===
          targetSyllableId,
      );

    if (!targetSyllable) {
      setStatus(
        "The destination branch could not be found.",
      );
      return;
    }

    const targetValues =
      targetSyllable[targetField];

    const replacesBlankTarget =
      targetValues.length === 1 &&
      !targetValues[0].trim();

    let targetIndex =
      replacesBlankTarget
        ? 0
        : Math.min(
            targetValues.length,
            Math.max(
              0,
              requestedInsertionIndex ??
                targetValues.length,
            ),
          );

    if (
      sameBranch &&
      source.type === "segment" &&
      source.index < targetIndex
    ) {
      targetIndex -= 1;
    }

    if (
      sameBranch &&
      source.type === "segment" &&
      targetIndex === source.index
    ) {
      setStatus(
        "The sound box is already in that position.",
      );
      return;
    }

    if (soundFlightStartRef.current) {
      pendingSoundFlightRef.current = {
        ...soundFlightStartRef.current,
        value: soundValue,
        targetLocation:
          getSoundLocationKey(
            targetSyllableId,
            targetField,
            targetIndex,
          ),
      };
    }

    setSyllables(
      (previous) => {
        const next =
          cloneSyllables(previous);

        const nextSource =
          next.find(
            (syllable) =>
              syllable.id ===
              source.syllableId,
          );

        const nextTarget =
          next.find(
            (syllable) =>
              syllable.id ===
              targetSyllableId,
          );

        if (
          !nextSource ||
          !nextTarget
        ) {
          return previous;
        }

        if (
          source.type === "shared"
        ) {
          nextSource.sharedToNext =
            "";
        } else {
          const sourceValues =
            nextSource[source.field];

          sourceValues.splice(
            source.index,
            1,
          );

          if (
            source.field ===
              "nucleus" &&
            sourceValues.length === 0
          ) {
            sourceValues.push("");
          }

          if (
            source.field ===
            "onset"
          ) {
            nextSource.hasOnset =
              sourceValues.length > 0;
          }

          if (
            source.field ===
            "coda"
          ) {
            nextSource.hasCoda =
              sourceValues.length > 0;
          }
        }

        const destinationValues =
          nextTarget[targetField];

        if (
          destinationValues.length ===
            1 &&
          !destinationValues[0].trim()
        ) {
          destinationValues[0] =
            soundValue;
        } else {
          const safeTargetIndex =
            Math.min(
              destinationValues.length,
              Math.max(
                0,
                targetIndex,
              ),
            );

          destinationValues.splice(
            safeTargetIndex,
            0,
            soundValue,
          );
        }

        if (
          targetField === "onset"
        ) {
          nextTarget.hasOnset = true;
        }

        if (
          targetField === "coda"
        ) {
          nextTarget.hasCoda = true;
        }

        return normalizeSyllables(
          next,
        );
      },
    );

    setSelectedItem({
      type: "segment",
      syllableId:
        targetSyllableId,
      field: targetField,
      index: targetIndex,
    });
    setActiveSound({
      type: "segment",
      syllableId:
        targetSyllableId,
      field: targetField,
      index: targetIndex,
    });
    setReplaceOnNextIpa(true);
    setIpaOpen(true);
    setStatus(
      sameBranch
        ? `Reordered ${soundValue} within ${targetField}.`
        : `Moved ${soundValue} to ${targetField}.`,
    );
  }

  function handleSoundDrop<
    T extends Element,
  >(
    event: ReactDragEvent<T>,
    targetSyllableId: string,
    targetField: SegmentField,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const source =
      readSoundDragSource(
        event as ReactDragEvent<Element>,
      );

    if (!source) {
      finishSoundDrag();
      return;
    }

    moveSoundToBranch(
      source,
      targetSyllableId,
      targetField,
    );
    finishSoundDrag();
  }

  function removeBranch(
    syllableId: string,
    field: SegmentField,
  ) {
    if (
      field === "nucleus"
    ) {
      setSyllables(
        (previous) =>
          previous.map(
            (syllable) =>
              syllable.id ===
              syllableId
                ? {
                    ...syllable,
                    nucleus: [""],
                  }
                : syllable,
          ),
      );
    } else {
      setBranchVisible(
        syllableId,
        field,
        false,
      );
    }

    setSelectedItem(null);
    setActiveSound(null);
    setReplaceOnNextIpa(false);
    setIpaOpen(false);
  }

  function deleteSelectedItem() {
    if (!selectedItem) {
      setStatus(
        "Select a syllable, branch, or sound box first.",
      );
      return;
    }

    if (
      selectedItem.type ===
      "syllable"
    ) {
      deleteSyllable(
        selectedItem.syllableId,
      );
      return;
    }

    if (
      selectedItem.type ===
      "branch"
    ) {
      if (
        selectedItem.field ===
        "nucleus"
      ) {
        removeBranch(
          selectedItem.syllableId,
          "nucleus",
        );
        setStatus(
          "The required nucleus was cleared.",
        );
      } else {
        removeBranch(
          selectedItem.syllableId,
          selectedItem.field,
        );
      }
      return;
    }

    if (
      selectedItem.type ===
      "segment"
    ) {
      removeSegment(
        selectedItem.syllableId,
        selectedItem.field,
        selectedItem.index,
      );
      setSelectedItem(null);
      setStatus(
        "Sound box deleted.",
      );
      return;
    }

    setSharedSegment(
      selectedItem.syllableId,
      "",
    );
    setSelectedItem(null);
    setActiveSound(null);
    setIpaOpen(false);
    setStatus(
      "Shared sound box deleted.",
    );
  }

  function setSharedSegment(
    syllableId: string,
    value: string,
  ) {
    setSyllables(
      (previous) =>
        normalizeSyllables(
          previous.map(
            (syllable) =>
              syllable.id ===
              syllableId
                ? {
                    ...syllable,
                    sharedToNext:
                      value,
                  }
                : syllable,
          ),
        ),
    );
  }

  function selectSound(
    sound: ActiveSound,
  ) {
    setActiveSound(sound);
    setReplaceOnNextIpa(true);
    setIpaOpen(true);

    if (
      sound?.type ===
      "segment"
    ) {
      setSelectedItem({
        type: "segment",
        syllableId:
          sound.syllableId,
        field: sound.field,
        index: sound.index,
      });
    } else if (
      sound?.type === "shared"
    ) {
      setSelectedItem({
        type: "shared",
        syllableId:
          sound.syllableId,
      });
    }

    setStatus(
      "Choose an IPA symbol below or type directly.",
    );
  }

  function getActiveSoundValue(): string {
    if (!activeSound) {
      return "";
    }

    if (
      activeSound.type ===
      "shared"
    ) {
      return (
        syllables.find(
          (syllable) =>
            syllable.id ===
            activeSound.syllableId,
        )?.sharedToNext ?? ""
      );
    }

    const syllable =
      syllables.find(
        (item) =>
          item.id ===
          activeSound.syllableId,
      );

    return (
      syllable?.[
        activeSound.field
      ][activeSound.index] ?? ""
    );
  }

  function setActiveSoundValue(
    value: string,
  ) {
    if (!activeSound) {
      return;
    }

    if (
      activeSound.type ===
      "shared"
    ) {
      setSharedSegment(
        activeSound.syllableId,
        value,
      );
      return;
    }

    updateSegment(
      activeSound.syllableId,
      activeSound.field,
      activeSound.index,
      value,
    );
  }

  function insertIpa(
    symbol: string,
  ) {
    if (!activeSound) {
      setStatus(
        "Click a terminal sound first.",
      );
      return;
    }

    if (
      activeSound.type ===
      "shared"
    ) {
      setActiveSoundValue(
        combiningIpaSymbols.has(
          symbol,
        )
          ? `${getActiveSoundValue()}${symbol}`
          : symbol,
      );
      setReplaceOnNextIpa(false);

      return;
    }

    if (
      combiningIpaSymbols.has(
        symbol,
      )
    ) {
      setActiveSoundValue(
        `${getActiveSoundValue()}${symbol}`,
      );
      setReplaceOnNextIpa(false);

      return;
    }

    const current =
      getActiveSoundValue();

    if (
      !current ||
      replaceOnNextIpa
    ) {
      setActiveSoundValue(
        symbol,
      );
      setReplaceOnNextIpa(false);
      setStatus(
        current && replaceOnNextIpa
          ? "Selected sound replaced."
          : "Sound inserted.",
      );

      return;
    }

    const nextIndex =
      activeSound.index + 1;

    setSyllables(
      (previous) =>
        previous.map(
          (syllable) => {
            if (
              syllable.id !==
              activeSound.syllableId
            ) {
              return syllable;
            }

            const segments = [
              ...syllable[
                activeSound.field
              ],
            ];

            segments.splice(
              nextIndex,
              0,
              symbol,
            );

            return {
              ...syllable,
              [activeSound.field]:
                segments,
              ...(activeSound.field ===
              "onset"
                ? {
                    hasOnset:
                      true,
                  }
                : {}),
              ...(activeSound.field ===
              "coda"
                ? {
                    hasCoda:
                      true,
                  }
                : {}),
            };
          },
        ),
    );

    setActiveSound({
      ...activeSound,
      index: nextIndex,
    });

    setSelectedItem({
      type: "segment",
      syllableId:
        activeSound.syllableId,
      field:
        activeSound.field,
      index: nextIndex,
    });

    setReplaceOnNextIpa(false);

    setStatus(
      "A new terminal branch was created automatically.",
    );
  }

  function backspaceIpa() {
    const current =
      getActiveSoundValue();

    setReplaceOnNextIpa(false);
    setActiveSoundValue(
      Array.from(current)
        .slice(0, -1)
        .join(""),
    );
  }

  function getNearestSyllableIndex(
    clientX: number,
  ): number {
    const point =
      getSvgPoint(clientX, 0);

    let closestIndex = 0;
    let closestDistance =
      Number.POSITIVE_INFINITY;

    layout.columns.forEach(
      (column) => {
        const distance =
          Math.abs(
            column.centerX -
              point.x,
          );

        if (
          distance <
          closestDistance
        ) {
          closestDistance =
            distance;
          closestIndex =
            column.index;
        }
      },
    );

    return closestIndex;
  }

  function beginSyllableDrag(
    event:
      ReactPointerEvent<SVGCircleElement>,
    syllableId: string,
  ) {
    event.preventDefault();

    svgRef.current?.setPointerCapture(
      event.pointerId,
    );

    setDragState({
      kind: "syllable",
      syllableId,
      pointerId:
        event.pointerId,
      startClientX:
        event.clientX,
      currentClientX:
        event.clientX,
    });
  }

  function beginBranchDrag(
    event:
      ReactPointerEvent<SVGCircleElement>,
    syllableId: string,
    field: BranchKind,
  ) {
    event.preventDefault();
    event.stopPropagation();

    svgRef.current?.setPointerCapture(
      event.pointerId,
    );

    setDragState({
      kind: "branch",
      syllableId,
      field,
      pointerId:
        event.pointerId,
      startClientX:
        event.clientX,
      startClientY:
        event.clientY,
      currentClientX:
        event.clientX,
      currentClientY:
        event.clientY,
    });
  }

  function handlePointerMove(
    event:
      ReactPointerEvent<SVGSVGElement>,
  ) {
    if (!dragState) {
      return;
    }

    if (
      dragState.kind ===
      "syllable"
    ) {
      setDragState({
        ...dragState,
        currentClientX:
          event.clientX,
      });
      return;
    }

    setDragState({
      ...dragState,
      currentClientX:
        event.clientX,
      currentClientY:
        event.clientY,
    });
  }

  function getBranchTarget(
    drag: BranchDrag,
  ): {
    column: LayoutColumn;
    field: BranchKind;
    distance: number;
  } | null {
    const sourceIndex =
      syllables.findIndex(
        (syllable) =>
          syllable.id ===
          drag.syllableId,
      );

    if (sourceIndex < 0) {
      return null;
    }

    const targetIndex =
      drag.field === "coda"
        ? sourceIndex + 1
        : sourceIndex - 1;

    if (
      targetIndex < 0 ||
      targetIndex >=
        layout.columns.length
    ) {
      return null;
    }

    const targetColumn =
      layout.columns[
        targetIndex
      ];

    const targetField:
      BranchKind =
      drag.field === "coda"
        ? "onset"
        : "coda";

    const targetX =
      targetField === "onset"
        ? targetColumn.onsetX
        : targetColumn.codaX;

    const targetY =
      targetField === "onset"
        ? layout.branchY
        : layout.subbranchY;

    const point =
      getSvgPoint(
        drag.currentClientX,
        drag.currentClientY,
      );

    return {
      column: targetColumn,
      field: targetField,
      distance:
        Math.hypot(
          point.x - targetX,
          point.y - targetY,
        ),
    };
  }

  function createAmbisyllabicity(
    drag: BranchDrag,
  ) {
    const sourceIndex =
      syllables.findIndex(
        (syllable) =>
          syllable.id ===
          drag.syllableId,
      );

    if (sourceIndex < 0) {
      return;
    }

    const sourceSyllable =
      syllables[sourceIndex];

    const sourceSegments =
      drag.field === "coda"
        ? sourceSyllable.coda
        : sourceSyllable.onset;

    const sourceSound =
      sourceSegments.length === 1
        ? sourceSegments[0].trim()
        : "";

    if (!sourceSound) {
      setStatus(
        "Ambisyllabicity requires a source onset or coda with exactly one sound.",
      );
      return;
    }

    const leftIndex =
      drag.field === "coda"
        ? sourceIndex
        : sourceIndex - 1;

    if (
      leftIndex < 0 ||
      leftIndex >=
        syllables.length - 1
    ) {
      return;
    }

    setSyllables(
      (previous) => {
        const next =
          cloneSyllables(previous);

        const left =
          next[leftIndex];

        const right =
          next[leftIndex + 1];

        if (drag.field === "coda") {
          left.coda = [];
          left.hasCoda = false;

          const matchingOnsetIndex =
            right.onset.findIndex(
              (segment) =>
                segment.trim() ===
                sourceSound,
            );

          if (
            matchingOnsetIndex >= 0
          ) {
            right.onset.splice(
              matchingOnsetIndex,
              1,
            );
            right.hasOnset =
              right.onset.length > 0;
          }
        } else {
          right.onset = [];
          right.hasOnset = false;

          const matchingCodaIndex =
            left.coda.findIndex(
              (segment) =>
                segment.trim() ===
                sourceSound,
            );

          if (
            matchingCodaIndex >= 0
          ) {
            left.coda.splice(
              matchingCodaIndex,
              1,
            );
            left.hasCoda =
              left.coda.length > 0;
          }
        }

        left.sharedToNext =
          sourceSound;

        return normalizeSyllables(
          next,
        );
      },
    );

    const leftId =
      syllables[leftIndex].id;

    setSelectedItem({
      type: "shared",
      syllableId: leftId,
    });

    setActiveSound({
      type: "shared",
      syllableId: leftId,
    });

    setIpaOpen(true);

    setStatus(
      "The existing single sound is now ambisyllabic; no duplicate symbol was created.",
    );
  }

  function handlePointerUp(
    event:
      ReactPointerEvent<SVGSVGElement>,
  ) {
    if (!dragState) {
      return;
    }

    if (
      dragState.kind ===
      "syllable"
    ) {
      const moved =
        Math.abs(
          dragState.currentClientX -
            dragState.startClientX,
        ) > 8;

      if (moved) {
        moveSyllableToIndex(
          dragState.syllableId,
          getNearestSyllableIndex(
            dragState.currentClientX,
          ),
        );
      } else {
        setSelectedItem({
          type: "syllable",
          syllableId:
            dragState.syllableId,
        });
        setActiveSound(null);
        setReplaceOnNextIpa(false);
        setIpaOpen(false);
        setStatus(
          "Syllable selected.",
        );
      }
    } else {
      const moved =
        Math.hypot(
          dragState.currentClientX -
            dragState.startClientX,
          dragState.currentClientY -
            dragState.startClientY,
        ) > 8;

      const target =
        getBranchTarget(
          dragState,
        );

      if (
        moved &&
        target &&
        target.distance < 76
      ) {
        createAmbisyllabicity(
          dragState,
        );
      } else {
        setSelectedItem({
          type: "branch",
          syllableId:
            dragState.syllableId,
          field:
            dragState.field,
        });
        setActiveSound(null);
        setIpaOpen(false);

        setStatus(
          moved
            ? "Drop C onto the next O, or O onto the previous C."
            : `${dragState.field} selected. Drag it to the adjacent matching branch to share a sound.`,
        );
      }
    }

    if (
      svgRef.current?.hasPointerCapture(
        event.pointerId,
      )
    ) {
      svgRef.current.releasePointerCapture(
        event.pointerId,
      );
    }

    setDragState(null);
  }

  function loadPreset(
    preset: Preset,
  ) {
    const next =
      normalizeSyllables(
        preset.syllables.map(
          (syllable) =>
            createSyllable(
              syllable,
            ),
        ),
      );

    setWord(preset.word);
    setSyllables(next);
    setSelectedItem(null);
    setActiveSound(null);
    setIpaOpen(false);
    setExamplesOpen(false);
    setStatus(
      `Loaded ${preset.name}.`,
    );
  }

  function resetCanvas() {
    setWord("Wd");
    setSyllables([
      createSyllable({
        nucleus: [""],
        primary: true,
      }),
    ]);
    setSelectedItem(null);
    setActiveSound(null);
    setIpaOpen(false);
    setZoom(1);
    setStatus(
      "Canvas reset to one blank syllable.",
    );
  }

  function startBlank() {
    resetCanvas();
  }

  function getSvgMarkup(
    transparentBackground = false,
  ): string {
    const svg = svgRef.current;

    if (!svg) {
      throw new Error(
        "Canvas is unavailable.",
      );
    }

    const clone =
      svg.cloneNode(
        true,
      ) as SVGSVGElement;

    clone.setAttribute(
      "xmlns",
      "http://www.w3.org/2000/svg",
    );

    clone.setAttribute(
      "width",
      String(layout.width),
    );

    clone.setAttribute(
      "height",
      String(layout.height),
    );

    if (transparentBackground) {
      clone
        .querySelectorAll(
          "[data-canvas-background='true']",
        )
        .forEach(
          (element) =>
            element.remove(),
        );
    }

    clone
      .querySelectorAll(
        "[data-ui-only='true']",
      )
      .forEach(
        (element) =>
          element.remove(),
      );

    clone
      .querySelectorAll<SVGElement>(
        "[data-export-fill]",
      )
      .forEach((element) => {
        element.setAttribute(
          "fill",
          element.getAttribute(
            "data-export-fill",
          ) ?? "transparent",
        );
      });

    clone
      .querySelectorAll<SVGElement>(
        "[data-export-stroke]",
      )
      .forEach((element) => {
        element.setAttribute(
          "stroke",
          element.getAttribute(
            "data-export-stroke",
          ) ?? "transparent",
        );
      });

    clone
      .querySelectorAll(
        "foreignObject[data-export-label]",
      )
      .forEach((element) => {
        const text =
          document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
          );

        text.setAttribute(
          "x",
          element.getAttribute(
            "data-x",
          ) ?? "0",
        );

        text.setAttribute(
          "y",
          element.getAttribute(
            "data-y",
          ) ?? "0",
        );

        text.setAttribute(
          "text-anchor",
          "middle",
        );

        text.setAttribute(
          "dominant-baseline",
          "middle",
        );

        text.setAttribute(
          "fill",
          element.getAttribute(
            "data-fill",
          ) ?? "#111111",
        );

        text.setAttribute(
          "font-size",
          element.getAttribute(
            "data-font-size",
          ) ?? "22",
        );

        text.setAttribute(
          "font-family",
          element.getAttribute(
            "data-font-family",
          ) ?? selectedFont.css,
        );

        text.setAttribute(
          "font-weight",
          element.getAttribute(
            "data-font-weight",
          ) ?? "800",
        );

        text.setAttribute(
          "font-style",
          element.getAttribute(
            "data-font-style",
          ) ?? "normal",
        );

        text.textContent =
          element.getAttribute(
            "data-export-label",
          ) || "∅";

        const group =
          document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
          );

        if (
          element.getAttribute(
            "data-export-box",
          ) === "rect"
        ) {
          const rectangle =
            document.createElementNS(
              "http://www.w3.org/2000/svg",
              "rect",
            );

          rectangle.setAttribute(
            "x",
            element.getAttribute("x") ?? "0",
          );
          rectangle.setAttribute(
            "y",
            element.getAttribute("y") ?? "0",
          );
          rectangle.setAttribute(
            "width",
            element.getAttribute("width") ?? "0",
          );
          rectangle.setAttribute(
            "height",
            element.getAttribute("height") ?? "0",
          );
          rectangle.setAttribute(
            "rx",
            element.getAttribute(
              "data-export-box-radius",
            ) ?? "0",
          );
          rectangle.setAttribute(
            "fill",
            element.getAttribute(
              "data-export-box-fill",
            ) ?? "transparent",
          );
          rectangle.setAttribute(
            "stroke",
            element.getAttribute(
              "data-export-box-stroke",
            ) ?? "transparent",
          );
          rectangle.setAttribute(
            "stroke-width",
            "1.5",
          );
          group.appendChild(
            rectangle,
          );
        }

        group.appendChild(text);

        element.parentNode?.replaceChild(
          group,
          element,
        );
      });

    return new XMLSerializer()
      .serializeToString(
        clone,
      );
  }

  function downloadBlob(
    blob: Blob,
    filename: string,
  ) {
    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  function safeFilename(): string {
    return (
      word
        .trim()
        .toLowerCase()
        .replace(
          /[^a-z0-9]+/g,
          "-",
        )
        .replace(
          /^-|-$/g,
          "",
        ) ||
      "syllable-tree"
    );
  }

  function downloadSvg() {
    try {
      downloadBlob(
        new Blob(
          [getSvgMarkup()],
          {
            type: "image/svg+xml",
          },
        ),
        `${safeFilename()}-tree.svg`,
      );

      setStatus(
        "SVG downloaded.",
      );
    } catch {
      setStatus(
        "Could not export SVG.",
      );
    }
  }

  function downloadPng() {
    try {
      const blob =
        new Blob(
          [getSvgMarkup(pngTransparent)],
          {
            type: "image/svg+xml",
          },
        );

      const url =
        URL.createObjectURL(blob);

      const image =
        new Image();

      image.onload = () => {
        const scale = 2;
        const canvas =
          document.createElement(
            "canvas",
          );

        canvas.width =
          layout.width * scale;

        canvas.height =
          layout.height * scale;

        const context =
          canvas.getContext("2d");

        if (!context) {
          URL.revokeObjectURL(
            url,
          );
          setStatus(
            "Could not create PNG.",
          );
          return;
        }

        context.scale(
          scale,
          scale,
        );

        context.drawImage(
          image,
          0,
          0,
        );

        canvas.toBlob(
          (pngBlob) => {
            URL.revokeObjectURL(
              url,
            );

            if (!pngBlob) {
              setStatus(
                "Could not create PNG.",
              );
              return;
            }

            downloadBlob(
              pngBlob,
              `${safeFilename()}-tree.png`,
            );

            setStatus(
              "PNG downloaded.",
            );
          },
          "image/png",
        );
      };

      image.onerror = () => {
        URL.revokeObjectURL(
          url,
        );
        setStatus(
          "Could not create PNG.",
        );
      };

      image.src = url;
    } catch {
      setStatus(
        "Could not create PNG.",
      );
    }
  }

  function getFullLatex(): string {
    return makeFullLatex(
      word,
      syllables,
      {
        fontChoice:
          fontFamily,
        fontSize:
          treeFontSize,
        bold: treeBold,
        italic:
          treeItalic,
        plainStyle,
      },
    );
  }

  function downloadLatex() {
    downloadBlob(
      new Blob(
        [getFullLatex()],
        {
          type: "application/x-tex;charset=utf-8",
        },
      ),
      `${safeFilename()}-tree.tex`,
    );
    setStatus(
      "Complete LaTeX document downloaded.",
    );
  }

  async function copyLatex() {
    const latex =
      getFullLatex();

    try {
      await navigator.clipboard.writeText(
        latex,
      );

      setStatus(
        "Complete LaTeX document copied.",
      );
    } catch {
      const textarea =
        document.createElement(
          "textarea",
        );

      textarea.value = latex;
      document.body.appendChild(
        textarea,
      );
      textarea.select();
      document.execCommand(
        "copy",
      );
      textarea.remove();

      setStatus(
        "Complete LaTeX document copied.",
      );
    }
  }

  function nodeStyle(
    kind:
      | "syllable"
      | "onset"
      | "rhyme"
      | "nucleus"
      | "coda",
    selected = false,
    dragTarget = false,
  ) {
    if (plainStyle) {
      return {
        fill:
          dragTarget
            ? "#e8e8e8"
            : "transparent",
        stroke:
          selected ||
          dragTarget
            ? "#111111"
            : "transparent",
        text: "#111111",
      };
    }

    if (kind === "syllable") {
      return {
        fill:
          selected
            ? treeColors.syllableOutline
            : treeColors.syllableFill,
        stroke:
          treeColors.syllableOutline,
        text:
          selected
            ? treeColors.wordText
            : treeColors.syllableText,
      };
    }

    if (
      kind === "onset" ||
      kind === "rhyme"
    ) {
      return {
        fill:
          selected || dragTarget
            ? treeColors.onsetRhymeOutline
            : treeColors.onsetRhymeFill,
        stroke:
          treeColors.onsetRhymeOutline,
        text:
          selected || dragTarget
            ? treeColors.wordText
            : treeColors.onsetRhymeText,
      };
    }

    return {
      fill:
        selected || dragTarget
          ? treeColors.nucleusCodaOutline
          : treeColors.nucleusCodaFill,
      stroke:
        treeColors.nucleusCodaOutline,
      text:
        selected || dragTarget
          ? treeColors.wordText
          : treeColors.nucleusCodaText,
    };
  }

  function renderTerminal(
    syllable: Syllable,
    field: SegmentField,
    value: string,
    index: number,
    x: number,
    y: number,
  ) {
    const terminalWidth =
      Math.max(
        plainStyle ? 70 : 82,
        treeFontSize *
          (plainStyle ? 3.4 : 4.0),
      );

    const terminalHeight =
      Math.max(
        plainStyle ? 40 : 44,
        treeFontSize *
          (plainStyle ? 1.9 : 2.05),
      );

    const selected =
      selectedItem?.type ===
        "segment" &&
      selectedItem.syllableId ===
        syllable.id &&
      selectedItem.field ===
        field &&
      selectedItem.index ===
        index;

    const dropBefore =
      soundDropTarget?.syllableId ===
        syllable.id &&
      soundDropTarget.field ===
        field &&
      soundDropTarget.anchorIndex ===
        index &&
      soundDropTarget.position ===
        "before";

    const dropAfter =
      soundDropTarget?.syllableId ===
        syllable.id &&
      soundDropTarget.field ===
        field &&
      soundDropTarget.anchorIndex ===
        index &&
      soundDropTarget.position ===
        "after";

    const soundLocation =
      getSoundLocationKey(
        syllable.id,
        field,
        index,
      );

    const dragging =
      soundDragSource?.type ===
        "segment" &&
      soundDragSource.syllableId ===
        syllable.id &&
      soundDragSource.field ===
        field &&
      soundDragSource.index ===
        index;

    const justLanded =
      landedSoundLocation ===
      soundLocation;

    return (
      <foreignObject
        key={`${syllable.id}-${field}-${index}`}
        x={
          x -
          terminalWidth / 2
        }
        y={
          y -
          terminalHeight / 2
        }
        width={terminalWidth}
        height={terminalHeight}
        data-x={String(x)}
        data-y={String(y)}
        data-motion-id={
          `sound-box-${soundLocation}`
        }
        data-sound-location={
          soundLocation
        }
        data-export-label={
          value || "∅"
        }
        data-fill={
          plainStyle
            ? "#111111"
            : treeColors.terminalText
        }
        data-export-box="rect"
        data-export-box-fill={
          plainStyle
            ? "transparent"
            : treeColors.terminalFill
        }
        data-export-box-stroke={
          plainStyle
            ? "transparent"
            : treeColors.terminalOutline
        }
        data-export-box-radius="10"
        data-font-size={String(
          treeFontSize,
        )}
        data-font-weight={
          treeBold
            ? "800"
            : "400"
        }
        data-font-style={
          treeItalic
            ? "italic"
            : "normal"
        }
        data-font-family={
          selectedFont.css
        }
      >
        <input
          className={`terminal-input ${
            selected
              ? "selected"
              : ""
          } ${
            dragging
              ? "sound-drag-source"
              : ""
          } ${
            justLanded
              ? "sound-just-landed"
              : ""
          } ${
            dropBefore
              ? "sound-drop-before"
              : ""
          } ${
            dropAfter
              ? "sound-drop-after"
              : ""
          } ${
            plainStyle
              ? "plain"
              : ""
          }`}
          value={value}
          placeholder="∅"
          aria-label={`Edit ${field} sound`}
          title="Drag onto O, N, or C, or drop left/right of another sound"
          draggable={Boolean(
            value.trim(),
          )}
          onDragOver={(event) =>
            handleSoundBoxDragOver(
              event,
              syllable.id,
              field,
              index,
            )
          }
          onDrop={(event) =>
            handleSoundBoxDrop(
              event,
              syllable.id,
              field,
              index,
            )
          }
          onDragStart={(event) =>
            startSoundDrag(
              event,
              {
                type: "segment",
                syllableId:
                  syllable.id,
                field,
                index,
              },
              value,
            )
          }
          onDragEnd={
            finishSoundDrag
          }
          onFocus={() =>
            selectSound({
              type: "segment",
              syllableId:
                syllable.id,
              field,
              index,
            })
          }
          onChange={(event) => {
            setReplaceOnNextIpa(false);
            updateSegment(
              syllable.id,
              field,
              index,
              event.target.value,
            );
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Delete"
            ) {
              event.preventDefault();
              removeSegment(
                syllable.id,
                field,
                index,
              );
              setSelectedItem(null);
              setStatus(
                "Sound box deleted.",
              );
            }
          }}
          style={{
            fontSize:
              `${treeFontSize}px`,
            fontWeight:
              treeBold
                ? 800
                : 400,
            fontStyle:
              treeItalic
                ? "italic"
                : "normal",
            fontFamily:
              selectedFont.css,
            color:
              plainStyle
                ? "#111111"
                : treeColors.terminalText,
            background:
              plainStyle
                ? "transparent"
                : treeColors.terminalFill,
            borderColor:
              plainStyle
                ? "transparent"
                : treeColors.terminalOutline,
          }}
        />
      </foreignObject>
    );
  }

  const lineColor =
    plainStyle
      ? "#111111"
      : treeColors.line;

  const branchDrag =
    dragState?.kind ===
    "branch"
      ? dragState
      : null;

  const branchTarget =
    branchDrag
      ? getBranchTarget(
          branchDrag,
        )
      : null;

  const nodeRadius =
    Math.max(
      21,
      treeFontSize * 0.95,
    );

  const sigmaRadius =
    nodeRadius + 3;

  const wordBoxWidth =
    Math.max(
      200,
      Math.min(
        layout.width * 0.55,
        word.length *
          treeFontSize *
          0.72 +
          64,
      ),
    );

  const wordBoxHeight =
    Math.max(
      48,
      treeFontSize * 2.25,
    );

  const treeFontWeight =
    treeBold
      ? "800"
      : "400";

  const treeFontStyle =
    treeItalic
      ? "italic"
      : "normal";

  return (
    <div className="app">
      <header className="app-header">
        <div>

          <h1>
            Syllable Tree Builder
          </h1>

          <p>
            Work directly in the tree. The
            canvas automatically balances,
            fits, and recenters after edits.
          </p>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className="primary-action"
            onClick={() =>
              insertSyllableAt(
                syllables.length,
              )
            }
          >
            + Syllable
          </button>

          <div className="menu-wrapper">
            <button
              type="button"
              className="menu-button"
              aria-expanded={
                examplesOpen
              }
              onClick={() => {
                setExamplesOpen(
                  (previous) =>
                    !previous,
                );
                setExportOpen(false);
              }}
            >
              Examples
            </button>

            {examplesOpen && (
              <div className="action-menu">
                {presets.map(
                  (preset) => (
                    <button
                      type="button"
                      key={
                        preset.name
                      }
                      onClick={() =>
                        loadPreset(
                          preset,
                        )
                      }
                    >
                      {preset.name}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  onClick={
                    startBlank
                  }
                >
                  Blank tree
                </button>
              </div>
            )}
          </div>

          <div className="menu-wrapper">
            <button
              type="button"
              className="menu-button"
              aria-expanded={
                exportOpen
              }
              onClick={() => {
                setExportOpen(
                  (previous) =>
                    !previous,
                );
                setExamplesOpen(false);
              }}
            >
              Export
            </button>

            {exportOpen && (
              <div className="action-menu export-menu">
                <label className="export-option">
                  <input
                    type="checkbox"
                    checked={
                      pngTransparent
                    }
                    onChange={(event) =>
                      setPngTransparent(
                        event.target.checked,
                      )
                    }
                  />

                  <span>
                    Transparent PNG background
                  </span>
                </label>
                <button
                  type="button"
                  onClick={
                    downloadPng
                  }
                >
                  Download PNG
                </button>

                <button
                  type="button"
                  onClick={
                    downloadSvg
                  }
                >
                  Download SVG
                </button>

                <button
                  type="button"
                  onClick={
                    downloadLatex
                  }
                >
                  Download full LaTeX
                </button>

                <button
                  type="button"
                  onClick={
                    copyLatex
                  }
                >
                  Copy full LaTeX
                </button>
              </div>
            )}
          </div>

          <label className="plain-toggle">
            <input
              type="checkbox"
              checked={plainStyle}
              onChange={(event) =>
                setPlainStyle(
                  event.target
                    .checked,
                )
              }
            />

            <span>
              Plain
            </span>
          </label>
        </div>
      </header>

      <section className="canvas-card">
        <div
          className="tree-toolbar"
          role="toolbar"
          aria-label="Tree formatting and view controls"
        >
          <div className="toolbar-group">
            <span className="toolbar-label">
              Edit
            </span>

            <button
              type="button"
              className="toolbar-text-button"
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              onClick={undo}
            >
              ↶ Undo
            </button>

            <button
              type="button"
              className="toolbar-text-button"
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              onClick={redo}
            >
              ↷ Redo
            </button>

            <button
              type="button"
              className="toolbar-text-button danger-button"
              onClick={resetCanvas}
            >
              Reset canvas
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <span className="toolbar-label">
              View
            </span>

            <button
              type="button"
              title="Zoom out"
              onClick={() =>
                setZoom(
                  (previous) =>
                    Math.max(
                      0.65,
                      previous - 0.1,
                    ),
                )
              }
            >
              −
            </button>

            <output>
              {Math.round(
                zoom * 100,
              )}
              %
            </output>

            <button
              type="button"
              title="Zoom in"
              onClick={() =>
                setZoom(
                  (previous) =>
                    Math.min(
                      1.8,
                      previous + 0.1,
                    ),
                )
              }
            >
              +
            </button>

            <button
              type="button"
              className="toolbar-text-button"
              onClick={
                fitAndCenterTree
              }
            >
              Fit & center
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <label className="font-family-control">
              <span>
                Font
              </span>

              <select
                value={fontFamily}
                onChange={(event) =>
                  setFontFamily(
                    event.target
                      .value as FontChoice,
                  )
                }
              >
                {fontOptions.map(
                  (option) => (
                    <option
                      key={option.id}
                      value={option.id}
                    >
                      {option.label}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="font-size-control">
              <span>
                Font size
              </span>

              <input
                type="range"
                min="12"
                max="30"
                step="1"
                value={
                  treeFontSize
                }
                onChange={(event) =>
                  setTreeFontSize(
                    Number(
                      event.target
                        .value,
                    ),
                  )
                }
              />

              <input
                type="number"
                min="12"
                max="30"
                value={
                  treeFontSize
                }
                onChange={(event) =>
                  setTreeFontSize(
                    Math.min(
                      30,
                      Math.max(
                        12,
                        Number(
                          event.target
                            .value,
                        ) || 12,
                      ),
                    ),
                  )
                }
                aria-label="Tree font size"
              />
            </label>

            <button
              type="button"
              className={`format-button ${
                treeBold
                  ? "active"
                  : ""
              }`}
              aria-pressed={
                treeBold
              }
              title="Bold tree text"
              onClick={() =>
                setTreeBold(
                  (previous) =>
                    !previous,
                )
              }
            >
              B
            </button>

            <button
              type="button"
              className={`format-button italic-button ${
                treeItalic
                  ? "active"
                  : ""
              }`}
              aria-pressed={
                treeItalic
              }
              title="Italic tree text"
              onClick={() =>
                setTreeItalic(
                  (previous) =>
                    !previous,
                )
              }
            >
              I
            </button>

            <button
              type="button"
              className="toolbar-text-button"
              onClick={
                resetTypography
              }
            >
              Reset text
            </button>

            <div className="color-editor-wrapper">
              <button
                type="button"
                className={`toolbar-text-button ${
                  colorsOpen
                    ? "active"
                    : ""
                }`}
                aria-expanded={
                  colorsOpen
                }
                onClick={() =>
                  setColorsOpen(
                    (previous) =>
                      !previous,
                  )
                }
              >
                Colours
              </button>

              {colorsOpen && (
                <div className="color-editor-popover">
                  <div className="color-editor-heading">
                    <div>
                      <strong>
                        Tree colours
                      </strong>

                      <span>
                        Changes appear in the canvas, PNG, and SVG.
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={
                        resetTreeColors
                      }
                    >
                      Reset
                    </button>
                  </div>

                  <div className="color-general-grid">
                    <label>
                      <span>
                        Canvas
                      </span>

                      <input
                        type="color"
                        value={
                          treeColors.canvasBackground
                        }
                        onChange={(event) =>
                          updateTreeColor(
                            "canvasBackground",
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        Lines
                      </span>

                      <input
                        type="color"
                        value={
                          treeColors.line
                        }
                        onChange={(event) =>
                          updateTreeColor(
                            "line",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                  </div>

                  <div className="color-grid-heading">
                    <span>Box</span>
                    <span>Fill</span>
                    <span>Border</span>
                    <span>Text</span>
                  </div>

                  <div className="color-group-list">
                    {colorGroups.map(
                      (group) => (
                        <div
                          className="color-group-row"
                          key={group.label}
                        >
                          <strong>
                            {group.label}
                          </strong>

                          <input
                            type="color"
                            aria-label={`${group.label} fill colour`}
                            value={
                              treeColors[
                                group.fill
                              ]
                            }
                            onChange={(event) =>
                              updateTreeColor(
                                group.fill,
                                event.target.value,
                              )
                            }
                          />

                          <input
                            type="color"
                            aria-label={`${group.label} border colour`}
                            value={
                              treeColors[
                                group.outline
                              ]
                            }
                            onChange={(event) =>
                              updateTreeColor(
                                group.outline,
                                event.target.value,
                              )
                            }
                          />

                          <input
                            type="color"
                            aria-label={`${group.label} text colour`}
                            value={
                              treeColors[
                                group.text
                              ]
                            }
                            onChange={(event) =>
                              updateTreeColor(
                                group.text,
                                event.target.value,
                              )
                            }
                          />
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className="canvas-status"
          aria-live="polite"
        >
          {status}
        </div>

        <div
          ref={canvasScrollRef}
          className="canvas-scroll"
        >
          <svg
            ref={svgRef}
            className="tree-canvas"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMin meet"
            style={{
              width:
                `${zoom * 100}%`,
              fontWeight:
                treeFontWeight,
              fontStyle:
                treeFontStyle,
              fontFamily:
                selectedFont.css,
            }}
            role="img"
            aria-label={`Editable syllable tree for ${word}`}
            onPointerMove={
              handlePointerMove
            }
            onPointerUp={
              handlePointerUp
            }
            onPointerCancel={() =>
              setDragState(null)
            }
          >
            <rect
              width={layout.width}
              height={layout.height}
              fill={
                treeColors.canvasBackground
              }
              data-canvas-background="true"
            />

            <foreignObject
              x={
                layout.rootX -
                wordBoxWidth / 2
              }
              y={
                layout.rootY -
                wordBoxHeight / 2
              }
              width={
                wordBoxWidth
              }
              height={
                wordBoxHeight
              }
              data-x={String(
                layout.rootX,
              )}
              data-y={String(
                layout.rootY,
              )}
              data-motion-id="word-node"
              data-export-label={
                word.trim() ||
                "Wd"
              }
              data-fill={
                plainStyle
                  ? "#111111"
                  : treeColors.wordText
              }
              data-export-box="rect"
              data-export-box-fill={
                plainStyle
                  ? "transparent"
                  : treeColors.wordFill
              }
              data-export-box-stroke={
                plainStyle
                  ? "transparent"
                  : treeColors.wordOutline
              }
              data-export-box-radius={String(
                wordBoxHeight / 2,
              )}
              data-font-size={String(
                treeFontSize,
              )}
              data-font-weight={
                treeFontWeight
              }
              data-font-style={
                treeFontStyle
              }
              data-font-family={
                selectedFont.css
              }
            >
              <input
                className={`word-input ${
                  plainStyle
                    ? "plain"
                    : ""
                }`}
                value={word}
                aria-label="Edit word label"
                onChange={(event) =>
                  setWord(
                    event.target
                      .value,
                  )
                }
                style={{
                  fontSize:
                    `${treeFontSize}px`,
                  fontWeight:
                    treeBold
                      ? 800
                      : 400,
                  fontStyle:
                    treeItalic
                      ? "italic"
                      : "normal",
                  fontFamily:
                    selectedFont.css,
                  color:
                    plainStyle
                      ? "#111111"
                      : treeColors.wordText,
                  background:
                    plainStyle
                      ? "transparent"
                      : treeColors.wordFill,
                  borderColor:
                    plainStyle
                      ? "transparent"
                      : treeColors.wordOutline,
                }}
              />
            </foreignObject>

            {layout.columns.map(
              (column) => {
                const syllableSelected =
                  selectedItem?.type ===
                    "syllable" &&
                  selectedItem.syllableId ===
                    column.syllable.id;

                const onsetSelected =
                  selectedItem?.type ===
                    "branch" &&
                  selectedItem.syllableId ===
                    column.syllable.id &&
                  selectedItem.field ===
                    "onset";

                const nucleusSelected =
                  selectedItem?.type ===
                    "branch" &&
                  selectedItem.syllableId ===
                    column.syllable.id &&
                  selectedItem.field ===
                    "nucleus";

                const codaSelected =
                  selectedItem?.type ===
                    "branch" &&
                  selectedItem.syllableId ===
                    column.syllable.id &&
                  selectedItem.field ===
                    "coda";

                const onsetIsTarget =
                  branchDrag?.field ===
                    "coda" &&
                  branchTarget?.column
                    .syllable.id ===
                    column.syllable.id &&
                  branchTarget.distance <
                    100;

                const codaIsTarget =
                  branchDrag?.field ===
                    "onset" &&
                  branchTarget?.column
                    .syllable.id ===
                    column.syllable.id &&
                  branchTarget.distance <
                    100;

                const onsetIsSoundTarget =
                  soundDropTarget?.syllableId ===
                    column.syllable.id &&
                  soundDropTarget.field ===
                    "onset";

                const nucleusIsSoundTarget =
                  soundDropTarget?.syllableId ===
                    column.syllable.id &&
                  soundDropTarget.field ===
                    "nucleus";

                const codaIsSoundTarget =
                  soundDropTarget?.syllableId ===
                    column.syllable.id &&
                  soundDropTarget.field ===
                    "coda";

                const sigmaStyle =
                  nodeStyle(
                    "syllable",
                    syllableSelected,
                  );

                const onsetStyle =
                  nodeStyle(
                    "onset",
                    onsetSelected,
                    onsetIsTarget ||
                      onsetIsSoundTarget,
                  );

                const rhymeStyle =
                  nodeStyle(
                    "rhyme",
                  );

                const nucleusStyle =
                  nodeStyle(
                    "nucleus",
                    nucleusSelected,
                    nucleusIsSoundTarget,
                  );

                const codaStyle =
                  nodeStyle(
                    "coda",
                    codaSelected,
                    codaIsTarget ||
                      codaIsSoundTarget,
                  );

                const wordStartY =
                  layout.rootY +
                  wordBoxHeight / 2 +
                  2;

                const sigmaEndY =
                  layout.sigmaY -
                  sigmaRadius -
                  2;

                const stressLines =
                  column.syllable.primary
                    ? getParallelLines(
                        layout.rootX,
                        wordStartY,
                        column.centerX,
                        sigmaEndY,
                      )
                    : null;

                const onsetSpacing =
                  plainStyle
                    ? 66
                    : 86;

                const nucleusSpacing =
                  plainStyle
                    ? 66
                    : 86;

                const codaSpacing =
                  plainStyle
                    ? 66
                    : 86;

                return (
                  <g
                    className="animated-tree-column"
                    data-motion-id={
                      `syllable-column-${column.syllable.id}`
                    }
                    key={
                      column.syllable
                        .id
                    }
                  >
                    {stressLines ? (
                      <>
                        <line
                          {...stressLines[0]}
                          stroke={
                            lineColor
                          }
                          data-export-stroke={
                            lineColor
                          }
                          strokeWidth="2.8"
                          strokeLinecap="round"
                        />

                        <line
                          {...stressLines[1]}
                          stroke={
                            lineColor
                          }
                          data-export-stroke={
                            lineColor
                          }
                          strokeWidth="2.8"
                          strokeLinecap="round"
                        />
                      </>
                    ) : (
                      <line
                        x1={
                          layout.rootX
                        }
                        y1={
                          wordStartY
                        }
                        x2={
                          column.centerX
                        }
                        y2={
                          sigmaEndY
                        }
                        stroke={
                          lineColor
                        }
                        data-export-stroke={
                          lineColor
                        }
                        strokeWidth="2.8"
                        strokeLinecap="round"
                      />
                    )}

                    <circle
                      cx={
                        column.centerX
                      }
                      cy={
                        layout.sigmaY
                      }
                      r={
                        sigmaRadius
                      }
                      fill={
                        sigmaStyle.fill
                      }
                      stroke={
                        sigmaStyle.stroke
                      }
                      data-export-fill={
                        nodeStyle(
                          "syllable",
                        ).fill
                      }
                      data-export-stroke={
                        nodeStyle(
                          "syllable",
                        ).stroke
                      }
                      strokeWidth="2"
                      className="tree-node sigma-node"
                      onPointerDown={(
                        event,
                      ) =>
                        beginSyllableDrag(
                          event,
                          column.syllable
                            .id,
                        )
                      }
                    />

                    <text
                      x={
                        column.centerX
                      }
                      y={
                        layout.sigmaY
                      }
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={
                        sigmaStyle.text
                      }
                      data-export-fill={
                        nodeStyle(
                          "syllable",
                        ).text
                      }
                      fontSize={
                        treeFontSize + 3
                      }
                      fontWeight={
                        treeFontWeight
                      }
                      fontStyle={
                        treeFontStyle
                      }
                      pointerEvents="none"
                    >
                      σ
                    </text>

                    {syllableSelected && (
                      <foreignObject
                        x={
                          column.centerX -
                          91
                        }
                        y={
                          layout.sigmaY +
                          34
                        }
                        width="182"
                        height="42"
                        data-ui-only="true"
                      >
                        <div className="context-toolbar">
                          <button
                            type="button"
                            className={
                              column
                                .syllable
                                .primary
                                ? "active"
                                : ""
                            }
                            title="Primary stress"
                            onClick={() =>
                              setPrimary(
                                column
                                  .syllable
                                  .id,
                              )
                            }
                          >
                            ║
                          </button>

                          <button
                            type="button"
                            title="Duplicate"
                            onClick={() =>
                              duplicateSyllable(
                                column
                                  .syllable
                                  .id,
                              )
                            }
                          >
                            ⧉
                          </button>

                          <button
                            type="button"
                            title="Delete"
                            onClick={() =>
                              deleteSyllable(
                                column
                                  .syllable
                                  .id,
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      </foreignObject>
                    )}

                    {column.onsetVisible ? (
                      <>
                        <line
                          x1={
                            column.centerX
                          }
                          y1={
                            layout.sigmaY +
                            25
                          }
                          x2={
                            column.onsetX
                          }
                          y2={
                            layout.branchY -
                            24
                          }
                          stroke={
                            lineColor
                          }
                          data-export-stroke={
                            lineColor
                          }
                          strokeWidth="2.7"
                          strokeLinecap="round"
                        />

                        <circle
                          cx={
                            column.onsetX
                          }
                          cy={
                            layout.branchY
                          }
                          r={
                            nodeRadius
                          }
                          fill={
                            onsetStyle.fill
                          }
                          stroke={
                            onsetStyle.stroke
                          }
                          data-export-fill={
                            nodeStyle(
                              "onset",
                            ).fill
                          }
                          data-export-stroke={
                            nodeStyle(
                              "onset",
                            ).stroke
                          }
                          strokeWidth="2"
                          className="tree-node branch-node"
                          onDragOver={(event) =>
                            handleSoundDragOver(
                              event,
                              column
                                .syllable
                                .id,
                              "onset",
                            )
                          }
                          onDrop={(event) =>
                            handleSoundDrop(
                              event,
                              column
                                .syllable
                                .id,
                              "onset",
                            )
                          }
                          onPointerDown={(
                            event,
                          ) =>
                            beginBranchDrag(
                              event,
                              column
                                .syllable
                                .id,
                              "onset",
                            )
                          }
                        />

                        <text
                          x={
                            column.onsetX
                          }
                          y={
                            layout.branchY
                          }
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={
                            onsetStyle.text
                          }
                          data-export-fill={
                            nodeStyle(
                              "onset",
                            ).text
                          }
                          fontSize={
                            treeFontSize
                          }
                          fontWeight={
                            treeFontWeight
                          }
                          fontStyle={
                            treeFontStyle
                          }
                          pointerEvents="none"
                        >
                          O
                        </text>

                        {column.syllable.onset.map(
                          (
                            segment,
                            index,
                          ) => {
                            const x =
                              column.onsetX -
                              ((column.syllable.onset.length -
                                1) *
                                onsetSpacing) /
                                2 +
                              index *
                                onsetSpacing;

                            return (
                              <g
                                key={`${column.syllable.id}-onset-${index}`}
                              >
                                <line
                                  x1={
                                    column.onsetX
                                  }
                                  y1={
                                    layout.branchY +
                                    22
                                  }
                                  x2={x}
                                  y2={
                                    layout.terminalY -
                                    23
                                  }
                                  stroke={
                                    lineColor
                                  }
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                />

                                {renderTerminal(
                                  column.syllable,
                                  "onset",
                                  segment,
                                  index,
                                  x,
                                  layout.terminalY,
                                )}
                              </g>
                            );
                          },
                        )}

                        {onsetSelected && (
                          <foreignObject
                            x={
                              column.onsetX -
                              71
                            }
                            y={
                              layout.branchY +
                              28
                            }
                            width="142"
                            height="38"
                            data-ui-only="true"
                          >
                            <div className="branch-toolbar">
                              <button
                                type="button"
                                onClick={() =>
                                  addSegment(
                                    column
                                      .syllable
                                      .id,
                                    "onset",
                                  )
                                }
                              >
                                + sound
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  removeBranch(
                                    column
                                      .syllable
                                      .id,
                                    "onset",
                                  )
                                }
                              >
                                remove
                              </button>
                            </div>
                          </foreignObject>
                        )}
                      </>
                    ) : (
                      <g
                        className="ghost-node"
                        data-ui-only="true"
                        onDragOver={(event) =>
                          handleSoundDragOver(
                            event,
                            column
                              .syllable
                              .id,
                            "onset",
                          )
                        }
                        onDrop={(event) =>
                          handleSoundDrop(
                            event,
                            column
                              .syllable
                              .id,
                            "onset",
                          )
                        }
                        onClick={() => {
                          setBranchVisible(
                            column
                              .syllable
                              .id,
                            "onset",
                            true,
                          );
                          setSelectedItem({
                            type:
                              "branch",
                            syllableId:
                              column
                                .syllable
                                .id,
                            field:
                              "onset",
                          });
                          setStatus(
                            "Onset added.",
                          );
                        }}
                      >
                        <line
                          x1={
                            column.centerX
                          }
                          y1={
                            layout.sigmaY +
                            25
                          }
                          x2={
                            column.onsetX
                          }
                          y2={
                            layout.branchY -
                            24
                          }
                          stroke="#a8a29a"
                          strokeWidth="1.6"
                          strokeDasharray="5 5"
                        />

                        <circle
                          cx={
                            column.onsetX
                          }
                          cy={
                            layout.branchY
                          }
                          r="20"
                          fill="#fffdf9"
                          stroke="#a8a29a"
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                        />

                        <text
                          x={
                            column.onsetX
                          }
                          y={
                            layout.branchY
                          }
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#78716c"
                          fontSize={
                            Math.max(
                              13,
                              treeFontSize - 5,
                            )
                          }
                          fontWeight={
                            treeFontWeight
                          }
                          fontStyle={
                            treeFontStyle
                          }
                        >
                          +O
                        </text>
                      </g>
                    )}

                    <line
                      x1={
                        column.centerX
                      }
                      y1={
                        layout.sigmaY +
                        25
                      }
                      x2={
                        column.rhymeX
                      }
                      y2={
                        layout.branchY -
                        24
                      }
                      stroke={
                        lineColor
                      }
                      strokeWidth="2.7"
                      strokeLinecap="round"
                    />

                    <circle
                      cx={
                        column.rhymeX
                      }
                      cy={
                        layout.branchY
                      }
                      r={
                        nodeRadius
                      }
                      fill={
                        rhymeStyle.fill
                      }
                      stroke={
                        rhymeStyle.stroke
                      }
                      strokeWidth="2"
                    />

                    <text
                      x={
                        column.rhymeX
                      }
                      y={
                        layout.branchY
                      }
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={
                        rhymeStyle.text
                      }
                      fontSize={
                        treeFontSize
                      }
                      fontWeight={
                        treeFontWeight
                      }
                      fontStyle={
                        treeFontStyle
                      }
                    >
                      R
                    </text>

                    <line
                      x1={
                        column.rhymeX
                      }
                      y1={
                        layout.branchY +
                        22
                      }
                      x2={
                        column.nucleusX
                      }
                      y2={
                        layout.subbranchY -
                        23
                      }
                      stroke={
                        lineColor
                      }
                      strokeWidth="2.6"
                      strokeLinecap="round"
                    />

                    <circle
                      cx={
                        column.nucleusX
                      }
                      cy={
                        layout.subbranchY
                      }
                      r={
                        nodeRadius
                      }
                      fill={
                        nucleusStyle.fill
                      }
                      stroke={
                        nucleusStyle.stroke
                      }
                      strokeWidth="2"
                      className="tree-node"
                      onDragOver={(event) =>
                        handleSoundDragOver(
                          event,
                          column
                            .syllable
                            .id,
                          "nucleus",
                        )
                      }
                      onDrop={(event) =>
                        handleSoundDrop(
                          event,
                          column
                            .syllable
                            .id,
                          "nucleus",
                        )
                      }
                      onClick={() => {
                        setSelectedItem({
                          type:
                            "branch",
                          syllableId:
                            column
                              .syllable
                              .id,
                          field:
                            "nucleus",
                        });
                        setActiveSound(null);
                        setIpaOpen(false);
                      }}
                    />

                    <text
                      x={
                        column.nucleusX
                      }
                      y={
                        layout.subbranchY
                      }
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={
                        nucleusStyle.text
                      }
                      fontSize={
                        treeFontSize
                      }
                      fontWeight={
                        treeFontWeight
                      }
                      fontStyle={
                        treeFontStyle
                      }
                      pointerEvents="none"
                    >
                      N
                    </text>

                    {column.syllable.nucleus.map(
                      (
                        segment,
                        index,
                      ) => {
                        const x =
                          column.nucleusX -
                          ((column.syllable.nucleus.length -
                            1) *
                            nucleusSpacing) /
                            2 +
                          index *
                            nucleusSpacing;

                        return (
                          <g
                            key={`${column.syllable.id}-nucleus-${index}`}
                          >
                            <line
                              x1={
                                column.nucleusX
                              }
                              y1={
                                layout.subbranchY +
                                22
                              }
                              x2={x}
                              y2={
                                layout.terminalY -
                                23
                              }
                              stroke={
                                lineColor
                              }
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            />

                            {renderTerminal(
                              column.syllable,
                              "nucleus",
                              segment,
                              index,
                              x,
                              layout.terminalY,
                            )}
                          </g>
                        );
                      },
                    )}

                    {nucleusSelected && (
                      <foreignObject
                        x={
                          column.nucleusX -
                          71
                        }
                        y={
                          layout.subbranchY +
                          28
                        }
                        width="142"
                        height="38"
                        data-ui-only="true"
                      >
                        <div className="branch-toolbar">
                          <button
                            type="button"
                            onClick={() =>
                              addSegment(
                                column
                                  .syllable
                                  .id,
                                "nucleus",
                              )
                            }
                          >
                            + sound
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              removeBranch(
                                column
                                  .syllable
                                  .id,
                                "nucleus",
                              )
                            }
                          >
                            clear
                          </button>
                        </div>
                      </foreignObject>
                    )}

                    {column.codaVisible ? (
                      <>
                        <line
                          x1={
                            column.rhymeX
                          }
                          y1={
                            layout.branchY +
                            22
                          }
                          x2={
                            column.codaX
                          }
                          y2={
                            layout.subbranchY -
                            23
                          }
                          stroke={
                            lineColor
                          }
                          data-export-stroke={
                            lineColor
                          }
                          strokeWidth="2.6"
                          strokeLinecap="round"
                        />

                        <circle
                          cx={
                            column.codaX
                          }
                          cy={
                            layout.subbranchY
                          }
                          r={
                            nodeRadius
                          }
                          fill={
                            codaStyle.fill
                          }
                          stroke={
                            codaStyle.stroke
                          }
                          data-export-fill={
                            nodeStyle(
                              "coda",
                            ).fill
                          }
                          data-export-stroke={
                            nodeStyle(
                              "coda",
                            ).stroke
                          }
                          strokeWidth="2"
                          className="tree-node branch-node"
                          onDragOver={(event) =>
                            handleSoundDragOver(
                              event,
                              column
                                .syllable
                                .id,
                              "coda",
                            )
                          }
                          onDrop={(event) =>
                            handleSoundDrop(
                              event,
                              column
                                .syllable
                                .id,
                              "coda",
                            )
                          }
                          onPointerDown={(
                            event,
                          ) =>
                            beginBranchDrag(
                              event,
                              column
                                .syllable
                                .id,
                              "coda",
                            )
                          }
                        />

                        <text
                          x={
                            column.codaX
                          }
                          y={
                            layout.subbranchY
                          }
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={
                            codaStyle.text
                          }
                          data-export-fill={
                            nodeStyle(
                              "coda",
                            ).text
                          }
                          fontSize={
                            treeFontSize
                          }
                          fontWeight={
                            treeFontWeight
                          }
                          fontStyle={
                            treeFontStyle
                          }
                          pointerEvents="none"
                        >
                          C
                        </text>

                        {column.syllable.coda.map(
                          (
                            segment,
                            index,
                          ) => {
                            const x =
                              column.codaX -
                              ((column.syllable.coda.length -
                                1) *
                                codaSpacing) /
                                2 +
                              index *
                                codaSpacing;

                            return (
                              <g
                                key={`${column.syllable.id}-coda-${index}`}
                              >
                                <line
                                  x1={
                                    column.codaX
                                  }
                                  y1={
                                    layout.subbranchY +
                                    22
                                  }
                                  x2={x}
                                  y2={
                                    layout.terminalY -
                                    23
                                  }
                                  stroke={
                                    lineColor
                                  }
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                />

                                {renderTerminal(
                                  column.syllable,
                                  "coda",
                                  segment,
                                  index,
                                  x,
                                  layout.terminalY,
                                )}
                              </g>
                            );
                          },
                        )}

                        {codaSelected && (
                          <foreignObject
                            x={
                              column.codaX -
                              71
                            }
                            y={
                              layout.subbranchY +
                              28
                            }
                            width="142"
                            height="38"
                            data-ui-only="true"
                          >
                            <div className="branch-toolbar">
                              <button
                                type="button"
                                onClick={() =>
                                  addSegment(
                                    column
                                      .syllable
                                      .id,
                                    "coda",
                                  )
                                }
                              >
                                + sound
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  removeBranch(
                                    column
                                      .syllable
                                      .id,
                                    "coda",
                                  )
                                }
                              >
                                remove
                              </button>
                            </div>
                          </foreignObject>
                        )}
                      </>
                    ) : (
                      <g
                        className="ghost-node"
                        data-ui-only="true"
                        onDragOver={(event) =>
                          handleSoundDragOver(
                            event,
                            column
                              .syllable
                              .id,
                            "coda",
                          )
                        }
                        onDrop={(event) =>
                          handleSoundDrop(
                            event,
                            column
                              .syllable
                              .id,
                            "coda",
                          )
                        }
                        onClick={() => {
                          setBranchVisible(
                            column
                              .syllable
                              .id,
                            "coda",
                            true,
                          );
                          setSelectedItem({
                            type:
                              "branch",
                            syllableId:
                              column
                                .syllable
                                .id,
                            field:
                              "coda",
                          });
                          setStatus(
                            "Coda added.",
                          );
                        }}
                      >
                        <line
                          x1={
                            column.rhymeX
                          }
                          y1={
                            layout.branchY +
                            22
                          }
                          x2={
                            column.codaX
                          }
                          y2={
                            layout.subbranchY -
                            23
                          }
                          stroke="#a8a29a"
                          strokeWidth="1.6"
                          strokeDasharray="5 5"
                        />

                        <circle
                          cx={
                            column.codaX
                          }
                          cy={
                            layout.subbranchY
                          }
                          r="20"
                          fill="#fffdf9"
                          stroke="#a8a29a"
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                        />

                        <text
                          x={
                            column.codaX
                          }
                          y={
                            layout.subbranchY
                          }
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#78716c"
                          fontSize={
                            Math.max(
                              13,
                              treeFontSize - 5,
                            )
                          }
                          fontWeight={
                            treeFontWeight
                          }
                          fontStyle={
                            treeFontStyle
                          }
                        >
                          +C
                        </text>
                      </g>
                    )}
                  </g>
                );
              },
            )}

            {layout.columns
              .slice(0, -1)
              .map(
                (
                  column,
                  index,
                ) => {
                  const next =
                    layout.columns[
                      index + 1
                    ];

                  const shared =
                    column.syllable
                      .sharedToNext;

                  if (!shared) {
                    return null;
                  }

                  const sharedX =
                    (column.codaX +
                      next.onsetX) /
                    2;

                  const selected =
                    selectedItem?.type ===
                      "shared" &&
                    selectedItem.syllableId ===
                      column.syllable.id;

                  return (
                    <g
                      key={`shared-${column.syllable.id}`}
                    >
                      <line
                        x1={
                          column.codaX
                        }
                        y1={
                          layout.subbranchY +
                          22
                        }
                        x2={sharedX}
                        y2={
                          layout.terminalY -
                          23
                        }
                        stroke={
                          lineColor
                        }
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />

                      <line
                        x1={
                          next.onsetX
                        }
                        y1={
                          layout.branchY +
                          22
                        }
                        x2={sharedX}
                        y2={
                          layout.terminalY -
                          23
                        }
                        stroke={
                          lineColor
                        }
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />

                      <foreignObject
                        x={
                          sharedX - 38
                        }
                        y={
                          layout.terminalY -
                          21
                        }
                        width="76"
                        height="42"
                        data-x={String(
                          sharedX,
                        )}
                        data-y={String(
                          layout.terminalY,
                        )}
                        data-motion-id={
                          `shared-box-${column.syllable.id}`
                        }
                        data-sound-location={
                          getSharedLocationKey(
                            column.syllable.id,
                          )
                        }
                        data-export-label={
                          shared
                        }
                        data-fill={
                          plainStyle
                            ? "#111111"
                            : treeColors.sharedText
                        }
                        data-export-box="rect"
                        data-export-box-fill={
                          plainStyle
                            ? "transparent"
                            : treeColors.sharedFill
                        }
                        data-export-box-stroke={
                          plainStyle
                            ? "transparent"
                            : treeColors.sharedOutline
                        }
                        data-export-box-radius="10"
                        data-font-size={String(
                          treeFontSize,
                        )}
                        data-font-weight={
                          treeFontWeight
                        }
                        data-font-style={
                          treeFontStyle
                        }
                        data-font-family={
                          selectedFont.css
                        }
                      >
                        <input
                          className={`shared-input ${
                            selected
                              ? "selected"
                              : ""
                          } ${
                            soundDragSource?.type ===
                              "shared" &&
                            soundDragSource.syllableId ===
                              column.syllable.id
                              ? "sound-drag-source"
                              : ""
                          } ${
                            landedSoundLocation ===
                              getSharedLocationKey(
                                column.syllable.id,
                              )
                              ? "sound-just-landed"
                              : ""
                          } ${
                            plainStyle
                              ? "plain"
                              : ""
                          }`}
                          value={shared}
                          aria-label="Edit ambisyllabic sound"
                          title="Drag this shared sound box onto O, N, or C"
                          draggable={Boolean(
                            shared.trim(),
                          )}
                          onDragStart={(event) =>
                            startSoundDrag(
                              event,
                              {
                                type:
                                  "shared",
                                syllableId:
                                  column
                                    .syllable
                                    .id,
                              },
                              shared,
                            )
                          }
                          onDragEnd={
                            finishSoundDrag
                          }
                          onFocus={() =>
                            selectSound({
                              type:
                                "shared",
                              syllableId:
                                column
                                  .syllable
                                  .id,
                            })
                          }
                          onChange={(
                            event,
                          ) => {
                            setReplaceOnNextIpa(false);
                            setSharedSegment(
                              column
                                .syllable
                                .id,
                              event.target
                                .value,
                            );
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Delete"
                            ) {
                              event.preventDefault();
                              setSharedSegment(
                                column
                                  .syllable
                                  .id,
                                "",
                              );
                              setSelectedItem(null);
                              setActiveSound(null);
                              setIpaOpen(false);
                              setStatus(
                                "Shared sound box deleted.",
                              );
                            }
                          }}
                          style={{
                            fontSize:
                              `${treeFontSize}px`,
                            fontWeight:
                              treeBold
                                ? 800
                                : 400,
                            fontStyle:
                              treeItalic
                                ? "italic"
                                : "normal",
                            fontFamily:
                              selectedFont.css,
                            color:
                              plainStyle
                                ? "#111111"
                                : treeColors.sharedText,
                            background:
                              plainStyle
                                ? "transparent"
                                : treeColors.sharedFill,
                            borderColor:
                              plainStyle
                                ? "transparent"
                                : treeColors.sharedOutline,
                          }}
                        />
                      </foreignObject>

                      {selected && (
                        <foreignObject
                          x={
                            sharedX - 46
                          }
                          y={
                            layout.terminalY +
                            29
                          }
                          width="92"
                          height="34"
                          data-ui-only="true"
                        >
                          <button
                            type="button"
                            className="remove-shared-button"
                            onClick={() => {
                              setSharedSegment(
                                column
                                  .syllable
                                  .id,
                                "",
                              );
                              setSelectedItem(
                                null,
                              );
                              setActiveSound(
                                null,
                              );
                              setIpaOpen(
                                false,
                              );
                            }}
                          >
                            Remove shared
                          </button>
                        </foreignObject>
                      )}
                    </g>
                  );
                },
              )}

            {layout.insertionXs.map(
              (
                insertionX,
                index,
              ) => (
                <foreignObject
                  key={`insert-${index}`}
                  x={
                    insertionX - 24
                  }
                  y="108"
                  width="48"
                  height="38"
                  data-ui-only="true"
                >
                  <button
                    type="button"
                    className="insert-button"
                    title="Insert syllable here"
                    onClick={() =>
                      insertSyllableAt(
                        index,
                      )
                    }
                  >
                    +σ
                  </button>
                </foreignObject>
              ),
            )}

            {branchDrag && (
              <line
                x1={
                  branchDrag.field ===
                  "onset"
                    ? layout.columns.find(
                        (column) =>
                          column
                            .syllable
                            .id ===
                          branchDrag.syllableId,
                      )?.onsetX ??
                      0
                    : layout.columns.find(
                        (column) =>
                          column
                            .syllable
                            .id ===
                          branchDrag.syllableId,
                      )?.codaX ??
                      0
                }
                y1={
                  branchDrag.field ===
                  "onset"
                    ? layout.branchY
                    : layout.subbranchY
                }
                x2={
                  getSvgPoint(
                    branchDrag.currentClientX,
                    branchDrag.currentClientY,
                  ).x
                }
                y2={
                  getSvgPoint(
                    branchDrag.currentClientX,
                    branchDrag.currentClientY,
                  ).y
                }
                stroke="#d99a2b"
                strokeWidth="3"
                strokeDasharray="7 6"
                pointerEvents="none"
                data-ui-only="true"
              />
            )}
          </svg>
        </div>

        <div className="quick-help">
          <span>
            Click σ for syllable actions
          </span>

          <span>
            Drag σ to reorder
          </span>

          <span>
            Drag C onto next O to share
          </span>

          <span>
            Drag sound boxes onto O, N, or C
          </span>
        </div>

        {ipaOpen && activeSound && (
          <section
            className="ipa-keyboard"
            aria-label="IPA keyboard"
          >
            <div className="ipa-keyboard-heading">
              <div>
                <strong>
                  IPA keyboard
                </strong>

                <span>
                  Editing:{" "}
                  <b>
                    {getActiveSoundValue() ||
                      "empty sound"}
                  </b>
                </span>
              </div>

              <button
                type="button"
                className="close-ipa"
                onClick={() =>
                  setIpaOpen(
                    false,
                  )
                }
              >
                Close
              </button>
            </div>

            <div className="ipa-tabs">
              {(
                Object.keys(
                  ipaCharts,
                ) as IpaChart[]
              ).map((chart) => (
                <button
                  type="button"
                  className={
                    ipaGroup ===
                    chart
                      ? "active"
                      : ""
                  }
                  key={chart}
                  onClick={() =>
                    setIpaGroup(
                      chart,
                    )
                  }
                >
                  {chart}
                </button>
              ))}
            </div>

            <div
              className={`ipa-chart ${
                ipaGroup ===
                "Vowels"
                  ? "vowel-chart"
                  : ""
              }`}
            >
              {ipaCharts[
                ipaGroup
              ].map((row) => (
                <div
                  className="ipa-chart-row"
                  key={row.label}
                >
                  <div className="ipa-row-label">
                    {row.label}
                  </div>

                  <div className="ipa-row-symbols">
                    {row.cells.map(
                      (
                        cell,
                        cellIndex,
                      ) => (
                        <div
                          className="ipa-chart-cell"
                          key={`${row.label}-${cellIndex}`}
                        >
                          {cell
                            .split(
                              /\s+/,
                            )
                            .filter(
                              Boolean,
                            )
                            .map(
                              (
                                symbol,
                              ) => (
                                <button
                                  type="button"
                                  key={`${row.label}-${cellIndex}-${symbol}`}
                                  onClick={() =>
                                    insertIpa(
                                      symbol,
                                    )
                                  }
                                >
                                  {
                                    symbol
                                  }
                                </button>
                              ),
                            )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="ipa-keyboard-functions">
              <button
                type="button"
                onClick={
                  backspaceIpa
                }
              >
                ⌫ Backspace
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveSoundValue(
                    "",
                  )
                }
              >
                Clear current
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

export default App;
