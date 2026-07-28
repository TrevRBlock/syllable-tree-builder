import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
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

type BranchKind =
  | "onset"
  | "coda";

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
  "syllable-tree-builder-state-v5";

const ipaGroups = {
  "Consonants": [
    "p", "b", "t", "d", "k", "ɡ",
    "f", "v", "θ", "ð", "s", "z",
    "ʃ", "ʒ", "h", "tʃ", "dʒ",
    "m", "n", "ŋ", "l", "ɹ", "j", "w",
  ],
  "Vowels": [
    "i", "ɪ", "eɪ", "ɛ", "æ", "ə",
    "ɚ", "ʌ", "ɑ", "ɔ", "oʊ", "ʊ",
    "u", "aɪ", "aʊ", "ɔɪ",
  ],
  "Other": [
    "ɾ", "ʔ", "ɫ", "ɝ", "ː", "̃",
  ],
} as const;

type IpaGroup =
  keyof typeof ipaGroups;

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

function loadInitialState(): {
  word: string;
  syllables: Syllable[];
  plainStyle: boolean;
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
    };
  } catch {
    const preset = presets[0];

    return {
      word: preset.word,
      syllables:
        normalizeSyllables(
          preset.syllables.map(
            (syllable) =>
              createSyllable(
                syllable,
              ),
          ),
        ),
      plainStyle: false,
    };
  }
}

function buildLayout(
  syllables: readonly Syllable[],
): CanvasLayout {
  const width = Math.max(
    900,
    syllables.length * 285 + 210,
  );

  const height = 620;
  const rootX = width / 2;
  const rootY = 56;
  const sigmaY = 170;
  const branchY = 300;
  const subbranchY = 405;
  const terminalY = 520;

  const centers =
    syllables.map(
      (_, index) =>
        ((index + 1) * width) /
        (syllables.length + 1),
    );

  const columns =
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

        const centerX =
          centers[index];

        const onsetX =
          centerX - 64;

        const rhymeX =
          onsetVisible
            ? centerX + 50
            : centerX;

        const nucleusX =
          codaVisible
            ? rhymeX - 40
            : rhymeX;

        const codaX =
          rhymeX + 58;

        return {
          syllable,
          index,
          centerX,
          onsetX,
          rhymeX,
          nucleusX,
          codaX,
          onsetVisible,
          codaVisible,
        };
      },
    );

  const insertionXs: number[] = [];

  if (centers.length === 1) {
    insertionXs.push(
      centers[0] - 145,
      centers[0] + 145,
    );
  } else {
    insertionXs.push(
      Math.max(
        42,
        centers[0] -
          (centers[1] -
            centers[0]) /
            2,
      ),
    );

    for (
      let index = 0;
      index <
      centers.length - 1;
      index += 1
    ) {
      insertionXs.push(
        (centers[index] +
          centers[index + 1]) /
          2,
      );
    }

    insertionXs.push(
      Math.min(
        width - 42,
        centers[
          centers.length - 1
        ] +
          (centers[
            centers.length - 1
          ] -
            centers[
              centers.length - 2
            ]) /
            2,
      ),
    );
  }

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
            `\\draw (${onsetName}${
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
                      `[${escapeLatex(
                        segment ||
                          "\\varnothing",
                      )}]`,
                  )
                  .join(" ")
              : "[\\varnothing]"
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

        return `[\\sigma${sigmaOptions} ${onsetTree} [R ${nucleusTree} ${codaTree}]]`;
      },
    );

  return `\\begin{forest}
[${escapeLatex(
    word.trim() || "Word",
  )}
${syllableTrees.join("\n")}
]
${extraDraws.join("\n")}
\\end{forest}`;
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
    ipaOpen,
    setIpaOpen,
  ] = useState(false);

  const [
    ipaGroup,
    setIpaGroup,
  ] =
    useState<IpaGroup>(
      "Consonants",
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

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        word,
        syllables,
        plainStyle,
      }),
    );
  }, [
    word,
    syllables,
    plainStyle,
  ]);

  const layout = useMemo(
    () =>
      buildLayout(syllables),
    [syllables],
  );

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
    setIpaOpen(false);
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

    setActiveSoundValue(
      `${getActiveSoundValue()}${symbol}`,
    );
  }

  function backspaceIpa() {
    const current =
      getActiveSoundValue();

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
          previous.map(
            (syllable) => ({
              ...syllable,
              onset: [
                ...syllable.onset,
              ],
              nucleus: [
                ...syllable.nucleus,
              ],
              coda: [
                ...syllable.coda,
              ],
            }),
          );

        const left =
          next[leftIndex];

        const right =
          next[leftIndex + 1];

        const codaValue =
          left.coda.at(-1) ?? "";

        const onsetValue =
          right.onset[0] ?? "";

        const shared =
          codaValue ||
          onsetValue ||
          "x";

        if (
          codaValue &&
          codaValue === shared
        ) {
          left.coda =
            left.coda.slice(
              0,
              -1,
            );
        }

        if (
          onsetValue &&
          onsetValue === shared
        ) {
          right.onset =
            right.onset.slice(
              1,
            );
        }

        left.hasCoda =
          left.coda.length > 0;

        right.hasOnset =
          right.onset.length > 0;

        left.sharedToNext =
          shared;

        return normalizeSyllables(
          next,
        );
      },
    );

    const leftId =
      syllables[leftIndex].id;

    setSelectedItem({
      type: "shared",
      syllableId:
        leftId,
    });

    setActiveSound({
      type: "shared",
      syllableId:
        leftId,
    });

    setIpaOpen(true);

    setStatus(
      "Ambisyllabicity created. Edit the shared sound directly.",
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

  function startBlank() {
    setWord("word");
    setSyllables([
      createSyllable({
        primary: true,
      }),
    ]);
    setSelectedItem(null);
    setActiveSound(null);
    setIpaOpen(false);
    setStatus(
      "Blank tree created.",
    );
  }

  function getSvgMarkup(): string {
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

    clone
      .querySelectorAll(
        "[data-ui-only='true']",
      )
      .forEach(
        (element) =>
          element.remove(),
      );

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
          '"Segoe UI", "Arial Unicode MS", sans-serif',
        );

        text.setAttribute(
          "font-weight",
          "800",
        );

        text.textContent =
          element.getAttribute(
            "data-export-label",
          ) || "∅";

        element.parentNode?.replaceChild(
          text,
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
          [getSvgMarkup()],
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

  async function copyLatex() {
    const latex =
      makeLatexTree(
        word,
        syllables,
      );

    try {
      await navigator.clipboard.writeText(
        latex,
      );

      setStatus(
        "Forest LaTeX copied.",
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
        "Forest LaTeX copied.",
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
            ? "#df6b55"
            : "#faece8",
        stroke: "#df6b55",
        text:
          selected
            ? "#ffffff"
            : "#b94f3d",
      };
    }

    if (
      kind === "onset" ||
      kind === "rhyme"
    ) {
      return {
        fill:
          selected ||
          dragTarget
            ? "#269688"
            : "#e6f3f1",
        stroke: "#269688",
        text:
          selected ||
          dragTarget
            ? "#ffffff"
            : "#1d746a",
      };
    }

    return {
      fill:
        selected ||
        dragTarget
          ? "#2f7ca8"
          : "#e8f1f6",
      stroke: "#2f7ca8",
      text:
        selected ||
        dragTarget
          ? "#ffffff"
          : "#246587",
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
    const selected =
      selectedItem?.type ===
        "segment" &&
      selectedItem.syllableId ===
        syllable.id &&
      selectedItem.field ===
        field &&
      selectedItem.index ===
        index;

    return (
      <foreignObject
        key={`${syllable.id}-${field}-${index}`}
        x={x - 35}
        y={y - 20}
        width="70"
        height="40"
        data-x={String(x)}
        data-y={String(y)}
        data-export-label={
          value || "∅"
        }
        data-fill={
          plainStyle
            ? "#111111"
            : "#b94f3d"
        }
        data-font-size="23"
      >
        <input
          className={`terminal-input ${
            selected
              ? "selected"
              : ""
          } ${
            plainStyle
              ? "plain"
              : ""
          }`}
          value={value}
          placeholder="∅"
          aria-label={`Edit ${field} sound`}
          onFocus={() =>
            selectSound({
              type: "segment",
              syllableId:
                syllable.id,
              field,
              index,
            })
          }
          onChange={(event) =>
            updateSegment(
              syllable.id,
              field,
              index,
              event.target.value,
            )
          }
        />
      </foreignObject>
    );
  }

  const lineColor =
    plainStyle
      ? "#111111"
      : "#268b72";

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

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="version-badge">
            V5 SIMPLIFIED CANVAS
          </p>

          <h1>
            Syllable Tree Builder
          </h1>

          <p>
            Work directly in the tree.
            Controls appear only for the
            item you select.
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
              <div className="action-menu">
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
                    copyLatex
                  }
                >
                  Copy LaTeX
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
          className="canvas-status"
          aria-live="polite"
        >
          {status}
        </div>

        <div className="canvas-scroll">
          <svg
            ref={svgRef}
            className="tree-canvas"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
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
              fill="#fffdf9"
            />

            <foreignObject
              x={
                layout.rootX - 100
              }
              y={
                layout.rootY - 24
              }
              width="200"
              height="48"
              data-x={String(
                layout.rootX,
              )}
              data-y={String(
                layout.rootY,
              )}
              data-export-label={
                word.trim() ||
                "Word"
              }
              data-fill={
                plainStyle
                  ? "#111111"
                  : "#ffffff"
              }
              data-font-size="18"
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

                const sigmaStyle =
                  nodeStyle(
                    "syllable",
                    syllableSelected,
                  );

                const onsetStyle =
                  nodeStyle(
                    "onset",
                    onsetSelected,
                    onsetIsTarget,
                  );

                const rhymeStyle =
                  nodeStyle(
                    "rhyme",
                  );

                const nucleusStyle =
                  nodeStyle(
                    "nucleus",
                    nucleusSelected,
                  );

                const codaStyle =
                  nodeStyle(
                    "coda",
                    codaSelected,
                    codaIsTarget,
                  );

                const wordStartY =
                  layout.rootY + 26;

                const sigmaEndY =
                  layout.sigmaY - 26;

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
                  66;

                const nucleusSpacing =
                  66;

                const codaSpacing =
                  66;

                return (
                  <g
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
                          strokeWidth="2.8"
                          strokeLinecap="round"
                        />

                        <line
                          {...stressLines[1]}
                          stroke={
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
                      r="24"
                      fill={
                        sigmaStyle.fill
                      }
                      stroke={
                        sigmaStyle.stroke
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
                      fontSize="23"
                      fontWeight="800"
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
                          r="21"
                          fill={
                            onsetStyle.fill
                          }
                          stroke={
                            onsetStyle.stroke
                          }
                          strokeWidth="2"
                          className="tree-node branch-node"
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
                          fontSize="20"
                          fontWeight="800"
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
                          fontSize="14"
                          fontWeight="800"
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
                      r="21"
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
                      fontSize="20"
                      fontWeight="800"
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
                      r="21"
                      fill={
                        nucleusStyle.fill
                      }
                      stroke={
                        nucleusStyle.stroke
                      }
                      strokeWidth="2"
                      className="tree-node"
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
                      fontSize="20"
                      fontWeight="800"
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
                          r="21"
                          fill={
                            codaStyle.fill
                          }
                          stroke={
                            codaStyle.stroke
                          }
                          strokeWidth="2"
                          className="tree-node branch-node"
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
                          fontSize="20"
                          fontWeight="800"
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
                          fontSize="14"
                          fontWeight="800"
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
                        data-export-label={
                          shared
                        }
                        data-fill={
                          plainStyle
                            ? "#111111"
                            : "#a97418"
                        }
                        data-font-size="23"
                      >
                        <input
                          className={`shared-input ${
                            selected
                              ? "selected"
                              : ""
                          } ${
                            plainStyle
                              ? "plain"
                              : ""
                          }`}
                          value={shared}
                          aria-label="Edit ambisyllabic sound"
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
                          ) =>
                            setSharedSegment(
                              column
                                .syllable
                                .id,
                              event.target
                                .value,
                            )
                          }
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
            Click a sound for IPA keys
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
                  ipaGroups,
                ) as IpaGroup[]
              ).map((group) => (
                <button
                  type="button"
                  className={
                    ipaGroup ===
                    group
                      ? "active"
                      : ""
                  }
                  key={group}
                  onClick={() =>
                    setIpaGroup(
                      group,
                    )
                  }
                >
                  {group}
                </button>
              ))}
            </div>

            <div className="ipa-keys">
              {ipaGroups[
                ipaGroup
              ].map((symbol) => (
                <button
                  type="button"
                  key={symbol}
                  onClick={() =>
                    insertIpa(
                      symbol,
                    )
                  }
                >
                  {symbol}
                </button>
              ))}

              <button
                type="button"
                className="ipa-function"
                onClick={
                  backspaceIpa
                }
              >
                ⌫
              </button>

              <button
                type="button"
                className="ipa-function"
                onClick={() =>
                  setActiveSoundValue(
                    "",
                  )
                }
              >
                Clear
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

export default App;
