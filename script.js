(() => {
  "use strict";

  const STORAGE_KEYS = {
    app: "focusflow-app-v2",
    settings: "focusflow-settings-v2",
    theme: "focusflow-theme-v2",
  };

  const DEFAULT_SETTINGS = {
    focusDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    soundEnabled: true,
    darkMode: false,
    dailyGoalMinutes: 120,
  };

  class FocusFlowApp {
    constructor() {
      this.rafId = null;
      this.toastTimeoutId = null;
      this.activePanel = null;

      this.elements = this.cacheElements();
      this.state = this.createInitialState();
    }

    // ---------- App bootstrap ----------
    init() {
      this.loadSettings();
      this.loadAppState();
      this.refreshDailyAndWeeklyStats();
      this.applyTheme(this.state.settings.darkMode ? "dark" : "light");
      this.applyMode(this.state.mode);
      this.updateTimerUI();
      this.updateStats();
      this.populateSettingsForm();
      this.bindEvents();
    }

    cacheElements() {
      return {
        body: document.body,
        topNav: document.getElementById("topNav"),
        timerWrap: document.getElementById("timerWrap"),
        progressCircle: document.getElementById("progressCircle"),
        timerDisplay: document.getElementById("timerDisplay"),
        modeLabel: document.getElementById("modeLabel"),
        modeButtons: [...document.querySelectorAll(".mode-switch__option")],
        startPauseButton: document.getElementById("startPauseButton"),
        resetButton: document.getElementById("resetButton"),
        themeToggle: document.getElementById("themeToggle"),
        toast: document.getElementById("toast"),
        toastMessage: document.getElementById("toastMessage"),

        statsButton: document.getElementById("statsButton"),
        settingsButton: document.getElementById("settingsButton"),
        panelOverlay: document.getElementById("panelOverlay"),
        statsPanel: document.getElementById("statsPanel"),
        settingsPanel: document.getElementById("settingsPanel"),
        panelCloseButtons: [...document.querySelectorAll("[data-close-panel]")],

        statsFocus: document.getElementById("statsFocus"),
        statsFocusMinutes: document.getElementById("statsFocusMinutes"),
        statsSessions: document.getElementById("statsSessions"),
        statsStreak: document.getElementById("statsStreak"),
        statsWeekly: document.getElementById("statsWeekly"),
        dailyGoalMeta: document.getElementById("dailyGoalMeta"),
        dailyGoalFill: document.getElementById("dailyGoalFill"),

        settingsForm: document.getElementById("settingsForm"),
        focusDurationInput: document.getElementById("focusDurationInput"),
        shortBreakDurationInput: document.getElementById("shortBreakDurationInput"),
        longBreakDurationInput: document.getElementById("longBreakDurationInput"),
        soundToggleInput: document.getElementById("soundToggleInput"),
        darkModeToggleInput: document.getElementById("darkModeToggleInput"),
        resetDefaultsButton: document.getElementById("resetDefaultsButton"),
      };
    }

    createInitialState() {
      return {
        settings: { ...DEFAULT_SETTINGS },
        mode: "pomodoro",
        isRunning: false,
        durationSeconds: DEFAULT_SETTINGS.focusDuration * 60,
        remainingSeconds: DEFAULT_SETTINGS.focusDuration * 60,
        endWallClockMs: null,
        completedFocusSessionsInCycle: 0,
        stats: {
          currentDate: this.getDateStamp(),
          sessionsCompletedToday: 0,
          focusMinutesToday: 0,
          streakDays: 0,
          lastStreakIncrementDate: null,
          historyByDate: {},
        },
      };
    }

    // ---------- Events ----------
    bindEvents() {
      this.elements.startPauseButton.addEventListener("click", () => {
        this.state.isRunning ? this.pauseTimer() : this.startTimer();
      });

      this.elements.resetButton.addEventListener("click", () => this.resetTimer());

      this.elements.modeButtons.forEach((button) => {
        button.addEventListener("click", () => this.switchMode(button.dataset.mode));
      });

      this.elements.themeToggle.addEventListener("click", () => {
        const next = this.elements.body.dataset.theme === "dark" ? "light" : "dark";
        this.state.settings.darkMode = next === "dark";
        this.applyTheme(next);
        this.saveSettings();
      });

      this.elements.statsButton.addEventListener("click", () => this.openPanel("stats"));
      this.elements.settingsButton.addEventListener("click", () => this.openPanel("settings"));

      this.elements.panelOverlay.addEventListener("click", () => this.closePanel());
      this.elements.panelCloseButtons.forEach((button) => {
        button.addEventListener("click", () => this.closePanel());
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.closePanel();
      });

      this.elements.settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.saveSettings();
        this.showToast("Settings saved.");
      });

      this.elements.resetDefaultsButton.addEventListener("click", () => {
        this.state.settings = { ...DEFAULT_SETTINGS };
        this.populateSettingsForm();
        this.saveSettings();
        this.applyTheme(this.state.settings.darkMode ? "dark" : "light");
        this.applyDurationsToCurrentMode();
        this.showToast("Defaults restored.");
      });
    }

    // ---------- Timer ----------
    startTimer() {
      if (this.state.isRunning) return;
      this.state.isRunning = true;
      this.state.endWallClockMs = Date.now() + this.state.remainingSeconds * 1000;
      this.enterFocusMode();
      this.updateStartPauseButton();
      this.persistAppState();
      this.scheduleTick();
    }

    pauseTimer() {
      if (!this.state.isRunning) return;
      this.state.remainingSeconds = Math.max(0, (this.state.endWallClockMs - Date.now()) / 1000);
      this.state.isRunning = false;
      this.state.endWallClockMs = null;
      this.exitFocusMode();
      this.cancelTick();
      this.updateTimerUI();
      this.updateStartPauseButton();
      this.persistAppState();
    }

    resetTimer() {
      this.pauseTimer();
      this.state.remainingSeconds = this.state.durationSeconds;
      this.updateTimerUI();
      this.persistAppState();
    }

    switchMode(mode) {
      if (!["pomodoro", "shortBreak", "longBreak"].includes(mode)) return;
      this.pauseTimer();
      this.state.mode = mode;
      this.applyDurationsToCurrentMode();
      this.applyMode(mode);
      this.updateTimerUI();
      this.persistAppState();
    }

    scheduleTick() {
      this.cancelTick();
      this.rafId = requestAnimationFrame(() => this.tick());
    }

    cancelTick() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    tick() {
      if (!this.state.isRunning) return;

      const remainingMs = Math.max(0, this.state.endWallClockMs - Date.now());
      this.state.remainingSeconds = remainingMs / 1000;
      this.updateTimerUI();

      if (remainingMs <= 0) {
        this.completeInterval();
        return;
      }

      this.scheduleTick();
    }

    completeInterval() {
      this.state.isRunning = false;
      this.state.endWallClockMs = null;
      this.cancelTick();
      this.exitFocusMode();

      const completedMode = this.state.mode;
      if (completedMode === "pomodoro") {
        this.recordFocusSession();
        this.state.completedFocusSessionsInCycle += 1;
      }

      const nextMode = this.getNextMode(completedMode);
      this.state.mode = nextMode;
      this.applyDurationsToCurrentMode();
      this.applyMode(nextMode);
      this.updateTimerUI();
      this.updateStartPauseButton();

      if (this.state.settings.soundEnabled) this.playNotification();
      this.showToast(`${this.getModeLabel(completedMode)} completed. Switched to ${this.getModeLabel(nextMode)}.`);
      this.persistAppState();
    }

    getNextMode(completedMode) {
      if (completedMode === "pomodoro") {
        if (this.state.completedFocusSessionsInCycle >= 4) {
          this.state.completedFocusSessionsInCycle = 0;
          return "longBreak";
        }
        return "shortBreak";
      }
      return "pomodoro";
    }

    applyDurationsToCurrentMode() {
      const minutes = this.state.mode === "pomodoro"
        ? this.state.settings.focusDuration
        : this.state.mode === "shortBreak"
        ? this.state.settings.shortBreakDuration
        : this.state.settings.longBreakDuration;

      this.state.durationSeconds = minutes * 60;
      this.state.remainingSeconds = this.state.durationSeconds;
    }

    // ---------- Panels ----------
    openPanel(panelType) {
      const target = panelType === "stats" ? this.elements.statsPanel : this.elements.settingsPanel;
      const other = panelType === "stats" ? this.elements.settingsPanel : this.elements.statsPanel;
      if (!target) return;

      other.classList.remove("is-open");
      other.setAttribute("aria-hidden", "true");

      target.classList.add("is-open");
      target.setAttribute("aria-hidden", "false");
      this.elements.panelOverlay.hidden = false;
      requestAnimationFrame(() => this.elements.panelOverlay.classList.add("is-visible"));
      this.elements.body.classList.add("no-scroll");
      this.activePanel = panelType;

      if (panelType === "stats") this.updateStats();
      if (panelType === "settings") this.populateSettingsForm();
    }

    closePanel() {
      if (!this.activePanel) return;
      this.elements.statsPanel.classList.remove("is-open");
      this.elements.settingsPanel.classList.remove("is-open");
      this.elements.statsPanel.setAttribute("aria-hidden", "true");
      this.elements.settingsPanel.setAttribute("aria-hidden", "true");
      this.elements.panelOverlay.classList.remove("is-visible");
      this.elements.body.classList.remove("no-scroll");
      this.activePanel = null;
      window.setTimeout(() => {
        if (!this.activePanel) this.elements.panelOverlay.hidden = true;
      }, 360);
    }

    // ---------- Settings ----------
    saveSettings() {
      const newSettings = {
        focusDuration: this.sanitizeNumber(this.elements.focusDurationInput.value, 25, 1, 120),
        shortBreakDuration: this.sanitizeNumber(this.elements.shortBreakDurationInput.value, 5, 1, 60),
        longBreakDuration: this.sanitizeNumber(this.elements.longBreakDurationInput.value, 15, 1, 120),
        soundEnabled: Boolean(this.elements.soundToggleInput.checked),
        darkMode: Boolean(this.elements.darkModeToggleInput.checked),
        dailyGoalMinutes: this.state.settings.dailyGoalMinutes,
      };

      this.state.settings = newSettings;
      this.applyTheme(newSettings.darkMode ? "dark" : "light");
      this.applyDurationsToCurrentMode();
      this.applyMode(this.state.mode);
      this.updateTimerUI();
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(newSettings));
      this.persistAppState();
      this.updateStats();
    }

    loadSettings() {
      const saved = localStorage.getItem(STORAGE_KEYS.settings);
      if (!saved) return;

      try {
        const parsed = JSON.parse(saved);
        this.state.settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
        };
      } catch {
        this.state.settings = { ...DEFAULT_SETTINGS };
      }
    }

    populateSettingsForm() {
      this.elements.focusDurationInput.value = this.state.settings.focusDuration;
      this.elements.shortBreakDurationInput.value = this.state.settings.shortBreakDuration;
      this.elements.longBreakDurationInput.value = this.state.settings.longBreakDuration;
      this.elements.soundToggleInput.checked = this.state.settings.soundEnabled;
      this.elements.darkModeToggleInput.checked = this.state.settings.darkMode;
    }

    // ---------- Stats ----------
    updateStats() {
      const stats = this.state.stats;
      const focusToday = Math.round(stats.focusMinutesToday);
      const weeklyMinutes = this.calculateWeeklyFocusMinutes();
      const progress = Math.min(100, Math.round((focusToday / this.state.settings.dailyGoalMinutes) * 100));

      const focusText = `You've focused for ${focusToday} minutes today.`;
      const sessionsText = `Sessions completed: ${stats.sessionsCompletedToday}`;
      const streakText = `Daily streak: ${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`;

      this.elements.statsFocusMinutes.textContent = `${focusToday} min`;
      this.elements.statsFocus.textContent = focusText;
      this.elements.statsSessions.textContent = sessionsText;
      this.elements.statsStreak.textContent = streakText;
      this.elements.statsWeekly.textContent = `Weekly focus time: ${weeklyMinutes} minutes`;
      this.elements.dailyGoalMeta.textContent = `${progress}%`;
      this.elements.dailyGoalFill.style.width = `${progress}%`;
    }

    recordFocusSession() {
      this.refreshDailyAndWeeklyStats();

      const minutes = this.state.settings.focusDuration;
      const today = this.getDateStamp();

      this.state.stats.sessionsCompletedToday += 1;
      this.state.stats.focusMinutesToday += minutes;
      this.state.stats.historyByDate[today] = (this.state.stats.historyByDate[today] || 0) + minutes;

      if (this.state.stats.lastStreakIncrementDate !== today) {
        if (!this.state.stats.lastStreakIncrementDate) {
          this.state.stats.streakDays = 1;
        } else {
          const diff = this.getDayDifference(this.state.stats.lastStreakIncrementDate, today);
          this.state.stats.streakDays = diff === 1 ? this.state.stats.streakDays + 1 : 1;
        }
        this.state.stats.lastStreakIncrementDate = today;
      }

      this.updateStats();
    }

    refreshDailyAndWeeklyStats() {
      const today = this.getDateStamp();
      if (this.state.stats.currentDate !== today) {
        this.state.stats.currentDate = today;
        this.state.stats.sessionsCompletedToday = 0;
        this.state.stats.focusMinutesToday = 0;
      }

      const oldestAllowed = this.getDateStamp(-6);
      Object.keys(this.state.stats.historyByDate).forEach((dateKey) => {
        if (dateKey < oldestAllowed) delete this.state.stats.historyByDate[dateKey];
      });
    }

    calculateWeeklyFocusMinutes() {
      this.refreshDailyAndWeeklyStats();
      return Object.values(this.state.stats.historyByDate).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
    }

    // ---------- UI helpers ----------
    applyMode(mode) {
      this.elements.body.dataset.mode = mode;
      this.elements.modeLabel.textContent = this.getModeLabel(mode);
      this.elements.modeButtons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
    }

    applyTheme(theme) {
      this.elements.body.dataset.theme = theme;
      this.elements.themeToggle.setAttribute("aria-checked", String(theme === "dark"));
      this.elements.darkModeToggleInput.checked = theme === "dark";
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    }

    enterFocusMode() {
      this.elements.body.classList.add("is-focusing");
      this.elements.topNav.classList.add("is-hidden");
      this.elements.timerWrap.classList.add("is-running");
    }

    exitFocusMode() {
      this.elements.body.classList.remove("is-focusing");
      this.elements.topNav.classList.remove("is-hidden");
      this.elements.timerWrap.classList.remove("is-running");
    }

    updateTimerUI() {
      const displaySeconds = Math.ceil(this.state.remainingSeconds);
      this.elements.timerDisplay.textContent = this.formatClock(displaySeconds);

      const radius = this.elements.progressCircle.r.baseVal.value;
      const circumference = 2 * Math.PI * radius;
      const progress = 1 - this.state.remainingSeconds / this.state.durationSeconds;

      this.elements.progressCircle.style.strokeDasharray = `${circumference}`;
      this.elements.progressCircle.style.strokeDashoffset = `${circumference * (1 - Math.min(1, Math.max(0, progress)))}`;
    }

    updateStartPauseButton() {
      this.elements.startPauseButton.textContent = this.state.isRunning ? "Pause" : "Start";
    }

    showToast(message) {
      this.elements.toastMessage.textContent = message;
      this.elements.toast.classList.add("is-visible");
      this.elements.toast.setAttribute("aria-hidden", "false");
      if (this.toastTimeoutId) clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = window.setTimeout(() => {
        this.elements.toast.classList.remove("is-visible");
        this.elements.toast.setAttribute("aria-hidden", "true");
      }, 3200);
    }

    playNotification() {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.62);
    }

    // ---------- Persistence ----------
    persistAppState() {
      const payload = {
        mode: this.state.mode,
        isRunning: this.state.isRunning,
        durationSeconds: this.state.durationSeconds,
        remainingSeconds: this.state.remainingSeconds,
        endWallClockMs: this.state.isRunning ? Date.now() + this.state.remainingSeconds * 1000 : null,
        completedFocusSessionsInCycle: this.state.completedFocusSessionsInCycle,
        stats: this.state.stats,
      };
      localStorage.setItem(STORAGE_KEYS.app, JSON.stringify(payload));
    }

    loadAppState() {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (savedTheme) this.state.settings.darkMode = savedTheme === "dark";

      const raw = localStorage.getItem(STORAGE_KEYS.app);
      if (!raw) {
        this.applyDurationsToCurrentMode();
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        this.state.mode = ["pomodoro", "shortBreak", "longBreak"].includes(parsed.mode) ? parsed.mode : "pomodoro";
        this.state.completedFocusSessionsInCycle = Number(parsed.completedFocusSessionsInCycle) || 0;
        this.state.stats = {
          ...this.state.stats,
          ...(parsed.stats || {}),
          historyByDate: { ...(parsed.stats?.historyByDate || {}) },
        };

        this.applyDurationsToCurrentMode();

        if (parsed.isRunning && parsed.endWallClockMs) {
          const remaining = Math.max(0, (parsed.endWallClockMs - Date.now()) / 1000);
          this.state.remainingSeconds = remaining > 0 ? remaining : this.state.durationSeconds;
          this.state.isRunning = remaining > 0;
          if (this.state.isRunning) {
            this.state.endWallClockMs = Date.now() + this.state.remainingSeconds * 1000;
            this.enterFocusMode();
            this.scheduleTick();
          }
        }
      } catch {
        this.applyDurationsToCurrentMode();
      }

      this.updateStartPauseButton();
      this.persistAppState();
    }

    // ---------- Utility ----------
    getModeLabel(mode) {
      return mode === "pomodoro" ? "Pomodoro" : mode === "shortBreak" ? "Short Break" : "Long Break";
    }

    sanitizeNumber(value, fallback, min, max) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    }

    formatClock(totalSeconds) {
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      return `${minutes}:${seconds}`;
    }

    getDateStamp(offsetDays = 0) {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    getDayDifference(fromDate, toDate) {
      const from = new Date(`${fromDate}T00:00:00`);
      const to = new Date(`${toDate}T00:00:00`);
      return Math.round((to - from) / (24 * 60 * 60 * 1000));
    }
  }

  const app = new FocusFlowApp();
  app.init();
})();
