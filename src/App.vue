<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  type Ref,
} from "vue";
import { signInAnonymously } from "firebase/auth";
import {
  onValue,
  ref as databaseRef,
  type Unsubscribe,
} from "firebase/database";
import { type MessagePayload } from "firebase/messaging";
import MarketChart from "./components/MarketChart.vue";
import { classifySignal } from "./lib/engine";
import { auth, rtdb } from "./lib/firebase";
import {
  applyConfigVersion,
  loadDashboardSnapshot,
  saveWindowOptimization,
  saveConfigCandidate,
  type ConfigVersionRecord,
  type DashboardSnapshot,
  type DashboardSource,
  type MarketSnapshotRecord,
  type TradeWindowRecord,
} from "./lib/dashboard";
import {
  currentMarketDayKey,
  formatMarketDayLabel,
  marketDayKeyForTimestamp,
} from "./lib/market-day";
import {
  loadPersistedChoice,
  loadPersistedString,
  persistChoice,
} from "./lib/persistence";
import {
  chartIntervals as chartIntervalOptions,
  marketChartGroups,
  marketCharts as marketChartDefs,
} from "./lib/chart-definitions";
import {
  CONFIG_VERSIONS_COLLECTION,
  MARKET_SESSIONS_COLLECTION,
  MARKET_SNAPSHOTS_COLLECTION,
  SIGNAL_EVENTS_COLLECTION,
  TRADE_WINDOWS_COLLECTION,
  WINDOW_OPTIMIZATIONS_COLLECTION,
} from "./lib/schema";
import {
  probeLiveSignalNotifications,
  setupLiveSignalNotifications,
  stopLiveSignalNotifications,
  type NotificationSetupState,
} from "./lib/notifications";
import {
  configFields,
  type AdminSignal,
  type ConfigField,
  type ConfigFieldValue,
  classifySignalTier,
  operationalSymbols,
  type SignalTier,
  signalTierLegend,
} from "./lib/engine";
import {
  DEFAULT_TRADING_ALLOCATION,
  DEFAULT_TRADING_POSITION_MODE,
  DEFAULT_TRADING_STOP_LOSS_PERCENT,
  DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT,
  DEFAULT_TRADING_REBUY_MAX_COUNT,
  loadTradingAccount,
  loadTradingSettings,
  saveTradingSettings,
  type TradingAccountSnapshot,
  type TradingMode,
  type TradingPositionMode,
  type TradingSettingsSnapshot,
} from "./lib/api";
import {
  isTradingSettingsDirty,
  tradingSettingsSignature,
  tradingTierKeys,
} from "./lib/trading-settings";

const snapshot = ref<DashboardSnapshot | null>(null);
const selectedSignal = ref<DashboardSnapshot["selectedSignal"] | null>(null);
const selectedSignalId = ref<string>(loadPersistedString("admin.selectedSignalId", ""));
const selectedDecisionSymbol = ref<string>(loadPersistedString("admin.selectedDecisionSymbol", ""));
const selectedMarketDay = ref<string>(currentMarketDayKey());
const displayTimezone = ref<"local" | "new_york">(
  loadPersistedChoice("admin.displayTimezone", "new_york", ["local", "new_york"]),
);
const chartIntervalMinutes = ref<1 | 5 | 10 | 30 | 60>(1);
const marketWindowPage = ref(0);
const selectedMarketWindowReviewId = ref<string>("");
const selectedWindowSymbol = ref<string>(loadPersistedString("admin.selectedWindowSymbol", ""));
const selectedOptimizationSymbol = ref<string>(loadPersistedString("admin.selectedOptimizationSymbol", ""));
const dashboardClock = ref(Date.now());
const loading = ref(true);
const authState = ref<
  "booting" | "authenticating" | "authenticated" | "offline"
>("booting");
const snapshotSource = ref<DashboardSource>("empty");
const snapshotWarning = ref<string | null>(null);
const liveDataAvailable = ref(true);
const notificationState = ref<NotificationSetupState>("unsupported");
const notificationMessage = ref<string | null>(null);
const selectedSignalCopyState = ref<string | null>(null);
const selectedWindowCopyState = ref<string | null>(null);
const selectedLedgerSnapshotId = ref<string>("");
const selectedWindowReviewId = ref<string>("");
const selectedOptimizationReviewId = ref<string>("");
const tradingMode = ref<TradingMode>("paper");
const tradingPositionMode = ref<TradingPositionMode>(DEFAULT_TRADING_POSITION_MODE);
const tradingAllocations = reactive<Record<SignalTier, number>>({
  conviction_buy: 1000,
  balanced_buy: 1000,
  opportunistic_buy: 1000,
  speculative_buy: 1000,
});
const tradingStopLossPercent = ref(DEFAULT_TRADING_STOP_LOSS_PERCENT);
const tradingRebuyMinDropPercent = ref(DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT);
const tradingRebuyMaxCount = ref(DEFAULT_TRADING_REBUY_MAX_COUNT);
const tradingAccount = ref<TradingAccountSnapshot | null>(null);
const tradingSettingsLoading = ref(false);
const tradingAccountRefreshing = ref(false);
const tradingSettingsSaving = ref(false);
const tradingSettingsLoaded = ref(false);
const tradingSettingsLoadFailed = ref(false);
const tradingSettingsDirty = ref(false);
const tradingSettingsBaselineSignature = ref("");
const tradingSettingsError = ref<string | null>(null);
const tradingSettingsMessage = ref<string | null>(null);
const tradingSettingsSessionId = ref<string>("");
const tradingPositionModeOptions: { value: TradingPositionMode; label: string; description: string; badgeClass: string; icon: string }[] = [
  { value: "stop_loss", label: "Stop loss", description: "Protect the position with a fixed stop", badgeClass: "stop-loss", icon: "SL" },
  { value: "rebuy", label: "Rebuy", description: "Add on further weakness", badgeClass: "rebuy", icon: "RB" },
  { value: "none", label: "None", description: "Disable both protections", badgeClass: "none", icon: "∅" },
];
const liveSignalPage = ref(0);
const expandedChartId = ref<string | null>(null);
const expandedChartZoomX = ref(1);
const expandedChartZoomY = ref(1);
const decisionDayPickerRef = ref<HTMLInputElement | null>(null);
const windowDayPickerRef = ref<HTMLInputElement | null>(null);
const chartModalCardRef = ref<HTMLElement | null>(null);
const chartModalCloseButton = ref<HTMLButtonElement | null>(null);
const selectedSignalCopyTimer = ref<number | null>(null);
const selectedWindowCopyTimer = ref<number | null>(null);
const selectedSignalCopyFeedbackDurationMs = 1800;
let chartModalPreviousFocus: HTMLElement | null = null;
let notificationSetupGeneration = 0;
let isMounted = true;
let dashboardRefreshTimer: number | null = null;
let dashboardRefreshInFlight = false;
let dashboardRefreshQueued = false;
let dashboardClockTimer: number | null = null;
let dashboardVisibilityChangeHandler: (() => void) | null = null;
let realtimeUnsubscribers: Unsubscribe[] = [];
let realtimeListenerKey = "";
const triageFilter = ref<"all" | "buy" | "sell">(
  loadPersistedChoice("admin.triageFilter", "all", ["all", "buy", "sell"]),
);
const triageFilters = ["all", "buy", "sell"] as const;
const selectedConfigVersionId = ref<string>("current");
const configDraft = reactive<Record<string, string | number>>({});
const symbolAddDrafts = reactive<Record<string, string>>({});
const optimizationEntrySnapshotId = ref<string>("");
const optimizationExitSnapshotId = ref<string>("");
const optimizationNotes = ref("");
const optimizationSaving = ref(false);
const optimizationError = ref<string | null>(null);
const collapsedChartGroups = reactive<Record<string, boolean>>({});
const DASHBOARD_REFRESH_INTERVAL_MS = 30_000;
const LIVE_SIGNAL_PAGE_SIZE = 20;
let tradingAccountRefreshGeneration = 0;
const getMarketDayKey = (value: string | Date) =>
  marketDayKeyForTimestamp(value) || currentMarketDayKey();
const sessionOverview = computed(
  () => snapshot.value?.sessionOverview ?? emptySessionOverview(),
);
const operationalSymbolSet = new Set<string>(operationalSymbols);
const marketSnapshots = computed(() => snapshot.value?.marketSnapshots ?? []);
const tradeWindows = computed(() => snapshot.value?.windows ?? []);
const selectedDaySnapshots = computed(() => {
  return marketSnapshots.value.filter(
    (record) => getMarketDayKey(record.timestamp) === selectedMarketDay.value,
  );
});
const selectedDaySignals = computed(() => {
  const signals = snapshot.value?.signals ?? [];
  return signals
    .filter(
    (signal) => getMarketDayKey(signal.updatedAt) === selectedMarketDay.value,
    )
    .slice()
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.updatedAt);
      const rightTimestamp = Date.parse(right.updatedAt);
      if (leftTimestamp !== rightTimestamp) {
        return rightTimestamp - leftTimestamp;
      }
      if (left.symbol !== right.symbol) {
        return left.symbol.localeCompare(right.symbol);
      }
      return (right.signalAction ?? "").localeCompare(left.signalAction ?? "");
    });
});
const marketSymbols = computed(() => {
  const symbols = new Set<string>();
  const monitoredSymbols = snapshot.value?.configFields.find(
    (field) => field.key === "monitored_symbols",
  )?.value;
  if (Array.isArray(monitoredSymbols)) {
    for (const symbol of monitoredSymbols) {
      const normalized = String(symbol).trim().toUpperCase();
      if (normalized) {
        if (operationalSymbolSet.has(normalized)) {
          symbols.add(normalized);
        }
      }
    }
  }
  const benchmarkSymbol = String(
    snapshot.value?.configFields.find(
      (field) => field.key === "benchmark_symbol",
    )?.value ?? "QQQ",
  )
    .trim()
    .toUpperCase();
  for (const signal of selectedDaySignals.value) {
    if (signal.symbol && signal.symbol !== benchmarkSymbol) {
      if (operationalSymbolSet.has(signal.symbol)) {
        symbols.add(signal.symbol);
      }
    }
  }
  for (const snapshotRecord of selectedDaySnapshots.value) {
    if (snapshotRecord.symbol && snapshotRecord.symbol !== benchmarkSymbol) {
      if (operationalSymbolSet.has(snapshotRecord.symbol)) {
        symbols.add(snapshotRecord.symbol);
      }
    }
  }
  for (const window of tradeWindows.value) {
    if (
      getMarketDayKey(window.openedAt) === selectedMarketDay.value ||
      (window.closedAt
        ? getMarketDayKey(window.closedAt) === selectedMarketDay.value
        : false)
      ) {
      if (window.symbol && window.symbol !== benchmarkSymbol && operationalSymbolSet.has(window.symbol)) {
        symbols.add(window.symbol);
      }
    }
  }
  return Array.from(symbols).sort();
});
const decisionSymbols = computed(() => {
  const symbols = new Set<string>();
  for (const signal of selectedDaySignals.value) {
    if (classifySignal(signal) === "hold") {
      continue;
    }
    if (signal.symbol) {
      if (operationalSymbolSet.has(signal.symbol)) {
        symbols.add(signal.symbol);
      }
    }
  }
  return Array.from(symbols).sort();
});
const selectedMarketSnapshots = computed(() => {
  return selectedDaySnapshots.value;
});
const marketWindowReviews = computed(() => {
  return tradeWindows.value
    .filter(
      (window) =>
        marketDayKeyForTimestamp(window.openedAt) === selectedMarketDay.value ||
        marketDayKeyForTimestamp(window.closedAt ?? "") ===
          selectedMarketDay.value,
    )
    .filter(
      (window) =>
        !selectedWindowSymbol.value ||
        window.symbol === selectedWindowSymbol.value,
    )
    .slice()
    .map((window) => decorateWindowReview(window, dashboardClock.value))
    .sort(
      (left, right) =>
        (right.lastSignalAt ? Date.parse(right.lastSignalAt) : 0) -
        (left.lastSignalAt ? Date.parse(left.lastSignalAt) : 0),
    );
});
const selectedMarketWindowReviews = computed(() => {
  const start = marketWindowPage.value * windowReviewPageSize;
  const end = start + windowReviewPageSize;
  return marketWindowReviews.value.slice(start, end);
});
const marketWindowPageCount = computed(() => {
  return Math.max(
    1,
    Math.ceil(marketWindowReviews.value.length / windowReviewPageSize),
  );
});
const selectedChartSnapshots = computed(() => {
  const review = selectedWindowReview.value;
  if (!review) {
    return [];
  }
  const snapshots = selectChartSnapshotsForDisplay(
    selectedDaySnapshots.value.length > 0
      ? selectedDaySnapshots.value
      : findWindowSnapshots(review),
    review.symbol,
  );
  const augmentedSnapshots = snapshots.slice();
  const attachWindowSignal = (
    snapshot: MarketSnapshotRecord | null | undefined,
    signalAction: "BUY_ALERT" | "SELL_ALERT",
  ) => {
    if (!snapshot) {
      return;
    }
    const normalizedAction = (snapshot.signalAction ?? "").trim().toUpperCase();
    const actionAliases =
      signalAction === "BUY_ALERT"
        ? new Set(["BUY_ALERT", "BUY", "ACCEPT", "ENTRY_SIGNALLED"])
        : new Set(["SELL_ALERT", "SELL", "EXIT", "EXIT_SIGNALLED"]);
    if (actionAliases.has(normalizedAction)) {
      return;
    }
    augmentedSnapshots.push({
      ...snapshot,
      signalAction,
      signalState:
        snapshot.signalState ||
        (signalAction === "BUY_ALERT" ? "ENTRY_SIGNALLED" : "EXIT_SIGNALLED"),
      id: `${snapshot.id}:${signalAction}`,
      windowId: snapshot.windowId || review.id,
    });
  };
  attachWindowSignal(review.buySnapshot, "BUY_ALERT");
  attachWindowSignal(review.sellSnapshot, "SELL_ALERT");
  return augmentedSnapshots.sort((left, right) => {
    return compareSnapshotsByTimestampAndId(left, right);
  });
});
const selectedWindowFocusRange = computed(() => {
  const review = selectedWindowReview.value;
  if (!review) {
    return null;
  }
  const start =
    review.openedAt ??
    review.buySnapshot?.timestamp ??
    review.lastSignalAt ??
    null;
  const end =
    review.closedAt ??
    review.sellSnapshot?.timestamp ??
    review.lastSignalAt ??
    new Date(dashboardClock.value).toISOString();
  if (!start) {
    return null;
  }
  return { start, end };
});

function parseTimeframeMinutes(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }
  const exactMatch = /^(\d+)\s*(m|min|minutes?)$/.exec(raw);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }
  const hourMatch = /^(\d+)\s*(h|hr|hour|hours?)$/.exec(raw);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }
  return null;
}

function selectChartSnapshotsForDisplay(
  snapshots: MarketSnapshotRecord[],
  symbol: string,
) {
  const available = new Map<number, MarketSnapshotRecord[]>();
  for (const snapshot of snapshots) {
    if (snapshot.symbol !== symbol) {
      continue;
    }
    const timeframeMinutes = parseTimeframeMinutes(snapshot.timeframe ?? "1m");
    if (timeframeMinutes === null) {
      continue;
    }
    const bucket = available.get(timeframeMinutes) ?? [];
    bucket.push(snapshot);
    available.set(timeframeMinutes, bucket);
  }

  if (available.size === 0) {
    return filterAndSortSnapshots(snapshots, symbol, "1m");
  }

  const preferredTimeframe =
    [1, 5, 10, 15, 30, 60].find((timeframe) => available.has(timeframe)) ??
    [...available.keys()].sort((left, right) => left - right)[0];
  const preferredSnapshots =
    preferredTimeframe === undefined ? [] : available.get(preferredTimeframe) ?? [];
  return preferredSnapshots
    .slice()
    .sort(compareSnapshotsByTimestampAndId);
}

function filterAndSortSnapshots(
  snapshots: MarketSnapshotRecord[],
  symbol: string,
  timeframe: string,
) {
  return snapshots
    .filter((snapshot) => snapshot.symbol === symbol)
    .filter((snapshot) => (snapshot.timeframe || '1m').trim().toLowerCase() === timeframe)
    .slice()
    .sort(compareSnapshotsByTimestampAndId);
}

function compareSnapshotsByTimestampAndId(
  left: MarketSnapshotRecord,
  right: MarketSnapshotRecord,
) {
  const leftTimestamp = Date.parse(left.timestamp);
  const rightTimestamp = Date.parse(right.timestamp);
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  return left.id.localeCompare(right.id);
}
const chartGroups = marketChartGroups;
const marketLedgerPageSize = 12;
const marketLedgerPage = ref(0);
const triagePageSize = 12;
const triagePage = ref(0);
const windowReviewPageSize = 6;
const windowReviewPage = ref(0);
const latestMarketSnapshots = computed(() => {
  const start = marketLedgerPage.value * marketLedgerPageSize;
  const end = start + marketLedgerPageSize;
  return selectedMarketSnapshots.value.slice(-50).reverse().slice(start, end);
});
const marketLedgerPageCount = computed(() =>
  Math.max(
    1,
    Math.ceil(
      Math.min(50, selectedMarketSnapshots.value.length) / marketLedgerPageSize,
    ),
  ),
);
const liveSignals = computed(() => {
  return selectedDaySignals.value
    .filter((signal) => classifySignal(signal) !== "hold")
    .slice();
});
const liveSignalPageSignals = computed(() => {
  const start = liveSignalPage.value * LIVE_SIGNAL_PAGE_SIZE;
  const end = start + LIVE_SIGNAL_PAGE_SIZE;
  return liveSignals.value.slice(start, end);
});
const liveSignalPageCount = computed(() =>
  Math.max(1, Math.ceil(liveSignals.value.length / LIVE_SIGNAL_PAGE_SIZE)),
);
const selectedLedgerSnapshot = computed(() => {
  const snapshotId = selectedLedgerSnapshotId.value;
  if (!snapshotId) {
    return latestMarketSnapshots.value[0] ?? null;
  }
  return (
    selectedMarketSnapshots.value.find((record) => record.id === snapshotId) ??
    latestMarketSnapshots.value[0] ??
    null
  );
});
const allWindowReviews = computed(() => {
  return tradeWindows.value
    .filter(
      (window) =>
        marketDayKeyForTimestamp(window.openedAt) === selectedMarketDay.value ||
        marketDayKeyForTimestamp(window.closedAt ?? "") ===
          selectedMarketDay.value,
    )
    .filter(
      (window) =>
        !selectedWindowSymbol.value ||
        window.symbol === selectedWindowSymbol.value,
    )
    .slice()
    .map((window) => decorateWindowReview(window, dashboardClock.value))
    .sort(
      (left, right) =>
        (right.lastSignalAt ? Date.parse(right.lastSignalAt) : 0) -
        (left.lastSignalAt ? Date.parse(left.lastSignalAt) : 0),
    );
});
const allOptimizationReviews = computed(() => {
  return tradeWindows.value
    .filter(
      (window) =>
        marketDayKeyForTimestamp(window.openedAt) === selectedMarketDay.value ||
        marketDayKeyForTimestamp(window.closedAt ?? "") ===
          selectedMarketDay.value,
    )
    .filter(
      (window) =>
        !selectedOptimizationSymbol.value ||
        window.symbol === selectedOptimizationSymbol.value,
    )
    .slice()
    .map((window) => decorateWindowReview(window, dashboardClock.value))
    .sort(
      (left, right) =>
        (right.lastSignalAt ? Date.parse(right.lastSignalAt) : 0) -
        (left.lastSignalAt ? Date.parse(left.lastSignalAt) : 0),
    );
});
const selectedWindowReview = computed<WindowReviewView | null>(() => {
  if (!allWindowReviews.value.length) {
    return null;
  }
  return (
    allWindowReviews.value.find(
      (review) => review.id === selectedWindowReviewId.value,
    ) ?? allWindowReviews.value[0]
  );
});
const selectedOptimizationReview = computed<WindowReviewView | null>(() => {
  if (!allOptimizationReviews.value.length) {
    return null;
  }
  return (
    allOptimizationReviews.value.find(
      (review) => review.id === selectedOptimizationReviewId.value,
    ) ?? allOptimizationReviews.value[0]
  );
});
const selectedOptimizationSnapshots = computed(() => {
  const review = selectedOptimizationReview.value;
  if (!review) {
    return [];
  }
  return findWindowSnapshots(review);
});
const selectedSignalWindowReview = computed<WindowReviewView | null>(() => {
  const signal = selectedSignal.value;
  if (!signal) {
    return null;
  }
  return findWindowReviewForSymbolAndTimestamp(
    signal.symbol,
    signal.updatedAt,
    signal.windowId,
  ) ?? null;
});
const selectedSignalDrivers = computed(() =>
  buildSignalDrivers(selectedSignal.value, selectedSignalWindowReview.value),
);
const selectedSignalReasonItems = computed(() => {
  const signal = selectedSignal.value;
  if (!signal) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      signal.reasons
        .map((reason) => humanizeReason(reason))
        .map((reason) => reason.trim())
        .filter((reason) => reason.length > 0 && reason !== "Live market context"),
    ),
  );
});
const selectedSignalReasonSummary = computed(() => {
  const reasons = selectedSignalReasonItems.value.slice(0, 3);
  return reasons.length ? `Key drivers: ${reasons.join(" · ")}` : "";
});
const canCopySelectedSignalId = computed(() => {
  const signalId = selectedSignal.value?.id?.trim();
  return Boolean(
    signalId &&
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText,
  );
});
const selectedSignalTierMeta = computed(() =>
  signalMetaForSignal(selectedSignal.value),
);
const selectedSignalSide = computed(() =>
  selectedSignal.value ? classifySignal(selectedSignal.value) : "hold",
);
const selectedSignalPrice = computed(() => {
  const signalSide = selectedSignalSide.value;
  const review = selectedSignalWindowReview.value;
  if (!review) {
    return null;
  }
  if (signalSide === "sell") {
    return review.exitPrice ?? review.sellSnapshot?.close ?? review.entryPrice;
  }
  if (signalSide === "buy") {
    return review.entryPrice ?? review.buySnapshot?.close ?? review.exitPrice;
  }
  return review.entryPrice ?? review.exitPrice ?? null;
});
const selectedSignalBadge = computed(() => {
  const signalSide = selectedSignalSide.value;
  if (signalSide === "buy") {
    return {
      label: "Buy",
      emoji: "🟢",
      tone: "buy",
    };
  }
  if (signalSide === "sell") {
    return {
      label: "Sell",
      emoji: "🔴",
      tone: "sell",
    };
  }
  return {
    label: "Signal",
    emoji: "⚪",
    tone: "neutral",
  };
});
const selectedDisplayTimeZoneValue = computed(() =>
  displayTimezone.value === "new_york" ? "America/New_York" : undefined,
);
const selectedWindowReviews = computed(() => {
  const start = windowReviewPage.value * windowReviewPageSize;
  const end = start + windowReviewPageSize;
  return allWindowReviews.value.slice(start, end);
});
const windowReviewPageCount = computed(() => {
  return Math.max(
    1,
    Math.ceil(allWindowReviews.value.length / windowReviewPageSize),
  );
});
const windowChartMarkers = computed(() => {
  const review = selectedOptimizationReview.value;
  if (!review) {
    return "Select a window to inspect its buy and sell markers.";
  }
  if (selectedOptimizationSnapshots.value.length === 0) {
    return "No market snapshots are linked to this window yet.";
  }
  return review.closedAt
    ? "Buy and sell markers are visible for this closed window."
    : "This window is still open, so the sell marker may be missing until the position closes.";
});

const windowOptimizationHistory = computed(() => {
  const optimizations = snapshot.value?.windowOptimizations ?? [];
  return optimizations
    .filter((item) => item.day === selectedMarketDay.value)
    .filter(
      (item) =>
        !selectedOptimizationSymbol.value ||
        item.symbol === selectedOptimizationSymbol.value,
    )
    .slice()
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
});

const selectedWindowOptimization = computed(() => {
  if (!selectedOptimizationReview.value) {
    return null;
  }
  return (
    windowOptimizationHistory.value.find(
      (optimization) =>
        optimization.windowId === selectedOptimizationReview.value?.id,
    ) ?? null
  );
});

const expandedChartDefinition = computed(() => {
  if (!expandedChartId.value) {
    return null;
  }
  return (
    marketChartDefs.find((chart) => chart.id === expandedChartId.value) ?? null
  );
});

function clampPage(page: { value: number }, pageCount: number) {
  page.value = Math.min(page.value, Math.max(0, pageCount - 1));
}

const sourceDisplay = computed(() => {
  if (snapshotSource.value === "live") {
    return {
      title: "Live session",
    };
  }

  return {
    title: "Waiting for live session",
  };
});

function emptySessionOverview(): DashboardSnapshot["sessionOverview"] {
  return {
    sessionId: "nasdaq-live",
    status: "waiting",
    updatedAt: new Date().toISOString(),
    configVersion: "draft",
    openWindows: 0,
    summary: "No live records are available for the selected day yet.",
  };
}

function defaultTradingAllocations(): Record<SignalTier, number> {
  return {
    conviction_buy: DEFAULT_TRADING_ALLOCATION,
    balanced_buy: DEFAULT_TRADING_ALLOCATION,
    opportunistic_buy: DEFAULT_TRADING_ALLOCATION,
    speculative_buy: DEFAULT_TRADING_ALLOCATION,
  };
}

function applyTradingSettingsSnapshot(settings: TradingSettingsSnapshot) {
  tradingMode.value = settings.tradingMode;
  tradingPositionMode.value = settings.tradingPositionMode;
  for (const tier of tradingTierKeys) {
    tradingAllocations[tier] = settings.tradingAllocations[tier] ?? DEFAULT_TRADING_ALLOCATION;
  }
  tradingStopLossPercent.value = settings.tradingStopLossPercent;
  tradingRebuyMinDropPercent.value = settings.tradingRebuyMinDropPercent;
  tradingRebuyMaxCount.value = settings.tradingRebuyMaxCount;
  tradingAccount.value = settings.tradingAccount;
  tradingSettingsSessionId.value = settings.sessionId;
  tradingSettingsBaselineSignature.value = tradingSettingsSignature(
    settings.tradingMode,
    settings.tradingPositionMode,
    settings.tradingAllocations,
    settings.tradingStopLossPercent,
    settings.tradingRebuyMinDropPercent,
    settings.tradingRebuyMaxCount,
  );
  tradingSettingsDirty.value = false;
  tradingSettingsLoaded.value = true;
  tradingSettingsLoadFailed.value = false;
  tradingSettingsError.value = settings.tradingAccountError;
}

async function loadTradingSettingsForSession(sessionId: string) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  tradingSettingsMessage.value = null;
  tradingSettingsLoaded.value = false;
  tradingSettingsLoadFailed.value = false;
  if (!normalizedSessionId) {
    tradingMode.value = "paper";
    tradingPositionMode.value = DEFAULT_TRADING_POSITION_MODE;
    Object.assign(tradingAllocations, defaultTradingAllocations());
    tradingStopLossPercent.value = DEFAULT_TRADING_STOP_LOSS_PERCENT;
    tradingRebuyMinDropPercent.value = DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT;
    tradingRebuyMaxCount.value = DEFAULT_TRADING_REBUY_MAX_COUNT;
    tradingAccount.value = null;
    tradingSettingsError.value = null;
    tradingSettingsMessage.value = null;
    tradingSettingsSessionId.value = "";
    tradingSettingsBaselineSignature.value = "";
    tradingSettingsDirty.value = false;
    tradingSettingsLoadFailed.value = false;
    return;
  }
  tradingSettingsLoading.value = true;
  tradingSettingsError.value = null;
  try {
    const settings = await loadTradingSettings(normalizedSessionId, new Date().toISOString());
    applyTradingSettingsSnapshot(settings);
    if (!settings.tradingAccount || settings.tradingAccountError) {
      void refreshTradingAccountForSession(
        sessionId,
        settings.tradingMode,
        new Date().toISOString(),
      );
    }
  } catch (error) {
    tradingSettingsError.value =
      error instanceof Error ? error.message : "Failed to load trading settings.";
    tradingSettingsMessage.value = null;
    tradingMode.value = "paper";
    tradingPositionMode.value = DEFAULT_TRADING_POSITION_MODE;
    Object.assign(tradingAllocations, defaultTradingAllocations());
    tradingStopLossPercent.value = DEFAULT_TRADING_STOP_LOSS_PERCENT;
    tradingRebuyMinDropPercent.value = DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT;
    tradingRebuyMaxCount.value = DEFAULT_TRADING_REBUY_MAX_COUNT;
    tradingAccount.value = null;
    tradingSettingsSessionId.value = normalizedSessionId;
    tradingSettingsBaselineSignature.value = tradingSettingsSignature(
      tradingMode.value,
      tradingPositionMode.value,
      tradingAllocations,
      tradingStopLossPercent.value,
      tradingRebuyMinDropPercent.value,
      tradingRebuyMaxCount.value,
    );
    tradingSettingsDirty.value = false;
    tradingSettingsLoaded.value = true;
    tradingSettingsLoadFailed.value = true;
  } finally {
    tradingSettingsLoading.value = false;
  }
}

async function refreshTradingAccountForSession(
  sessionId: string,
  mode = tradingMode.value,
  nowIso = new Date().toISOString(),
) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedMode = mode === "live" ? "live" : "paper";
  if (!normalizedSessionId) {
    tradingAccount.value = null;
    return;
  }
  const requestGeneration = ++tradingAccountRefreshGeneration;
  tradingAccountRefreshing.value = true;
  tradingSettingsError.value = null;
  const previousAccount = tradingAccount.value;
  try {
    const account = await loadTradingAccount(
      normalizedSessionId,
      normalizedMode,
      nowIso,
    );
    if (requestGeneration !== tradingAccountRefreshGeneration) {
      return;
    }
    if (account) {
      tradingAccount.value = account;
    } else if (!previousAccount || previousAccount.mode !== normalizedMode) {
      tradingAccount.value = null;
    }
    tradingSettingsLoadFailed.value = false;
  } catch (error) {
    if (requestGeneration !== tradingAccountRefreshGeneration) {
      return;
    }
    if (!previousAccount || previousAccount.mode !== normalizedMode) {
      tradingAccount.value = null;
    }
    tradingSettingsError.value =
      error instanceof Error ? error.message : "Failed to refresh trading account.";
  } finally {
    if (requestGeneration === tradingAccountRefreshGeneration) {
      tradingAccountRefreshing.value = false;
    }
  }
}

async function saveTradingSettingsFromPanel() {
  const sessionId = String(sessionOverview.value.sessionId ?? "").trim();
  if (!sessionId) {
    tradingSettingsError.value = "No live session is available yet.";
    return;
  }
  if (!tradingSettingsLoaded.value) {
    tradingSettingsError.value = "Trading settings must be loaded before saving.";
    return;
  }
  if (!tradingSettingsDirty.value) {
    tradingSettingsError.value = "No trading setting changes detected.";
    return;
  }
  tradingSettingsSaving.value = true;
  tradingSettingsError.value = null;
  tradingSettingsMessage.value = null;
  try {
    const normalizedStopLossPercent = Number(tradingStopLossPercent.value);
    const normalizedRebuyMinDropPercent = Number(tradingRebuyMinDropPercent.value);
    const normalizedRebuyMaxCount = Number(tradingRebuyMaxCount.value);
    const settings = await saveTradingSettings(sessionId, {
      mode: tradingMode.value,
      trading_position_mode: tradingPositionMode.value,
      allocations: {
        conviction_buy: Number(tradingAllocations.conviction_buy) || 0,
        balanced_buy: Number(tradingAllocations.balanced_buy) || 0,
        opportunistic_buy: Number(tradingAllocations.opportunistic_buy) || 0,
        speculative_buy: Number(tradingAllocations.speculative_buy) || 0,
      },
      stop_loss_percent:
        Number.isFinite(normalizedStopLossPercent) && normalizedStopLossPercent > 0
          ? normalizedStopLossPercent
          : DEFAULT_TRADING_STOP_LOSS_PERCENT,
      rebuy_min_drop_percent:
        Number.isFinite(normalizedRebuyMinDropPercent) && normalizedRebuyMinDropPercent > 0
          ? normalizedRebuyMinDropPercent
          : DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT,
      rebuy_max_rebuys:
        Number.isFinite(Math.floor(normalizedRebuyMaxCount)) && Math.floor(normalizedRebuyMaxCount) > 0
          ? Math.floor(normalizedRebuyMaxCount)
          : DEFAULT_TRADING_REBUY_MAX_COUNT,
    }, new Date().toISOString());
    applyTradingSettingsSnapshot(settings);
    if (!settings.tradingAccount || settings.tradingAccountError) {
      void refreshTradingAccountForSession(
        sessionId,
        settings.tradingMode,
        new Date().toISOString(),
      );
    }
    tradingSettingsMessage.value = "Trading settings saved.";
  } catch (error) {
    tradingSettingsError.value =
      error instanceof Error ? error.message : "Failed to save trading settings.";
  } finally {
    tradingSettingsSaving.value = false;
  }
}

const tradingSettingsCurrentSignature = computed(() =>
  tradingSettingsSignature(
    tradingMode.value,
    tradingPositionMode.value,
    tradingAllocations,
    tradingStopLossPercent.value,
    tradingRebuyMinDropPercent.value,
    tradingRebuyMaxCount.value,
  ),
);

function syncTradingSettingsDirty() {
  tradingSettingsDirty.value = isTradingSettingsDirty(
    tradingSettingsLoaded.value,
    tradingSettingsBaselineSignature.value,
    tradingSettingsCurrentSignature.value,
  );
}

function toggleTradingMode() {
  tradingMode.value = tradingMode.value === "live" ? "paper" : "live";
  syncTradingSettingsDirty();
  void refreshTradingAccountForSession(
    sessionOverview.value.sessionId,
    tradingMode.value,
    new Date().toISOString(),
  );
}

function setTradingPositionMode(mode: TradingPositionMode) {
  tradingPositionMode.value = mode;
  syncTradingSettingsDirty();
}

function notifyTradingSettingsEdited() {
  syncTradingSettingsDirty();
}

watch(
  tradingSettingsCurrentSignature,
  () => {
    syncTradingSettingsDirty();
  },
  { immediate: true },
);

function refreshTradingSettings() {
  return refreshTradingAccountForSession(
    sessionOverview.value.sessionId,
    tradingMode.value,
    new Date().toISOString(),
  );
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function signalKey(signal: AdminSignal | null) {
  if (!signal) {
    return "";
  }
  return signal.id || `${signal.symbol}:${signal.windowId || "no-window"}:${signal.updatedAt}`;
}

function resolveSelectedSignal(
  signals: AdminSignal[],
  preferredSignalId: string,
  fallbackSignal: AdminSignal | null,
) {
  if (preferredSignalId) {
    const preferredSignal = signals.find((signal) => signal.id === preferredSignalId);
    if (preferredSignal) {
      return preferredSignal;
    }
  }
  if (fallbackSignal?.id) {
    const fallbackMatch = signals.find((signal) => signal.id === fallbackSignal.id);
    if (fallbackMatch) {
      return fallbackMatch;
    }
  }
  return signals[0] ?? fallbackSignal ?? null;
}

function windowKey(window: TradeWindowRecord | null) {
  if (!window) {
    return "";
  }
  return `${window.id}:${window.updatedAt}`;
}

function formatSignalActionLabel(action: string) {
  switch (action) {
    case "BUY_ALERT":
      return "Buy";
    case "SELL_ALERT":
      return "Sell";
    case "HOLD":
      return "Monitoring";
    default:
      return action || "Signal";
  }
}

function formatSignalStateLabel(state: string) {
  switch (state) {
    case "FLAT":
      return "Waiting";
    case "ENTRY_SIGNALLED":
      return "Buy";
    case "ACCEPTED_OPEN":
      return "Buy";
    case "EXIT_SIGNALLED":
      return "Sell";
    case "CLOSED":
      return "Window closed";
    case "REJECTED":
      return "Rejected";
    case "EXPIRED":
      return "Expired";
    default:
      return state || "Unknown";
  }
}

function formatSignalQueueLabel(signal: AdminSignal) {
  const side = classifySignal(signal);
  if (side === "buy") {
    const tier = signalMetaForSignal(signal);
    return tier ? tier.label : "Buy";
  }
  if (side === "sell") {
    return "Sell";
  }
  return "Signal";
}

function signalMetaForSignal(signal: AdminSignal | null) {
  if (!signal) {
    return null;
  }
  const tier = classifySignalTier(signal);
  return tier ? signalTierLegend[tier] : null;
}

function formatSignalRegimeLabel(
  signal: AdminSignal | MarketSnapshotRecord | null,
) {
  if (!signal) {
    return "Live market context";
  }
  const regime = "regime" in signal ? signal.regime : signal.signalRegime;
  if (!regime) {
    return "Live market context";
  }
  if (regime === "Live market session" || regime === "benchmark snapshot") {
    return "Live market context";
  }
  if (regime.includes("aligned")) {
    return "Market aligned";
  }
  if (regime.includes("pressure")) {
    return "Market under pressure";
  }
  if (regime.includes("mixed")) {
    return "Mixed market context";
  }
  return regime;
}

function formatWindowStatusLabel(status: string) {
  switch (status) {
    case "open":
      return "Open";
    case "closed":
      return "Closed";
    default:
      return status || "Unknown";
  }
}

function describeWindowOutcome(changePct: number | null) {
  if (changePct === null) {
    return "Pending price change";
  }
  if (changePct > 0) {
    return `Up ${changePct.toFixed(2)}%`;
  }
  if (changePct < 0) {
    return `Down ${Math.abs(changePct).toFixed(2)}%`;
  }
  return "Flat";
}

function humanizeReason(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) {
    return "Unknown context";
  }
  if (trimmed === "entry-qualified") {
    return "Buy criteria met";
  }
  if (trimmed === "exit-qualified") {
    return "Sell criteria met";
  }
  if (trimmed === "exit-pressure") {
    return "Sell pressure detected";
  }
  if (trimmed === "market-closed") {
    return "Market closed";
  }
  if (trimmed === "session-close exit") {
    return "Forced exit at market close";
  }
  if (trimmed === "benchmark snapshot") {
    return "Market reference snapshot";
  }
  if (trimmed === "live market session") {
    return "Live market context";
  }
  const reasonMap: Record<string, string> = {
    "trend:vwap-aligned": "Price is aligned with VWAP",
    "trend:ema-aligned": "EMA trend is aligned",
    "trend:sma-aligned": "SMA trend is aligned",
    "flow:relative-volume-confirmed": "Relative volume confirms participation",
    "flow:obv-positive": "OBV supports the move",
    "flow:volume-profile-supportive": "Volume profile supports the move",
    "momentum:rsi-healthy": "RSI sits in a healthier buy zone",
    "momentum:macd-positive": "MACD momentum is supportive",
    "momentum:stochastic-rising": "Stochastic is turning in the right direction",
    "volatility:range-expanding": "Volatility is expanding",
    "volatility:above-bollinger-mid": "Price is above the Bollinger midline",
    "strength:adx-supportive": "ADX confirms trend strength",
    "strength:directional-pressure": "Directional pressure is positive",
    "market context aligned": "Benchmark confirms the move",
    "market context under pressure": "Benchmark is under pressure",
    "mixed market context": "Benchmark context is mixed",
  };
  if (trimmed in reasonMap) {
    return reasonMap[trimmed];
  }
  const benchmarkMatch =
    /^([A-Z]{1,6})\s+(market context aligned|market context under pressure|mixed market context)$/.exec(
      trimmed,
    );
  if (benchmarkMatch) {
    const label = benchmarkMatch[2];
    if (label === "market context aligned") {
      return "Benchmark confirms the move";
    }
    if (label === "market context under pressure") {
      return "Benchmark is under pressure";
    }
    return "Benchmark context is mixed";
  }
  if (trimmed.startsWith("buy-tier:")) {
    return `Signal tier: ${trimmed.replace("buy-tier:", "").replace(/_/g, " ")}`;
  }
  if (trimmed.includes("market context")) {
    return trimmed.replace(/-/g, " ");
  }
  const timeframeMatch = /^([0-9]+m):(.*)$/.exec(trimmed);
  if (timeframeMatch) {
    return `${timeframeMatch[1]} timeframe · ${timeframeMatch[2].replace(/-/g, " ").trim()}`;
  }
  return trimmed.replace(/-/g, " ");
}

function openNativeDatePicker(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // Fallback to the native click path below when the browser blocks showPicker().
    }
  }
  input.click();
}

function syncSelectedDecisionSymbol(symbols: string[]) {
  if (symbols.length === 0) {
    selectedDecisionSymbol.value = "";
    return;
  }

  if (!selectedDecisionSymbol.value) {
    return;
  }

  if (!symbols.includes(selectedDecisionSymbol.value)) {
    selectedDecisionSymbol.value = "";
  }
}

function syncSelectedSymbol(selection: Ref<string>, symbols: string[]) {
  if (symbols.length === 0) {
    selection.value = "";
    return;
  }

  if (!selection.value) {
    return;
  }

  if (!symbols.includes(selection.value)) {
    selection.value = "";
  }
}

function syncWindowSelectionSymbol(selection: Ref<string>, symbol: string) {
  if (!selection.value) {
    return;
  }
  if (selection.value !== symbol) {
    selection.value = symbol;
  }
}

function syncSelectedWindowSymbol(symbols: string[]) {
  syncSelectedSymbol(selectedWindowSymbol, symbols);
}

function syncSelectedOptimizationSymbol(symbols: string[]) {
  syncSelectedSymbol(selectedOptimizationSymbol, symbols);
}

const currentConfigVersion = computed(
  () => sessionOverview.value.configVersion,
);

const configVersions = computed(() => snapshot.value?.configVersions ?? []);

const selectedConfigVersion = computed<ConfigVersionRecord | null>(() => {
  if (!snapshot.value) {
    return null;
  }
  if (selectedConfigVersionId.value === "current") {
    return (
      configVersions.value.find(
        (version) => version.version === currentConfigVersion.value,
      ) ??
      configVersions.value[0] ??
      null
    );
  }
  return (
    configVersions.value.find(
      (version) => version.id === selectedConfigVersionId.value,
    ) ?? null
  );
});

const selectedConfigFields = computed(() => {
  const versionFields = selectedConfigVersion.value?.fields;
  if (versionFields && versionFields.length > 0) {
    return versionFields;
  }
  return snapshot.value?.configFields ?? configFields;
});

const editableConfigFields = computed(() => selectedConfigFields.value);
const configFieldGroups = computed(() =>
  groupConfigFields(editableConfigFields.value),
);

function stringifyConfigValue(value: ConfigFieldValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => item.toUpperCase()).join("\n");
  }
  return String(value);
}

function parseConfigDraftValue(
  field: ConfigField,
  rawValue: string | number,
): ConfigFieldValue {
  if (field.inputType === "symbols") {
    return String(rawValue)
      .split(/[\n,]/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
  }
  if (field.inputType === "number") {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return rawValue;
    }
    const trimmed = String(rawValue).trim();
    const parsed = trimmed ? Number(trimmed) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : field.value;
  }
  return String(rawValue).trim();
}

function configFieldBounds(field: ConfigField) {
  const key = field.key.toLowerCase();
  const step =
    field.step ??
    (key.includes("threshold") || key.includes("optimizer") ? 0.01 : 0.05);
  if (key.includes("threshold")) {
    return { min: 0, max: 1, step };
  }
  if (key.includes("margin")) {
    return { min: 0, max: 0.5, step };
  }
  if (key.includes("optimizer")) {
    return { min: 0, max: 1, step };
  }
  if (key.includes("weight") || key.includes("bias")) {
    return { min: 0, max: 4, step };
  }
  if (key.includes("bars")) {
    return { min: 1, max: 500, step: 1 };
  }
  if (typeof field.value === "number" && Number.isFinite(field.value)) {
    const min = Math.min(Math.floor(field.value * 0.25), field.value);
    const max = Math.max(field.value * 2, field.value + 1, min + step);
    return { min, max, step };
  }
  return { min: 0, max: 100, step };
}

function isConfigValueOutsideBounds(field: ConfigField) {
  if (field.inputType !== "number") {
    return false;
  }
  const bounds = configFieldBounds(field);
  const draftValue = configDraft[field.key];
  const value =
    typeof draftValue === "number"
      ? draftValue
      : typeof draftValue === "string" && draftValue.trim()
        ? Number(draftValue)
        : typeof field.value === "number"
          ? field.value
          : Number.NaN;
  if (!Number.isFinite(value)) {
    return false;
  }
  return value < bounds.min || value > bounds.max;
}

function draftNumberValue(field: ConfigField) {
  const draftValue = configDraft[field.key];
  if (typeof draftValue === "number" && Number.isFinite(draftValue)) {
    return draftValue;
  }
  if (typeof draftValue === "string" && draftValue.trim()) {
    const parsed = Number(draftValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return typeof field.value === "number" ? field.value : 0;
}

function readDraftSymbols(field: ConfigField) {
  const raw = configDraft[field.key] ?? stringifyConfigValue(field.value);
  return String(raw)
    .split(/[\n,]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function symbolChipOptions(field: ConfigField) {
  return Array.from(
    new Set([...(field.options ?? []), ...readDraftSymbols(field)]),
  );
}

function toggleDraftSymbol(field: ConfigField, symbol: string) {
  const current = readDraftSymbols(field);
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    return;
  }

  const next = current.includes(normalized)
    ? current.filter((item) => item !== normalized)
    : [...current, normalized];
  configDraft[field.key] = next.join("\n");
}

function addDraftSymbol(field: ConfigField) {
  const normalized = (symbolAddDrafts[field.key] ?? "").trim().toUpperCase();
  if (!normalized) {
    return;
  }

  const current = readDraftSymbols(field);
  if (!current.includes(normalized)) {
    configDraft[field.key] = [...current, normalized].join("\n");
  }
  symbolAddDrafts[field.key] = "";
}

function isDraftSymbolSelected(field: ConfigField, symbol: string) {
  return readDraftSymbols(field).includes(symbol.trim().toUpperCase());
}

function groupConfigFields(fields: ConfigField[]) {
  const groups = new Map<string, { label: string; fields: ConfigField[] }>();
  for (const field of fields) {
    const group = groups.get(field.group);
    if (group) {
      group.fields.push(field);
    } else {
      groups.set(field.group, { label: field.group, fields: [field] });
    }
  }
  return Array.from(groups.values());
}

function syncConfigDraft(fields: ConfigField[]) {
  const validKeys = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(configDraft)) {
    if (!validKeys.has(key)) {
      delete configDraft[key];
    }
  }
  for (const key of Object.keys(symbolAddDrafts)) {
    if (!validKeys.has(key)) {
      delete symbolAddDrafts[key];
    }
  }
  for (const field of fields) {
    if (!(field.key in configDraft)) {
      configDraft[field.key] =
        typeof field.value === "number"
          ? field.value
          : stringifyConfigValue(field.value);
    }
  }
}

function sameDraft(fields: ConfigField[]) {
  if (fields.length !== Object.keys(configDraft).length) {
    return false;
  }
  return fields.every((field) => {
    const draftValue = configDraft[field.key];
    if (field.inputType === "number" && typeof field.value === "number") {
      const value =
        typeof draftValue === "number" ? draftValue : Number(draftValue);
      return Number.isFinite(value) && value === field.value;
    }
    if (field.inputType === "symbols") {
      const parsed = parseConfigDraftValue(
        field,
        draftValue ?? stringifyConfigValue(field.value),
      );
      return (
        Array.isArray(parsed) &&
        stringifyConfigValue(parsed) === stringifyConfigValue(field.value)
      );
    }
    return (
      String(draftValue ?? "").trim() === stringifyConfigValue(field.value)
    );
  });
}

const isConfigDraftDirty = computed(() => {
  return !sameDraft(selectedConfigFields.value);
});

const configEditorStatus = computed(() => {
  if (isConfigDraftDirty.value) {
    return "draft";
  }
  return selectedConfigVersion.value?.status ?? "draft";
});

type WindowReviewView = TradeWindowRecord & {
  buySnapshot: MarketSnapshotRecord | null;
  sellSnapshot: MarketSnapshotRecord | null;
  entryPrice: number | null;
  exitPrice: number | null;
  changePct: number | null;
  durationMinutes: number | null;
  lastSignalAt: string;
  minutesSinceLastSignal: number | null;
  buySummary: string;
  sellSummary: string;
};

function formatChartValue(value: number | null, decimals = 2) {
  if (value === null) {
    return "--";
  }
  return value.toFixed(decimals);
}

function formatLocaleTimestamp(value: string | null | undefined) {
  if (!value) {
    return "waiting for live data";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: selectedDisplayTimeZoneValue.value ?? undefined,
  }).format(parsed);
}

function decorateWindowReview(
  window: TradeWindowRecord,
  now = Date.now(),
): WindowReviewView {
  const snapshots = findWindowSnapshots(window);
  const entrySnapshot =
    snapshots.find((snapshot) => snapshot.signalAction === "BUY_ALERT") ??
    snapshots[0] ??
    null;
  const exitSnapshot = window.closedAt
    ? (snapshots
        .slice()
        .reverse()
        .find((snapshot) => snapshot.signalAction === "SELL_ALERT") ??
      snapshots.at(-1) ??
      null)
    : null;
  const lastSignalSnapshot = exitSnapshot ?? entrySnapshot;
  const entryPrice = entrySnapshot?.close ?? null;
  const exitPrice = exitSnapshot?.close ?? null;
  const changePct =
    entryPrice !== null && exitPrice !== null && entryPrice > 0
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : null;
  const durationMinutes = window.closedAt
    ? Math.max(
        0,
        Math.round(
          (Date.parse(window.closedAt) - Date.parse(window.openedAt)) / 60000,
        ),
      )
    : null;
  const lastSignalAt =
    lastSignalSnapshot?.timestamp ?? window.updatedAt ?? window.openedAt;
  const parsedLastSignalAt = Date.parse(lastSignalAt);
  const minutesSinceLastSignal = Number.isFinite(parsedLastSignalAt)
    ? Math.max(0, Math.round((now - parsedLastSignalAt) / 60000))
    : null;

  return {
    ...window,
    buySnapshot: entrySnapshot,
    sellSnapshot: exitSnapshot,
    entryPrice,
    exitPrice,
    changePct,
    durationMinutes,
    lastSignalAt,
    minutesSinceLastSignal,
    buySummary: entrySnapshot
      ? summarizeSnapshotReason(entrySnapshot)
      : "Buy snapshot unavailable",
    sellSummary: exitSnapshot
      ? summarizeSnapshotReason(exitSnapshot)
      : "Sell snapshot unavailable",
  };
}

function findWindowSnapshots(window: TradeWindowRecord) {
  const byWindowId = selectedDaySnapshots.value
    .filter(
      (snapshot) => snapshot.windowId === window.id,
    )
    .slice()
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.timestamp)
      const rightTimestamp = Date.parse(right.timestamp)
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp
      }
      return left.id.localeCompare(right.id)
    })
  if (byWindowId.length > 0) {
    return byWindowId
  }

  const openedAt = Date.parse(window.openedAt);
  const closedAt = window.closedAt
    ? Date.parse(window.closedAt)
    : Number.POSITIVE_INFINITY;
  return selectedDaySnapshots.value
    .filter((snapshot) => {
      if (snapshot.symbol !== window.symbol) {
        return false;
      }
      const timestamp = Date.parse(snapshot.timestamp);
      return (
        Number.isFinite(timestamp) &&
        timestamp >= openedAt &&
        timestamp <= closedAt
      );
    })
    .slice()
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.timestamp)
      const rightTimestamp = Date.parse(right.timestamp)
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp
      }
      return left.id.localeCompare(right.id)
    });
}

function summarizeSnapshotReason(snapshot: MarketSnapshotRecord) {
  const reasons = Array.from(
    new Set(
      snapshot.reasons
        .map((reason) => humanizeReason(reason))
        .map((reason) => reason.trim())
        .filter((reason) => reason.length > 0 && reason !== "Live market context"),
    ),
  ).slice(0, 2);
  if (reasons.length > 0) {
    return reasons.join(" · ");
  }
  return formatSignalRegimeLabel(snapshot);
}

function formatMinutesAgo(minutes: number | null) {
  if (minutes === null) {
    return "Pending";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} h ago`;
  }
  return `${hours} h ${remainingMinutes} m ago`;
}

function formatElapsedMinutes(minutes: number | null) {
  if (minutes === null) {
    return "Pending";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainingMinutes} m`;
}

function snapshotSummaryRows(snapshot: MarketSnapshotRecord | null) {
  if (!snapshot) {
    return [];
  }
  return [
    { label: "Close", value: snapshot.close.toFixed(2) },
    { label: "RSI", value: formatChartValue(snapshot.rsi, 1) },
    {
      label: "EMA fast / slow",
      value: `${formatChartValue(snapshot.emaFast, 2)} / ${formatChartValue(snapshot.emaSlow, 2)}`,
    },
    {
      label: "SMA fast / slow",
      value: `${formatChartValue(snapshot.smaFast, 2)} / ${formatChartValue(snapshot.smaSlow, 2)}`,
    },
    {
      label: "Bollinger bands",
      value: `${formatChartValue(snapshot.bollingerMiddle, 2)} / ${formatChartValue(snapshot.bollingerUpper, 2)} / ${formatChartValue(snapshot.bollingerLower, 2)}`,
    },
    {
      label: "MACD",
      value: `${formatChartValue(snapshot.macd, 3)} · ${formatChartValue(snapshot.macdSignal, 3)} · ${formatChartValue(snapshot.macdHistogram, 3)}`,
    },
    {
      label: "Volume flow",
      value: `${formatChartValue(snapshot.obv, 0)} · ${formatChartValue(snapshot.relativeVolume, 2)} · ${formatChartValue(snapshot.volumeProfile, 2)}`,
    },
  ];
}

type SignalDriverRow = {
  label: string;
  value: string;
  tone: "bullish" | "bearish" | "neutral";
};

const VOLUME_FLOW_RELATIVE_VOLUME_THRESHOLD = 1.05;
const VOLUME_FLOW_VOLUME_PROFILE_THRESHOLD = 0.18;
const VOLUME_FLOW_OBV_THRESHOLD = 0;

function buildSignalDrivers(
  signal: AdminSignal | null,
  review: WindowReviewView | null,
) {
  if (!signal || !review) {
    return [] as SignalDriverRow[];
  }

  const snapshot =
    classifySignal(signal) === "sell"
      ? review.sellSnapshot ?? review.buySnapshot
      : review.buySnapshot ?? review.sellSnapshot;
  if (!snapshot) {
    return [] as SignalDriverRow[];
  }

  const drivers: SignalDriverRow[] = [];
  const signalSide = classifySignal(signal);
  const isBuy = signalSide === "buy";

  if (snapshot.vwap !== null) {
    const aboveVwap = snapshot.close >= snapshot.vwap;
    const vwapValue = isBuy
      ? aboveVwap
        ? "Price reclaimed and holds above VWAP"
        : "Price is still below VWAP"
      : aboveVwap
        ? "Price is stretched above VWAP"
        : "VWAP has been lost";
    drivers.push({
      label: "VWAP context",
      value: vwapValue,
      tone: aboveVwap ? "bullish" : "bearish",
    });
  }

  if (snapshot.emaFast !== null && snapshot.emaSlow !== null) {
    const aligned = snapshot.emaFast >= snapshot.emaSlow;
    drivers.push({
      label: "EMA stack",
      value: aligned ? "Fast EMA leads the slow EMA" : "Fast EMA is below the slow EMA",
      tone: aligned ? "bullish" : "bearish",
    });
  }

  if (snapshot.rsi !== null) {
    const healthyBuy = snapshot.rsi <= 35;
    const stretchedSell = snapshot.rsi >= 70;
    drivers.push({
      label: "RSI momentum",
      value: `RSI ${snapshot.rsi.toFixed(1)}`,
      tone: isBuy ? (healthyBuy ? "bullish" : "bearish") : (stretchedSell ? "bearish" : "neutral"),
    });
  }

  if (snapshot.macd !== null && snapshot.macdSignal !== null && snapshot.macdHistogram !== null) {
    const bullishMacd = snapshot.macd >= snapshot.macdSignal && snapshot.macdHistogram >= 0;
    drivers.push({
      label: "MACD impulse",
      value: bullishMacd
        ? "MACD is above signal and momentum is expanding"
        : "MACD is below signal and momentum is fading",
      tone: bullishMacd ? "bullish" : "bearish",
    });
  }

  if (snapshot.relativeVolume !== null || snapshot.volumeProfile !== null || snapshot.obv !== null) {
    const obvPositive = snapshot.obv !== null && snapshot.obv > VOLUME_FLOW_OBV_THRESHOLD;
    const volumeConfirmed =
      (snapshot.relativeVolume !== null && snapshot.relativeVolume >= VOLUME_FLOW_RELATIVE_VOLUME_THRESHOLD) ||
      (snapshot.volumeProfile !== null && snapshot.volumeProfile >= VOLUME_FLOW_VOLUME_PROFILE_THRESHOLD) ||
      obvPositive;
    drivers.push({
      label: "Volume flow",
      value: snapshot.obv === null
        ? "OBV unavailable"
        : volumeConfirmed
          ? "Participation confirms the move"
          : "Participation is still weak",
      tone: snapshot.obv === null ? "neutral" : volumeConfirmed ? "bullish" : "bearish",
    });
  }

  if (snapshot.plusDi !== null && snapshot.minusDi !== null && snapshot.adx !== null) {
    const bullishTrend = snapshot.plusDi >= snapshot.minusDi && snapshot.adx >= 20;
    drivers.push({
      label: "Trend strength",
      value: bullishTrend ? "Directional trend remains intact" : "Directional trend is weak",
      tone: bullishTrend ? "bullish" : "bearish",
    });
  }

  if (snapshot.bollingerMiddle !== null && snapshot.bollingerUpper !== null && snapshot.bollingerLower !== null) {
    const bullishBollinger = snapshot.close >= snapshot.bollingerMiddle;
    drivers.push({
      label: "Bollinger context",
      value: bullishBollinger ? "Price is above the Bollinger midline" : "Price is below the Bollinger midline",
      tone: bullishBollinger ? "bullish" : "bearish",
    });
  }

  return drivers.slice(0, 4);
}

function selectConfigVersion(version: ConfigVersionRecord | null) {
  if (!version) {
    selectedConfigVersionId.value = "current";
    return;
  }

  selectedConfigVersionId.value = version.id;
}

const triageSignals = computed(() => {
  const signals = selectedDaySignals.value
    .filter((signal) => classifySignal(signal) !== "hold")
    .filter(
      (signal) =>
        !selectedDecisionSymbol.value ||
        signal.symbol === selectedDecisionSymbol.value,
    );
  if (triageFilter.value === "all") {
    return signals;
  }
  return signals.filter(
    (signal) => classifySignal(signal) === triageFilter.value,
  );
});
const triagePageSignals = computed(() => {
  const start = triagePage.value * triagePageSize;
  const end = start + triagePageSize;
  return triageSignals.value.slice(start, end);
});
const triagePageSignalRows = computed(() =>
  triagePageSignals.value.map((signal) => ({
    signal,
    meta: signalMetaForSignal(signal),
    label: formatSignalQueueLabel(signal),
  })),
);
const triagePageCount = computed(() =>
  Math.max(1, Math.ceil(triageSignals.value.length / triagePageSize)),
);

const triageCounts = computed(() => {
  const signals = selectedDaySignals.value
    .filter((signal) => classifySignal(signal) !== "hold")
    .filter(
      (signal) =>
        !selectedDecisionSymbol.value ||
        signal.symbol === selectedDecisionSymbol.value,
    );
  const counts: Record<(typeof triageFilters)[number], number> = {
    all: signals.length,
    buy: 0,
    sell: 0,
  };

  for (const signal of signals) {
    const classification = classifySignal(signal);
    if (classification === "buy" || classification === "sell") {
      counts[classification] += 1;
    }
  }

  return counts;
});

watch(
  triageSignals,
  (signals) => {
    if (signals.length === 0) {
      triagePage.value = 0;
      selectedSignal.value = null;
      selectedSignalId.value = "";
      return;
    }

    const activeSignalId = selectedSignal.value?.id || selectedSignalId.value;
    if (activeSignalId) {
      const activeIndex = signals.findIndex((signal) => signal.id === activeSignalId);
      if (activeIndex >= 0) {
        triagePage.value = Math.floor(activeIndex / triagePageSize);
        return;
      }
    }

    selectedSignal.value = signals[0] ?? null;
    selectedSignalId.value = selectedSignal.value?.id ?? "";
    triagePage.value = Math.min(
      triagePage.value,
      Math.max(0, Math.ceil(signals.length / triagePageSize) - 1),
    );
  },
);

watch(selectedMarketDay, () => {
  marketLedgerPage.value = 0;
  marketWindowPage.value = 0;
  selectedLedgerSnapshotId.value = "";
  selectedMarketWindowReviewId.value = "";
});

watch(selectedMarketDay, () => {
  marketWindowPage.value = 0;
  selectedMarketWindowReviewId.value = "";
  selectedWindowSymbol.value = "";
  selectedOptimizationSymbol.value = "";
});

watch(selectedWindowSymbol, () => {
  windowReviewPage.value = 0;
  selectedWindowReviewId.value = "";
});

watch(
  [selectedMarketDay, selectedDecisionSymbol],
  ([nextDay, nextSymbol], [previousDay, previousSymbol]) => {
    if (nextDay !== previousDay) {
      liveSignalPage.value = 0;
      triagePage.value = 0;
      void requestDashboardRefresh();
    }
    if (nextSymbol !== previousSymbol) {
      triagePage.value = 0;
    }
  },
);

watch(selectedSignal, () => {
  selectedSignalCopyState.value = null;
});

watch(
  selectedSignal,
  (value) => persistChoice("admin.selectedSignalId", value?.id ?? ""),
);

watch(
  displayTimezone,
  (value) => persistChoice("admin.displayTimezone", value),
);

watch(
  triageFilter,
  (value) => persistChoice("admin.triageFilter", value),
);

watch(
  selectedDecisionSymbol,
  (value) => persistChoice("admin.selectedDecisionSymbol", value),
);

watch(
  selectedWindowSymbol,
  (value) => persistChoice("admin.selectedWindowSymbol", value),
);

watch(
  selectedOptimizationSymbol,
  (value) => persistChoice("admin.selectedOptimizationSymbol", value),
);

watch(
  selectedConfigVersion,
  (version) => {
    if (!snapshot.value) {
      return;
    }
    syncConfigDraft(version?.fields ?? snapshot.value.configFields);
  },
  { immediate: true },
);

watch(marketLedgerPageCount, (pageCount) => {
  clampPage(marketLedgerPage, pageCount);
});

watch(windowReviewPageCount, (pageCount) => {
  clampPage(windowReviewPage, pageCount);
});

watch(marketWindowPageCount, (pageCount) => {
  clampPage(marketWindowPage, pageCount);
});

watch(
  [marketSymbols, selectedWindowSymbol],
  ([symbols]) => {
    syncSelectedWindowSymbol(symbols);
  },
);

watch(
  [marketSymbols, selectedOptimizationSymbol],
  ([symbols]) => {
    syncSelectedOptimizationSymbol(symbols);
  },
);

watch(selectedOptimizationSymbol, () => {
  selectedOptimizationReviewId.value = "";
});

watch(
  [decisionSymbols, selectedSignal],
  ([symbols]) => {
    syncSelectedDecisionSymbol(symbols);
  },
);

watch(
  liveSignals,
  (signals) => {
    if (signals.length === 0) {
      liveSignalPage.value = 0;
      return;
    }
    const maxPage = Math.max(
      0,
      Math.ceil(signals.length / LIVE_SIGNAL_PAGE_SIZE) - 1,
    );
    liveSignalPage.value = Math.min(liveSignalPage.value, maxPage);
  },
  { immediate: true },
);

watch(
  latestMarketSnapshots,
  (snapshots) => {
    if (!snapshots.length) {
      selectedLedgerSnapshotId.value = "";
      return;
    }
    if (
      !selectedLedgerSnapshotId.value ||
      !snapshots.some(
        (snapshot) => snapshot.id === selectedLedgerSnapshotId.value,
      )
    ) {
      selectedLedgerSnapshotId.value = snapshots[0].id;
    }
  },
  { immediate: true },
);

watch(
  allWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedWindowReviewId.value = "";
      return;
    }
    if (
      !selectedWindowReviewId.value ||
      !reviews.some((review) => review.id === selectedWindowReviewId.value)
    ) {
      selectedWindowReviewId.value = reviews[0].id;
    }
  },
  { immediate: true },
);

watch(
  selectedWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedWindowReviewId.value = "";
      return;
    }
    if (
      !selectedWindowReviewId.value ||
      !reviews.some((review) => review.id === selectedWindowReviewId.value)
    ) {
      selectedWindowReviewId.value = reviews[0].id;
    }
  },
  { immediate: true },
);

watch(
  marketWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedMarketWindowReviewId.value = "";
      return;
    }
    if (
      !selectedMarketWindowReviewId.value ||
      !reviews.some(
        (review) => review.id === selectedMarketWindowReviewId.value,
      )
    ) {
      selectedMarketWindowReviewId.value = reviews[0].id;
    }
  },
  { immediate: true },
);

watch(
  selectedMarketWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedMarketWindowReviewId.value = "";
      return;
    }
    if (
      !selectedMarketWindowReviewId.value ||
      !reviews.some(
        (review) => review.id === selectedMarketWindowReviewId.value,
      )
    ) {
      selectedMarketWindowReviewId.value = reviews[0].id;
    }
  },
  { immediate: true },
);

watch(
  allOptimizationReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedOptimizationReviewId.value = "";
      return;
    }
    if (
      !selectedOptimizationReviewId.value ||
      !reviews.some(
        (review) => review.id === selectedOptimizationReviewId.value,
      )
    ) {
      selectedOptimizationReviewId.value = reviews[0].id;
    }
  },
  { immediate: true },
);

watch(
  selectedOptimizationSnapshots,
  (snapshots) => {
    if (!snapshots.length) {
      optimizationEntrySnapshotId.value = "";
      optimizationExitSnapshotId.value = "";
      return;
    }
    if (
      !optimizationEntrySnapshotId.value ||
      !snapshots.some(
        (snapshot) => snapshot.id === optimizationEntrySnapshotId.value,
      )
    ) {
      optimizationEntrySnapshotId.value =
        snapshots.find((snapshot) => snapshot.signalAction === "BUY_ALERT")
          ?.id ?? snapshots[0].id;
    }
    if (
      !optimizationExitSnapshotId.value ||
      !snapshots.some(
        (snapshot) => snapshot.id === optimizationExitSnapshotId.value,
      )
    ) {
      optimizationExitSnapshotId.value =
        snapshots.find((snapshot) => snapshot.signalAction === "SELL_ALERT")
          ?.id ??
        snapshots.at(-1)?.id ??
        "";
    }
  },
  { immediate: true },
);

function setTriageFilter(filter: (typeof triageFilters)[number]) {
  triageFilter.value = filter;
}

function setLedgerSnapshot(snapshotPoint: MarketSnapshotRecord) {
  selectedLedgerSnapshotId.value = snapshotPoint.id;
  const matchingWindow = findWindowReviewForSymbolAndTimestamp(
    snapshotPoint.symbol,
    snapshotPoint.timestamp,
    snapshotPoint.windowId,
  );
  if (matchingWindow) {
    selectedMarketWindowReviewId.value = matchingWindow.id;
    selectedWindowReviewId.value = matchingWindow.id;
    selectedOptimizationReviewId.value = matchingWindow.id;
    syncWindowSelectionSymbol(selectedWindowSymbol, matchingWindow.symbol);
    syncWindowSelectionSymbol(selectedOptimizationSymbol, matchingWindow.symbol);
    marketWindowPage.value = pageForWindowId(
      marketWindowReviews.value,
      matchingWindow.id,
      windowReviewPageSize,
    );
    windowReviewPage.value = pageForWindowId(
      allWindowReviews.value,
      matchingWindow.id,
      windowReviewPageSize,
    );
  }
}

function setWindowReview(review: WindowReviewView) {
  selectedMarketWindowReviewId.value = review.id;
  selectedWindowReviewId.value = review.id;
  selectedOptimizationReviewId.value = review.id;
  syncWindowSelectionSymbol(selectedWindowSymbol, review.symbol);
  syncWindowSelectionSymbol(selectedOptimizationSymbol, review.symbol);
  marketWindowPage.value = pageForWindowId(
    marketWindowReviews.value,
    review.id,
    windowReviewPageSize,
  );
  windowReviewPage.value = pageForWindowId(
    allWindowReviews.value,
    review.id,
    windowReviewPageSize,
  );
}

function setSelectedSignal(signal: AdminSignal) {
  selectedSignal.value = signal;
  const matchingWindow = findWindowReviewForSymbolAndTimestamp(
    signal.symbol,
    signal.updatedAt,
    signal.windowId,
  );
  if (matchingWindow) {
    selectedMarketWindowReviewId.value = matchingWindow.id;
    selectedWindowReviewId.value = matchingWindow.id;
    selectedOptimizationReviewId.value = matchingWindow.id;
    syncWindowSelectionSymbol(selectedWindowSymbol, matchingWindow.symbol);
    syncWindowSelectionSymbol(selectedOptimizationSymbol, matchingWindow.symbol);
    marketWindowPage.value = pageForWindowId(
      marketWindowReviews.value,
      matchingWindow.id,
      windowReviewPageSize,
    );
    windowReviewPage.value = pageForWindowId(
      allWindowReviews.value,
      matchingWindow.id,
      windowReviewPageSize,
    );
  }
}

function pageForWindowId(
  reviews: WindowReviewView[],
  windowId: string,
  pageSize: number,
) {
  const index = reviews.findIndex((review) => review.id === windowId);
  if (index < 0 || pageSize <= 0) {
    return 0;
  }
  return Math.floor(index / pageSize);
}

function findWindowReviewForSymbolAndTimestamp(
  symbol: string,
  timestamp: string,
  preferredWindowId = "",
) {
  const reviewPool = tradeWindows.value
    .filter(
      (window) =>
        getMarketDayKey(window.openedAt) === selectedMarketDay.value ||
        (window.closedAt
          ? getMarketDayKey(window.closedAt) === selectedMarketDay.value
          : false),
    )
    .slice()
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .map((window) => decorateWindowReview(window));

  if (preferredWindowId) {
    const directMatch = reviewPool.find(
      (review) => review.id === preferredWindowId,
    );
    if (directMatch) {
      return directMatch;
    }
  }
  const fallbackTimestamp = Date.parse(timestamp);
  return reviewPool.find(
    (review) =>
      review.symbol === symbol &&
      Number.isFinite(fallbackTimestamp) &&
      fallbackTimestamp >= Date.parse(review.openedAt) &&
      (!review.closedAt || fallbackTimestamp <= Date.parse(review.closedAt)),
  );
}

function selectOptimizationPoint(
  kind: "entry" | "exit",
  snapshotPoint: MarketSnapshotRecord,
) {
  if (kind === "entry") {
    optimizationEntrySnapshotId.value = snapshotPoint.id;
    return;
  }
  optimizationExitSnapshotId.value = snapshotPoint.id;
}

function selectOptimizationPointById(
  kind: "entry" | "exit",
  snapshotId: string,
) {
  const snapshotPoint = selectedOptimizationSnapshots.value.find(
    (snapshot) => snapshot.id === snapshotId,
  );
  if (snapshotPoint) {
    selectOptimizationPoint(kind, snapshotPoint);
  }
}

function selectedOptimizationSnapshot(kind: "entry" | "exit") {
  const snapshotId =
    kind === "entry"
      ? optimizationEntrySnapshotId.value
      : optimizationExitSnapshotId.value;
  return (
    selectedOptimizationSnapshots.value.find(
      (snapshot) => snapshot.id === snapshotId,
    ) ?? null
  );
}

function selectedOptimizationSnapshotIndex(kind: "entry" | "exit") {
  const snapshotId =
    kind === "entry"
      ? optimizationEntrySnapshotId.value
      : optimizationExitSnapshotId.value;
  return selectedOptimizationSnapshots.value.findIndex(
    (snapshot) => snapshot.id === snapshotId,
  );
}

function shiftOptimizationPoint(kind: "entry" | "exit", delta: number) {
  const snapshots = selectedOptimizationSnapshots.value;
  if (!snapshots.length) {
    return;
  }
  const currentIndex = selectedOptimizationSnapshotIndex(kind);
  const fallbackIndex =
    kind === "entry"
      ? snapshots.findIndex((snapshot) => snapshot.signalAction === "BUY_ALERT")
      : snapshots.findIndex(
          (snapshot) => snapshot.signalAction === "SELL_ALERT",
        );
  const baseIndex =
    currentIndex >= 0 ? currentIndex : fallbackIndex >= 0 ? fallbackIndex : 0;
  const nextIndex = Math.min(
    Math.max(baseIndex + delta, 0),
    snapshots.length - 1,
  );
  selectOptimizationPoint(kind, snapshots[nextIndex]);
}

function optimizationSnapshotLabel(snapshotPoint: MarketSnapshotRecord | null) {
  if (!snapshotPoint) {
    return "Not selected";
  }
  const action =
    snapshotPoint.signalAction === "BUY_ALERT"
      ? "Buy"
      : snapshotPoint.signalAction === "SELL_ALERT"
        ? "Sell"
        : "Market";
  return `${action} · ${formatLocaleTimestamp(snapshotPoint.timestamp)}`;
}

function nextLedgerPage() {
  marketLedgerPage.value = Math.min(
    marketLedgerPage.value + 1,
    marketLedgerPageCount.value - 1,
  );
}

function previousLedgerPage() {
  marketLedgerPage.value = Math.max(marketLedgerPage.value - 1, 0);
}

function nextWindowPage() {
  windowReviewPage.value = Math.min(
    windowReviewPage.value + 1,
    windowReviewPageCount.value - 1,
  );
}

function previousWindowPage() {
  windowReviewPage.value = Math.max(windowReviewPage.value - 1, 0);
}

function nextMarketWindowPage() {
  marketWindowPage.value = Math.min(
    marketWindowPage.value + 1,
    marketWindowPageCount.value - 1,
  );
}

function previousMarketWindowPage() {
  marketWindowPage.value = Math.max(marketWindowPage.value - 1, 0);
}

function formatWindowOptimizationChange(changePct: number) {
  if (!Number.isFinite(changePct)) {
    return "0.00%";
  }
  const sign = changePct >= 0 ? "+" : "";
  return `${sign}${changePct.toFixed(2)}%`;
}

function setCopyFeedback(
  state: Ref<string | null>,
  timerRef: Ref<number | null>,
  message: string,
) {
  state.value = message;
  if (timerRef.value !== null) {
    window.clearTimeout(timerRef.value);
  }
  timerRef.value = window.setTimeout(() => {
    if (state.value === message) {
      state.value = null;
    }
    timerRef.value = null;
  }, selectedSignalCopyFeedbackDurationMs);
}

async function copyTextToClipboard(
  text: string,
  state: Ref<string | null>,
  timerRef: Ref<number | null>,
  successMessage: string,
  unavailableMessage: string,
  errorMessage: string,
) {
  if (
    !text ||
    typeof navigator === "undefined" ||
    !navigator.clipboard?.writeText
  ) {
    setCopyFeedback(state, timerRef, unavailableMessage);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(state, timerRef, successMessage);
  } catch (error) {
    console.error(`Failed to copy ${successMessage.toLowerCase()}:`, error);
    setCopyFeedback(state, timerRef, errorMessage);
  }
}

async function saveWindowReviewOptimization() {
  if (!snapshot.value || !liveDataAvailable.value) {
    return;
  }
  const review = selectedOptimizationReview.value;
  const entrySnapshot = selectedOptimizationSnapshot("entry");
  const exitSnapshot = selectedOptimizationSnapshot("exit");
  if (!review || !entrySnapshot || !exitSnapshot) {
    return;
  }

  optimizationSaving.value = true;
  optimizationError.value = null;
  try {
    const now = new Date().toISOString();
    const record = await saveWindowOptimization(
      sessionOverview.value.sessionId,
      review,
      entrySnapshot,
      exitSnapshot,
      optimizationNotes.value,
      snapshot.value?.configFields ?? configFields,
      snapshot.value.windowOptimizations ?? [],
      now,
    );
    snapshot.value = {
      ...snapshot.value,
      windowOptimizations: [
        record,
        ...(snapshot.value.windowOptimizations ?? []).filter(
          (item) => item.id !== record.id,
        ),
      ],
    };
    optimizationNotes.value = "";
  } catch (error) {
    console.error("Failed to save window optimization:", error);
    optimizationError.value =
      error instanceof Error
        ? error.message
        : "Failed to save window optimization.";
  } finally {
    optimizationSaving.value = false;
  }
}

function openExpandedChart(chartId: string) {
  chartModalPreviousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  expandedChartId.value = chartId;
  expandedChartZoomX.value = 1;
  expandedChartZoomY.value = 1;
}

function closeExpandedChart() {
  expandedChartId.value = null;
}

async function copySelectedSignalId() {
  const signalId = selectedSignal.value?.id?.trim();
  await copyTextToClipboard(
    signalId ?? "",
    selectedSignalCopyState,
    selectedSignalCopyTimer,
    "Copied signal id",
    "Copy unavailable",
    "Copy failed",
  );
}

async function copySelectedWindowId() {
  const windowId = selectedWindowReview.value?.id?.trim();
  await copyTextToClipboard(
    windowId ?? "",
    selectedWindowCopyState,
    selectedWindowCopyTimer,
    "Copied window id",
    "Copy unavailable",
    "Copy failed",
  );
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0,
  );
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (!expandedChartId.value) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeExpandedChart();
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const modalCard = chartModalCardRef.value;
  if (!modalCard) {
    return;
  }

  const focusable = getFocusableElements(modalCard);
  if (focusable.length === 0) {
    event.preventDefault();
    chartModalCloseButton.value?.focus();
    return;
  }

  const currentIndex = focusable.findIndex(
    (element) => element === document.activeElement,
  );
  const nextIndex = event.shiftKey
    ? currentIndex <= 0
      ? focusable.length - 1
      : currentIndex - 1
    : currentIndex === -1 || currentIndex === focusable.length - 1
      ? 0
      : currentIndex + 1;

  event.preventDefault();
  focusable[nextIndex]?.focus();
}

watch(
  expandedChartId,
  async (chartId) => {
    if (chartId) {
      await nextTick();
      chartModalCloseButton.value?.focus();
      return;
    }

    chartModalPreviousFocus?.focus?.();
    chartModalPreviousFocus = null;
  },
  { immediate: true },
);

function handleConfigVersionClick(version: ConfigVersionRecord) {
  if (
    isConfigDraftDirty.value &&
    selectedConfigVersion.value?.id !== version.id
  ) {
    return;
  }
  selectConfigVersion(version);
}

async function requestDashboardRefresh() {
  if (!liveDataAvailable.value) {
    return;
  }
  if (dashboardRefreshInFlight) {
    dashboardRefreshQueued = true;
    return;
  }

  dashboardRefreshInFlight = true;
  const preserveSelectedConfig = selectedConfigVersionId.value;
  const preserveSelectedSignalId = selectedSignal.value?.id ?? "";
  try {
    const result = await loadDashboardSnapshot({
      allowLiveData: true,
      marketDayKey: selectedMarketDay.value,
    });
    snapshot.value = result.snapshot;
    selectedSignal.value = resolveSelectedSignal(
      result.snapshot.signals,
      preserveSelectedSignalId || selectedSignalId.value,
      result.snapshot.selectedSignal,
    );
    snapshotSource.value = result.source;
    snapshotWarning.value = result.warning;
    if (preserveSelectedConfig === "current") {
      selectConfigVersion(
        result.snapshot.configVersions.find(
          (version) =>
            version.version === result.snapshot.sessionOverview.configVersion,
        ) ??
          result.snapshot.configVersions[0] ??
          null,
      );
    }
  } catch (error) {
    console.error("Failed to refresh dashboard:", error);
  } finally {
    dashboardRefreshInFlight = false;
    if (dashboardRefreshQueued) {
      dashboardRefreshQueued = false;
      void requestDashboardRefresh();
    }
  }
}

function stopRealtimeDashboardListeners() {
  for (const unsubscribe of realtimeUnsubscribers) {
    unsubscribe();
  }
  realtimeUnsubscribers = [];
  realtimeListenerKey = "";
}

function startRealtimeDashboardListeners(
  sessionId: string,
  marketDayKey: string,
) {
  const listenerKey = `${sessionId}:${marketDayKey}`;
  if (
    !liveDataAvailable.value ||
    !sessionId ||
    listenerKey === realtimeListenerKey
  ) {
    return;
  }

  stopRealtimeDashboardListeners();
  realtimeListenerKey = listenerKey;
  const paths = [
    `${MARKET_SESSIONS_COLLECTION}/${sessionId}`,
    `${SIGNAL_EVENTS_COLLECTION}/${sessionId}`,
    `${TRADE_WINDOWS_COLLECTION}/${sessionId}`,
    `${WINDOW_OPTIMIZATIONS_COLLECTION}/${sessionId}`,
    `${MARKET_SNAPSHOTS_COLLECTION}/${sessionId}/${marketDayKey}`,
    `${CONFIG_VERSIONS_COLLECTION}/${sessionId}`,
  ];

  for (const path of paths) {
    const unsubscribe = onValue(databaseRef(rtdb, path), () => {
      if (
        !isMounted ||
        !liveDataAvailable.value ||
        realtimeListenerKey !== listenerKey
      ) {
        return;
      }
      void requestDashboardRefresh();
    });
    realtimeUnsubscribers.push(unsubscribe);
  }
}

async function refreshOnRelevantSignal(payload: MessagePayload) {
  const type = payload.data?.type?.trim().toLowerCase();
  if (type === "decision.accepted" || type === "decision.exited") {
    await requestDashboardRefresh();
  }
}

async function initializeNotifications(promptForPermission: boolean) {
  if (!liveDataAvailable.value) {
    notificationState.value = "failed";
    notificationMessage.value =
      "Cannot enable live updates: live data is unavailable.";
    return;
  }

  const generation = ++notificationSetupGeneration;
  stopLiveSignalNotifications();
  const setup = promptForPermission
    ? setupLiveSignalNotifications
    : probeLiveSignalNotifications;
  const result = await setup(refreshOnRelevantSignal);
  if (!isMounted || generation !== notificationSetupGeneration) {
    result.stop?.();
    return;
  }
  notificationState.value = result.state;
  notificationMessage.value = result.error;
}

async function enableLiveNotifications() {
  await initializeNotifications(true);
}

async function saveConfigVersion() {
  if (!snapshot.value || !liveDataAvailable.value) {
    return;
  }

  try {
    const fields = editableConfigFields.value.map((field) => ({
      ...field,
      value: parseConfigDraftValue(
        field,
        configDraft[field.key] ?? stringifyConfigValue(field.value),
      ),
    }));
    const baseVersion =
      selectedConfigVersion.value?.version ?? currentConfigVersion.value;
    const candidate = await saveConfigCandidate(
      sessionOverview.value.sessionId,
      baseVersion,
      fields,
      `Draft snapshot derived from ${baseVersion}`,
    );

    snapshot.value = {
      ...snapshot.value,
      configVersions: [
        candidate,
        ...snapshot.value.configVersions.filter(
          (version) => version.id !== candidate.id,
        ),
      ],
    };
    selectConfigVersion(candidate);
  } catch (error) {
    console.error("Failed to save config candidate:", error);
  }
}

async function applySelectedVersion(version: ConfigVersionRecord) {
  if (!snapshot.value || !liveDataAvailable.value) {
    return;
  }

  try {
    await applyConfigVersion(
      sessionOverview.value.sessionId,
      currentConfigVersion.value,
      version.version,
    );
    await requestDashboardRefresh();
  } catch (error) {
    console.error("Failed to apply config version:", error);
  }
}

onMounted(async () => {
  dashboardClockTimer = window.setInterval(() => {
    dashboardClock.value = Date.now();
  }, 60_000);

  let allowLiveData = true;
  try {
    authState.value = "authenticating";
    await signInAnonymously(auth);
    authState.value = "authenticated";
  } catch {
    authState.value = "offline";
    allowLiveData = false;
  }

  liveDataAvailable.value = allowLiveData;
  try {
    const result = await loadDashboardSnapshot({
      allowLiveData,
      marketDayKey: selectedMarketDay.value,
    });
    snapshot.value = result.snapshot;
    selectedSignal.value = resolveSelectedSignal(
      result.snapshot.signals,
      selectedSignal.value?.id ?? selectedSignalId.value,
      result.snapshot.selectedSignal,
    );
    snapshotSource.value = result.source;
    snapshotWarning.value = result.warning;
    selectConfigVersion(
      result.snapshot.configVersions.find(
        (version) =>
          version.version === result.snapshot.sessionOverview.configVersion,
      ) ??
        result.snapshot.configVersions[0] ??
        null,
    );
  } catch (error) {
    console.error("Failed to load dashboard snapshot:", error);
  }
  void initializeNotifications(false);
  const scheduleDashboardRefresh = () => {
    if (!isMounted || !liveDataAvailable.value || document.hidden) {
      return;
    }

    if (dashboardRefreshTimer !== null) {
      window.clearTimeout(dashboardRefreshTimer);
    }

    dashboardRefreshTimer = window.setTimeout(async () => {
      dashboardRefreshTimer = null;
      try {
        await requestDashboardRefresh();
      } finally {
        if (isMounted && liveDataAvailable.value && !document.hidden) {
          scheduleDashboardRefresh();
        }
      }
    }, DASHBOARD_REFRESH_INTERVAL_MS);
  };

  const handleVisibilityChange = () => {
    if (dashboardRefreshTimer !== null) {
      window.clearTimeout(dashboardRefreshTimer);
      dashboardRefreshTimer = null;
    }
    if (!document.hidden) {
      scheduleDashboardRefresh();
    }
  };

  dashboardVisibilityChangeHandler = handleVisibilityChange;
  document.addEventListener(
    "visibilitychange",
    dashboardVisibilityChangeHandler,
  );
  window.addEventListener("keydown", handleGlobalKeydown);
  scheduleDashboardRefresh();
  loading.value = false;
});

watch(
  () => snapshot.value?.sessionOverview.sessionId ?? "",
  (sessionId) => {
    startRealtimeDashboardListeners(sessionId, selectedMarketDay.value);
  },
  { immediate: true },
);

watch(
  () => snapshot.value?.sessionOverview.sessionId ?? "",
  (sessionId) => {
    loadTradingSettingsForSession(sessionId);
  },
  { immediate: true },
);

watch(selectedMarketDay, (marketDayKey) => {
  if (snapshot.value?.sessionOverview.sessionId) {
    startRealtimeDashboardListeners(
      snapshot.value.sessionOverview.sessionId,
      marketDayKey,
    );
  }
});

onUnmounted(() => {
  isMounted = false;
  if (selectedSignalCopyTimer.value !== null) {
    window.clearTimeout(selectedSignalCopyTimer.value);
    selectedSignalCopyTimer.value = null;
  }
  if (selectedWindowCopyTimer.value !== null) {
    window.clearTimeout(selectedWindowCopyTimer.value);
    selectedWindowCopyTimer.value = null;
  }
  if (dashboardRefreshTimer !== null) {
    window.clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = null;
  }
  if (dashboardClockTimer !== null) {
    window.clearInterval(dashboardClockTimer);
    dashboardClockTimer = null;
  }
  if (dashboardVisibilityChangeHandler) {
    document.removeEventListener(
      "visibilitychange",
      dashboardVisibilityChangeHandler,
    );
    dashboardVisibilityChangeHandler = null;
  }
  window.removeEventListener("keydown", handleGlobalKeydown);
  stopRealtimeDashboardListeners();
  stopLiveSignalNotifications();
});
</script>

<template>
  <main class="shell">
    <section class="hero trading-panel-layout">
      <div>
        <p class="eyebrow">Trade Signal Engine</p>
        <h1>Live signal control room</h1>
        <p class="lede">
          Monitor live windows, tune strategy settings, and inspect signal state
          without coupling the admin UI to market-data logic.
        </p>
        <label class="timezone-switch">
          <span>Display timezone</span>
          <select v-model="displayTimezone" aria-label="Display timezone">
            <option value="new_york">New York</option>
            <option value="local">Local</option>
          </select>
        </label>
      </div>

      <div class="hero-status-row">
        <div class="hero-status trading-panel">
          <div class="trading-panel-header">
            <div class="trading-panel-heading">
              <div class="status-dot"></div>
              <div>
                <strong>{{ sourceDisplay.title }}</strong>
              </div>
            </div>
            <div class="trading-panel-meta trading-panel-meta-inline">
              <span>Last update</span>
              <strong>{{ formatLocaleTimestamp(sessionOverview.updatedAt) }}</strong>
            </div>
          </div>
          <p v-if="snapshotWarning" class="status-warning">
            {{ snapshotWarning }}
          </p>
          <p v-if="tradingSettingsError" class="status-warning">
            {{ tradingSettingsError }}
          </p>
          <p v-if="tradingSettingsMessage" class="status-success">
            {{ tradingSettingsMessage }}
          </p>
          <div class="trading-panel-actions">
            <button
              type="button"
              class="mode-switch"
              role="switch"
              :aria-checked="tradingMode === 'live'"
              :class="tradingMode"
              :disabled="tradingSettingsLoading || tradingSettingsSaving"
              @click="toggleTradingMode"
            >
              <span class="mode-switch-track">
                <span class="mode-switch-thumb"></span>
              </span>
              <span class="mode-switch-label">
                {{ tradingMode === 'live' ? 'Live Trading' : 'Paper Trading' }}
              </span>
            </button>
            <button
              type="button"
              class="action-button icon-button"
              :disabled="tradingSettingsLoading || tradingAccountRefreshing"
              @click="refreshTradingSettings"
              aria-label="Refresh account"
              title="Refresh account"
            >
              ↻
            </button>
            <button
              type="button"
              class="action-button"
              :class="{ active: tradingSettingsDirty }"
              :disabled="tradingSettingsLoading || tradingSettingsSaving || !tradingSettingsLoaded || !tradingSettingsDirty"
              @click="saveTradingSettingsFromPanel"
            >
              {{ tradingSettingsSaving ? "Saving..." : "Save" }}
            </button>
          </div>
          <div class="trading-settings-panel">
            <div class="trading-management-strip">
              <span class="trading-management-label">Position management</span>
              <div class="position-mode-switches" role="group" aria-label="Position management mode">
                <button
                  v-for="option in tradingPositionModeOptions"
                  :key="option.value"
                  type="button"
                  class="position-mode-button"
                  :class="[option.value, { active: tradingPositionMode === option.value }]"
                  :aria-pressed="tradingPositionMode === option.value"
                  :disabled="tradingSettingsLoading || tradingSettingsSaving"
                  @click="setTradingPositionMode(option.value)"
                >
                  <span class="signal-tier-badge trading-tier-chip" :class="option.badgeClass">
                    <i>{{ option.icon }}</i>
                  </span>
                  <span class="position-mode-copy">
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                </button>
              </div>
            </div>
            <div class="trading-settings-list">
              <label v-for="tier in tradingTierKeys" :key="tier" class="trading-tier-row">
                <span class="signal-tier-badge trading-tier-chip" :class="tier">
                  <i>{{ signalTierLegend[tier].icon }}</i>
                </span>
                <span class="trading-tier-label">{{ signalTierLegend[tier].label }}</span>
                <input
                  v-model.number="tradingAllocations[tier]"
                  type="number"
                  @input="notifyTradingSettingsEdited"
                  min="0"
                  step="10"
                />
              </label>
              <label v-if="tradingPositionMode === 'stop_loss'" class="trading-tier-row trading-tier-row-wide">
                <span class="signal-tier-badge trading-tier-chip stop-loss">
                  <i>SL</i>
                </span>
                <span class="trading-tier-label">Stop loss (%)</span>
                <input
                  v-model.number="tradingStopLossPercent"
                  type="number"
                  @input="notifyTradingSettingsEdited"
                  min="0.01"
                  max="10"
                  step="0.01"
                />
              </label>
              <div v-else-if="tradingPositionMode === 'rebuy'" class="trading-tier-inline-group">
                <label class="trading-tier-row trading-tier-row-wide">
                  <span class="signal-tier-badge trading-tier-chip rebuy">
                    <i>RB</i>
                  </span>
                  <span class="trading-tier-label">Rebuy drop (%)</span>
                  <input
                    v-model.number="tradingRebuyMinDropPercent"
                    type="number"
                    @input="notifyTradingSettingsEdited"
                    min="0.01"
                    max="10"
                    step="0.01"
                  />
                </label>
                <label class="trading-tier-row trading-tier-row-wide">
                  <span class="signal-tier-badge trading-tier-chip rebuy">
                    <i>MR</i>
                  </span>
                  <span class="trading-tier-label">Max rebuys</span>
                  <input
                    v-model.number="tradingRebuyMaxCount"
                    type="number"
                    @input="notifyTradingSettingsEdited"
                    min="1"
                    max="10"
                    step="1"
                  />
                </label>
              </div>
            </div>
          </div>
          <div class="trading-account-grid">
            <article class="trading-account-card">
              <span>Account total</span>
              <strong>{{ formatMoney(tradingAccount?.portfolioValue) }}</strong>
            </article>
            <article class="trading-account-card">
              <span>Buying power</span>
              <strong>{{ formatMoney(tradingAccount?.buyingPower) }}</strong>
            </article>
            <article class="trading-account-card">
              <span>Cash</span>
              <strong>{{ formatMoney(tradingAccount?.cash) }}</strong>
            </article>
            <article class="trading-account-card">
              <span>Account status</span>
              <strong>{{
                tradingAccount?.status || (tradingSettingsLoading ? "Refreshing..." : "Unavailable")
              }}</strong>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section v-if="loading" class="panel">Loading dashboard data...</section>

    <template v-else>
      <section class="metrics">
        <article
          v-for="metric in snapshot?.metrics ?? []"
          :key="metric.label"
          class="metric-card"
        >
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <section class="grid">
        <article class="panel decision-queue-panel">
          <div class="panel-header">
            <h2>Decision queue</h2>
            <div class="panel-header-actions">
              <div class="day-picker-control">
                <input
                  ref="decisionDayPickerRef"
                  v-model="selectedMarketDay"
                  type="date"
                  class="day-picker-native"
                  :max="currentMarketDayKey()"
                  aria-hidden="true"
                  tabindex="-1"
                />
                <button
                  type="button"
                  class="day-picker day-picker-button"
                  :aria-label="`Decision day ${formatMarketDayLabel(selectedMarketDay)}`"
                  :title="`Select decision day · ${formatMarketDayLabel(selectedMarketDay)}`"
                  @click="openNativeDatePicker(decisionDayPickerRef)"
                >
                  <span>{{ formatMarketDayLabel(selectedMarketDay) }}</span>
                  <i> 📅</i>
                </button>
              </div>
              <button
                type="button"
                class="action-button ghost compact"
                :disabled="selectedMarketDay === currentMarketDayKey()"
                @click="selectedMarketDay = currentMarketDayKey()"
              >
                Today
              </button>
              <span
                class="queue-filter-summary"
                :title="
                  selectedDecisionSymbol
                    ? `Decision queue filtered by ${selectedDecisionSymbol}`
                    : 'Decision queue showing all symbols'
                "
              >
                {{ selectedDecisionSymbol || "All" }}
              </span>
            </div>
          </div>
          <div class="symbol-tabs">
            <button
              type="button"
              class="symbol-tab"
              :class="{ active: !selectedDecisionSymbol }"
              @click="selectedDecisionSymbol = ''"
            >
              All
            </button>
            <button
              v-for="symbol in decisionSymbols"
              :key="symbol"
              type="button"
              class="symbol-tab"
              :class="{ active: selectedDecisionSymbol === symbol }"
              @click="selectedDecisionSymbol = symbol"
            >
              {{ symbol }}
            </button>
          </div>
          <div class="signal-tier-legend" aria-label="Buy signal legend">
            <span
              v-for="tier in Object.values(signalTierLegend)"
              :key="tier.tier"
              class="signal-tier-badge"
              :class="tier.tier"
              :title="tier.description"
            >
              <i>{{ tier.icon }}</i>
              {{ tier.label }}
            </span>
            <span class="signal-tier-badge sell" title="Sell signals close or protect existing windows.">
              <i>▼</i>
              Sell
            </span>
          </div>
          <div class="triage-toolbar">
            <button
              v-for="filter in triageFilters"
              :key="filter"
              type="button"
              class="triage-pill"
              :class="{ active: triageFilter === filter }"
              :aria-pressed="triageFilter === filter"
              @click="setTriageFilter(filter)"
            >
              <span>{{
                filter === "all"
                  ? "All decisions"
                  : filter === "buy"
                    ? "Buy"
                    : "Sell"
              }}</span>
              <strong>{{ triageCounts[filter] }}</strong>
            </button>
          </div>
          <div v-if="triagePageSignals.length" class="ledger-toolbar">
            <button
              type="button"
              class="action-button ghost compact"
              :disabled="triagePage === 0"
              @click="triagePage = Math.max(triagePage - 1, 0)"
            >
              Previous
            </button>
            <span class="pager-label"
              >{{ triagePage + 1 }} / {{ triagePageCount }}</span
            >
            <button
              type="button"
              class="action-button ghost compact"
              :disabled="triagePage >= triagePageCount - 1"
              @click="
                triagePage = Math.min(triagePage + 1, triagePageCount - 1)
              "
            >
              Next
            </button>
          </div>
          <div v-if="triagePageSignalRows.length" class="signal-list">
            <button
              v-for="row in triagePageSignalRows"
              :key="signalKey(row.signal)"
              class="signal-row"
              :class="[
                classifySignal(row.signal),
                row.meta?.tier ?? '',
                { active: selectedSignal?.id === row.signal.id },
              ]"
              @click="setSelectedSignal(row.signal)"
            >
              <div>
                <div class="signal-row-title-line">
                  <strong>{{ row.signal.symbol }}</strong>
                  <div v-if="row.meta" class="signal-row-badge-row">
                    <span
                      class="signal-tier-badge"
                      :class="row.meta.tier"
                      :title="row.meta.description"
                    >
                      <i>{{ row.meta.icon }}</i>
                      {{ row.label }}
                    </span>
                  </div>
                </div>
                <p>
                  {{ formatSignalRegimeLabel(row.signal) }} ·
                  {{ row.signal.windowId ? "Linked window" : "Window pending" }}
                </p>
              </div>
              <div class="scores">
                <span>{{ row.signal.entryScore.toFixed(2) }}</span>
                <span>{{ row.signal.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <p v-else class="empty-state">
            No buy or sell decisions have been written for the selected day.
          </p>
        </article>

        <article class="panel decision-queue-panel">
          <div class="panel-header">
            <h2>Selected signal</h2>
            <div class="panel-header-actions selected-signal-actions">
              <span>{{ selectedSignal?.symbol ?? "No signal selected" }}</span>
              <button
                type="button"
                class="action-button ghost compact"
                :disabled="!canCopySelectedSignalId"
                :title="canCopySelectedSignalId ? 'Copy signal id to clipboard' : 'Clipboard unavailable or no signal id available'"
                @click="copySelectedSignalId"
              >
                Copy ID
              </button>
              <span
                v-if="selectedSignalCopyState"
                class="copy-feedback"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {{ selectedSignalCopyState }}
              </span>
            </div>
          </div>
          <div class="detail-card" v-if="selectedSignal">
            <div class="detail-title">
              <div class="selected-signal-headline">
                <span
                  class="signal-action-pill"
                  :class="selectedSignalBadge.tone"
                >
                  <i>{{ selectedSignalBadge.emoji }}</i>
                  {{ selectedSignalBadge.label }}
                </span>
                <span v-if="selectedSignalPrice !== null" class="signal-price-pill">
                  Price {{ selectedSignalPrice.toFixed(2) }}
                </span>
              </div>
              <span
                >Updated
                {{ formatLocaleTimestamp(selectedSignal.updatedAt) }}</span
              >
            </div>
            <div
              v-if="selectedSignalTierMeta"
              class="signal-tier-banner"
              :class="selectedSignalTierMeta.tier"
            >
              <span class="signal-tier-badge" :class="selectedSignalTierMeta.tier">
                <i>{{ selectedSignalTierMeta.icon }}</i>
                {{ selectedSignalTierMeta.label }}
              </span>
              <p>{{ selectedSignalTierMeta.description }}</p>
            </div>
            <div class="score-grid">
              <div>
                <span>Buy score</span>
                <strong>{{ selectedSignal.entryScore.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Sell score</span>
                <strong>{{ selectedSignal.exitScore.toFixed(2) }}</strong>
              </div>
            </div>
            <div v-if="selectedSignalDrivers.length" class="signal-summary-grid signal-driver-grid">
              <div v-for="driver in selectedSignalDrivers" :key="driver.label">
                <span>{{ driver.label }}</span>
                <strong>{{ driver.value }}</strong>
              </div>
            </div>
            <p v-if="selectedSignalReasonSummary" class="signal-reason-summary">
              {{ selectedSignalReasonSummary }}
            </p>
            <ul
              v-if="selectedSignalReasonItems.length"
              class="reason-list reason-card-list"
            >
              <li v-for="reason in selectedSignalReasonItems" :key="reason">
                {{ reason }}
              </li>
            </ul>
            <p v-else class="empty-state compact">
              No detailed signal reasons were recorded for this signal.
            </p>
          </div>
        </article>
      </section>

      <section class="panel two-column">
        <div class="panel-header">
          <h2>Trade windows</h2>
          <div class="panel-header-actions">
            <span>{{ allWindowReviews.length }} windows</span>
            <div class="day-picker-control">
              <input
                ref="windowDayPickerRef"
                v-model="selectedMarketDay"
                type="date"
                class="day-picker-native"
                :max="currentMarketDayKey()"
                aria-hidden="true"
                tabindex="-1"
              />
              <button
                type="button"
                class="day-picker day-picker-button"
                :aria-label="`Trade window day ${formatMarketDayLabel(selectedMarketDay)}`"
                :title="`Select trade window day · ${formatMarketDayLabel(selectedMarketDay)}`"
                @click="openNativeDatePicker(windowDayPickerRef)"
              >
                <span>{{ formatMarketDayLabel(selectedMarketDay) }}</span>
                <i> 📅</i>
              </button>
            </div>
            <button
              type="button"
              class="action-button ghost compact"
              :disabled="selectedMarketDay === currentMarketDayKey()"
              @click="selectedMarketDay = currentMarketDayKey()"
            >
              Today
            </button>
          </div>
        </div>
        <div class="symbol-tabs">
          <button
            type="button"
            class="symbol-tab"
            :class="{ active: !selectedWindowSymbol }"
            @click="selectedWindowSymbol = ''"
          >
            All
          </button>
          <button
            v-for="symbol in marketSymbols"
            :key="`window-${symbol}`"
            type="button"
            class="symbol-tab"
            :class="{ active: selectedWindowSymbol === symbol }"
            @click="selectedWindowSymbol = symbol"
          >
            {{ symbol }}
          </button>
        </div>
        <p>
          Each window shows the buy and sell decision, the change in price, and
          the signal snapshot that pushed the engine into the trade. Use this
          section to compare buy and sell timing, profitability, and the price
          path that followed the window.
        </p>
        <div v-if="selectedWindowReviews.length" class="ledger-toolbar">
          <button
            type="button"
            class="action-button ghost compact"
            :disabled="windowReviewPage === 0"
            @click="previousWindowPage"
          >
            Previous
          </button>
          <span class="pager-label"
            >{{ windowReviewPage + 1 }} / {{ windowReviewPageCount }}</span
          >
          <button
            type="button"
            class="action-button ghost compact"
            :disabled="windowReviewPage >= windowReviewPageCount - 1"
            @click="nextWindowPage"
          >
            Next
          </button>
        </div>
        <div class="two-column-body">
          <div
            v-if="selectedWindowReviews.length"
            class="signal-list compact window-list"
          >
            <button
              v-for="review in selectedWindowReviews"
              :key="windowKey(review)"
              type="button"
              class="signal-row ledger-row"
              :class="{ active: selectedWindowReview?.id === review.id }"
              @click="setWindowReview(review)"
            >
              <div>
                <strong>{{ review.symbol }}</strong>
                <p>
                  {{ formatWindowStatusLabel(review.status) }} ·
                  {{ describeWindowOutcome(review.changePct) }} ·
                  {{
                    review.minutesSinceLastSignal === null
                      ? "Pending"
                      : formatMinutesAgo(review.minutesSinceLastSignal)
                  }}
                </p>
              </div>
              <div class="scores">
                <span>{{ review.entryScore.toFixed(2) }}</span>
                <span>{{ review.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <div v-else class="empty-state">
            No trade windows available for the selected filters and day.
          </div>
          <div v-if="selectedWindowReview" class="detail-card window-detail">
            <div class="detail-title window-detail-title">
              <div class="window-detail-heading">
                <strong>{{ selectedWindowReview.symbol }}</strong>
                <span>{{
                  formatWindowStatusLabel(selectedWindowReview.status)
                }}</span>
              </div>
              <div class="window-detail-actions">
                <button
                  type="button"
                  class="action-button ghost compact"
                  :disabled="!selectedWindowReview.id"
                  :title="selectedWindowReview.id ? 'Copy trade window id to clipboard' : 'No trade window id available'"
                  @click="copySelectedWindowId"
                >
                  Copy ID
                </button>
                <span
                  v-if="selectedWindowCopyState"
                  class="copy-feedback"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {{ selectedWindowCopyState }}
                </span>
              </div>
            </div>
            <div class="score-grid">
              <div>
                <span>Change</span>
                <strong>{{
                  describeWindowOutcome(selectedWindowReview.changePct)
                }}</strong>
              </div>
              <div>
                <span>Total duration</span>
                <strong
                  :class="{
                    'duration-open':
                      selectedWindowReview.durationMinutes === null,
                  }"
                >
                  {{
                    selectedWindowReview.durationMinutes === null
                      ? selectedWindowReview.minutesSinceLastSignal === null
                        ? "Open"
                        : `Open for ${formatElapsedMinutes(selectedWindowReview.minutesSinceLastSignal)}`
                      : `${selectedWindowReview.durationMinutes} min`
                  }}
                </strong>
              </div>
              <div>
                <span>Last signal</span>
                <strong>{{
                  selectedWindowReview.minutesSinceLastSignal === null
                    ? "Pending"
                    : formatMinutesAgo(
                        selectedWindowReview.minutesSinceLastSignal,
                      )
                }}</strong>
              </div>
              <div>
                <span>Buy price</span>
                <strong>{{
                  selectedWindowReview.entryPrice === null
                    ? "--"
                    : selectedWindowReview.entryPrice.toFixed(2)
                }}</strong>
              </div>
              <div>
                <span>Sell price</span>
                <strong>{{
                  selectedWindowReview.exitPrice === null
                    ? "--"
                    : selectedWindowReview.exitPrice.toFixed(2)
                }}</strong>
              </div>
            </div>
            <div class="window-summary-grid">
              <article>
                <span
                  >Buy signal ·
                  {{
                    formatLocaleTimestamp(selectedWindowReview.openedAt)
                  }}</span
                >
                <div class="signal-summary-grid">
                  <div
                    v-for="row in snapshotSummaryRows(
                      selectedWindowReview.buySnapshot,
                    )"
                    :key="`buy-${row.label}`"
                  >
                    <span>{{ row.label }}</span>
                    <strong>{{ row.value }}</strong>
                  </div>
                </div>
                <p class="window-summary-note">
                  {{ selectedWindowReview.buySummary }}
                </p>
              </article>
              <article>
                <span
                  >Sell signal ·
                  {{
                    selectedWindowReview.closedAt
                      ? formatLocaleTimestamp(selectedWindowReview.closedAt)
                      : "Still open"
                  }}</span
                >
                <div
                  class="signal-summary-grid"
                  v-if="selectedWindowReview.sellSnapshot"
                >
                  <div
                    v-for="row in snapshotSummaryRows(
                      selectedWindowReview.sellSnapshot,
                    )"
                    :key="`sell-${row.label}`"
                  >
                    <span>{{ row.label }}</span>
                    <strong>{{ row.value }}</strong>
                  </div>
                </div>
                <p
                  class="window-summary-note"
                  v-if="selectedWindowReview.sellSnapshot"
                >
                  {{ selectedWindowReview.sellSummary }}
                </p>
                <p v-else class="empty-state compact">
                  This window is still open, so the sell snapshot has not been
                  recorded yet.
                </p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Live market charts</h2>
            <p>
              {{
                selectedWindowReview
                  ? `${selectedWindowReview.symbol} · ${formatWindowStatusLabel(selectedWindowReview.status)}`
                  : "Select a trade window to inspect its charts."
              }}
            </p>
            </div>
            <div class="panel-header-actions">
              <div class="chart-global-legend" aria-label="Signal legend">
              <span class="legend-chip" title="Buy signals are highlighted in green."><i class="buy"></i>Buy</span>
              <span class="legend-chip" title="Sell signals are highlighted in red."><i class="sell"></i>Sell</span>
            </div>
            <span>{{ chartIntervalMinutes }}m interval</span>
          </div>
        </div>
        <div class="day-tabs">
          <button
            v-for="interval in chartIntervalOptions"
            :key="interval"
            type="button"
            class="symbol-tab"
            :class="{ active: chartIntervalMinutes === interval }"
            @click="chartIntervalMinutes = interval"
          >
            {{ interval }}m
          </button>
        </div>
        <p class="panel-intro">
          Each chart keeps its own scale and uses the selected trade window as
          its reference. Price uses candles plus one indicator family at a
          time, while oscillators use their native shape and thresholds.
        </p>
        <div
          v-if="selectedWindowReview && selectedChartSnapshots.length"
          class="chart-group-list"
        >
          <article
            v-for="group in chartGroups"
            :key="group.id"
            class="chart-group"
          >
            <button
              type="button"
              class="chart-group-header"
              :aria-expanded="!collapsedChartGroups[group.id]"
              @click="collapsedChartGroups[group.id] = !collapsedChartGroups[group.id]"
            >
              <div>
                <h3>{{ group.title }}</h3>
                <p>{{ group.description }}</p>
              </div>
              <span>{{ collapsedChartGroups[group.id] ? 'Show' : 'Hide' }}</span>
            </button>
            <Transition name="collapse">
              <div v-show="!collapsedChartGroups[group.id]" class="chart-grid">
                <article
                  v-for="chart in group.charts"
                  :key="chart.id"
                  class="chart-card"
                >
                  <div class="chart-card-header">
                    <div>
                      <h3>{{ chart.title }}</h3>
                      <p>{{ chart.subtitle }}</p>
                    </div>
                    <div class="chart-header-actions">
                      <div class="chart-series-legend">
                        <span
                          v-for="series in chart.series"
                          :key="`${chart.id}-${series.label}`"
                          :title="series.description ?? series.label"
                        >
                          <i :style="{ background: series.color }"></i>
                          {{ series.label }}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="action-button ghost compact"
                        @click="openExpandedChart(chart.id)"
                      >
                        Open large
                      </button>
                    </div>
                  </div>
                  <MarketChart
                  :chart="chart"
                  :snapshots="selectedChartSnapshots"
                  :interval-minutes="chartIntervalMinutes"
                  :window-id="selectedWindowReview?.id ?? null"
                  :focus-range="selectedWindowFocusRange"
                  :time-zone="selectedDisplayTimeZoneValue"
                  :height="320"
                />
                </article>
              </div>
            </Transition>
          </article>
        </div>
        <p v-else class="empty-state">
          Select a trade window to load the chart history for that buy/sell
          window.
        </p>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Strategy settings</h2>
          <span>{{ configEditorStatus }}</span>
        </div>
        <div class="config-editor-bar">
          <p>
            Active profile: <strong>{{ currentConfigVersion }}</strong>
            <span v-if="selectedConfigVersion"
              >Viewing: {{ selectedConfigVersion.version }}</span
            >
          </p>
          <button
            type="button"
            class="action-button"
            :disabled="!liveDataAvailable"
            @click="saveConfigVersion"
          >
            Save candidate
          </button>
        </div>
        <p
          v-if="isConfigDraftDirty"
          class="status-warning config-dirty-warning"
        >
          Unsaved draft changes are active. Save before switching versions.
        </p>
        <p class="config-helper-text">
          Tune buy and sell weights independently. Hover each label to see why
          the current value exists and use the review history above to keep the
          strategy moving in small, stable steps.
        </p>
        <div class="config-section-list">
          <article
            v-for="group in configFieldGroups"
            :key="group.label"
            class="config-group"
          >
            <div class="panel-header compact">
              <h3>{{ group.label }}</h3>
              <span>{{ group.fields.length }} fields</span>
            </div>
            <div class="config-grid">
              <article
                v-for="field in group.fields"
                :key="field.key"
                class="config-card"
                :class="{ warning: isConfigValueOutsideBounds(field) }"
              >
                <label :for="field.key" :title="field.description">{{
                  field.label
                }}</label>
                <p class="config-current-value">
                  Current value:
                  <strong>{{ stringifyConfigValue(field.value) }}</strong>
                </p>
                <div
                  v-if="field.inputType === 'symbols'"
                  class="symbol-chip-list"
                >
                  <button
                    v-for="option in symbolChipOptions(field)"
                    :key="option"
                    type="button"
                    class="symbol-chip"
                    :class="{ active: isDraftSymbolSelected(field, option) }"
                    @click="toggleDraftSymbol(field, option)"
                  >
                    {{ option }}
                  </button>
                </div>
                <div
                  v-if="field.inputType === 'symbols'"
                  class="symbol-add-row"
                >
                  <input
                    v-model="symbolAddDrafts[field.key]"
                    type="text"
                    :placeholder="`Add ${field.label.toLowerCase()} symbol`"
                    :aria-label="`Add ${field.label.toLowerCase()} symbol`"
                    class="symbol-add-input"
                    @keydown.enter.prevent="addDraftSymbol(field)"
                  />
                  <button
                    type="button"
                    class="action-button ghost compact"
                    @click="addDraftSymbol(field)"
                  >
                    Add
                  </button>
                </div>
                <template v-else-if="field.inputType === 'number'">
                  <div class="config-slider-shell">
                    <input
                      :id="field.key"
                      v-model.number="configDraft[field.key]"
                      type="range"
                      :min="configFieldBounds(field).min"
                      :max="configFieldBounds(field).max"
                      :step="configFieldBounds(field).step"
                      :title="field.description"
                      class="config-slider"
                    />
                    <input
                      v-model.number="configDraft[field.key]"
                      type="number"
                      :min="configFieldBounds(field).min"
                      :max="configFieldBounds(field).max"
                      :step="configFieldBounds(field).step"
                      :placeholder="field.placeholder"
                      :title="field.description"
                      class="config-number-input"
                      :class="{ outOfRange: isConfigValueOutsideBounds(field) }"
                    />
                  </div>
                  <p
                    class="config-range-note"
                    :class="{ outOfRange: isConfigValueOutsideBounds(field) }"
                  >
                    Range {{ configFieldBounds(field).min }} -
                    {{ configFieldBounds(field).max }} · Current draft
                    {{ draftNumberValue(field).toFixed(2) }}
                    <span v-if="isConfigValueOutsideBounds(field)"
                      >Outside the recommended range.</span
                    >
                  </p>
                </template>
                <input
                  v-else
                  :id="field.key"
                  v-model="configDraft[field.key]"
                  type="text"
                  :placeholder="field.placeholder"
                  :title="field.description"
                />
                <p>{{ field.description }}</p>
              </article>
            </div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Version history</h2>
          <span>Strategy snapshots</span>
        </div>
        <div class="signal-list">
          <article
            v-for="version in configVersions"
            :key="version.id"
            class="signal-row history-row"
            :class="{
              active: selectedConfigVersion?.id === version.id,
              disabled:
                isConfigDraftDirty && selectedConfigVersion?.id !== version.id,
            }"
            @click="handleConfigVersionClick(version)"
          >
            <div>
              <strong>{{ version.version }}</strong>
              <p>{{ version.summary }}</p>
            </div>
            <div class="history-actions">
              <span>{{ version.status }}</span>
              <span>{{ formatLocaleTimestamp(version.updatedAt) }}</span>
              <button
                v-if="version.status !== 'active'"
                type="button"
                class="action-button ghost"
                :disabled="!liveDataAvailable"
                @click.stop="applySelectedVersion(version)"
              >
                {{
                  version.status === "candidate"
                    ? "Promote"
                    : version.status === "archived"
                      ? "Rollback"
                      : "Apply"
                }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <div
        v-if="expandedChartDefinition"
        class="chart-modal"
        @click.self="closeExpandedChart"
      >
        <article
          ref="chartModalCardRef"
          class="panel chart-modal-card"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`expanded-chart-title-${expandedChartDefinition.id}`"
          :aria-describedby="`expanded-chart-desc-${expandedChartDefinition.id}`"
          tabindex="-1"
        >
          <div class="panel-header">
            <div>
              <h2 :id="`expanded-chart-title-${expandedChartDefinition.id}`">
                {{ expandedChartDefinition.title }}
              </h2>
              <p>{{ expandedChartDefinition.subtitle }}</p>
            </div>
            <div class="chart-modal-actions">
              <button
                ref="chartModalCloseButton"
                type="button"
                class="action-button ghost compact"
                @click="closeExpandedChart"
              >
                Close
              </button>
            </div>
          </div>
          <div class="chart-legend">
            <span
              v-for="series in expandedChartDefinition.series"
              :key="`${expandedChartDefinition.id}-${series.label}`"
              :title="series.description ?? series.label"
            >
              <i :style="{ background: series.color }"></i>
              {{ series.label }}
            </span>
          </div>
          <div class="chart-zoom-controls">
            <label>
              <span>Time zoom</span>
              <input
                v-model.number="expandedChartZoomX"
                type="range"
                min="0.4"
                max="2.5"
                step="0.05"
              />
              <strong>{{ Math.round(expandedChartZoomX * 100) }}%</strong>
            </label>
            <label>
              <span>Value zoom</span>
              <input
                v-model.number="expandedChartZoomY"
                type="range"
                min="0.4"
                max="2.5"
                step="0.05"
              />
              <strong>{{ Math.round(expandedChartZoomY * 100) }}%</strong>
            </label>
          </div>
          <MarketChart
            :chart="expandedChartDefinition"
            :snapshots="selectedChartSnapshots"
            :interval-minutes="chartIntervalMinutes"
            :window-id="selectedWindowReview?.id ?? null"
            :focus-range="selectedWindowFocusRange"
            :time-zone="selectedDisplayTimeZoneValue"
            :zoom="{ x: expandedChartZoomX, y: expandedChartZoomY }"
            :height="640"
          />
          <p
            :id="`expanded-chart-desc-${expandedChartDefinition.id}`"
            class="status-warning"
          >
            {{
              selectedWindowReview
                ? `${selectedWindowReview.symbol} · ${formatLocaleTimestamp(selectedWindowReview.lastSignalAt)}`
                : "Select a trade window to populate the chart."
            }}
          </p>
        </article>
      </div>
    </template>
  </main>
</template>
