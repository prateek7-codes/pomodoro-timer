(() => {
  "use strict";

  // ==============================
  // Constants and defaults
  // ==============================
  const STORAGE_KEYS = {
    app: "focusflow-app-v3",
    settings: "focusflow-settings-v3",
    theme: "focusflow-theme-v3",
  };

  const DEFAULT_SETTINGS = {
    focusDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    soundEnabled: true,
    darkMode: false,
    dailyGoalMinutes: 120,
  };

  const MODE_LABELS = {
    pomodoro: "Pomodoro",
    shortBreak: "Short Break",
    longBreak: "Long Break",
  };

  class FocusFlowApp {
    constructor() {
      this.elements = this.cacheElements();

      // Required modular state variables
      this.isRunning = false;
      this.currentMode = "pomodoro";
      this.durations = {
        pomodoro: DEFAULT_SETTINGS.focusDuration * 60,
        shortBreak: DEFAULT_SETTINGS.shortBreakDuration * 60,
        longBreak: DEFAULT_SETTINGS.longBreakDuration * 60,
      };
      this.remainingTime = this.durations.pomodoro;

      this.settings = { ...DEFAULT_SETTINGS };
      this.completedFocusSessionsInCycle = 0;
      this.intervalId = null;
      this.endTimestamp = null;
      this.toastTimeoutId = null;
      this.activePanel = null;

      this.stats = {
        currentDate: this.getDateStamp(),
        sessionsCompletedToday: 0,
        focusMinutesToday: 0,
        streakDays: 0,
        lastStreakIncrementDate: null,
        historyByDate: {},
      };

      this.currentPomodoroBaseMinutes = 0;
      this.lastDisplayedProgressMinute = -1;
    }

    init() {
      this.loadSettings();
      this.loadAppState();
      this.refreshDateBoundaries();
      this.applyTheme(this.settings.darkMode ? "dark" : "light");
      this.applyModeUI();
      this.populateSettingsForm();
      this.updateDisplay();
      this.updateStats();
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

        statsButton: document.getElementById("statsButton"),
        settingsButton: document.getElementById("settingsButton"),
        panelOverlay: document.getElementById("panelOverlay"),
        statsPanel: document.getElementById("statsPanel"),
        settingsPanel: document.getElementById("settingsPanel"),
        panelCloseButtons: [...document.querySelectorAll("[data-close-panel]")],

        statsFocusMinutes: document.getElementById("statsFocusMinutes"),
        statsFocus: document.getElementById("statsFocus"),
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

        toast: document.getElementById("toast"),
        toastMessage: document.getElementById("toastMessage"),
      };
    }

    bindEvents() {
      this.elements.startPauseButton.addEventListener("click", () => {
        this.isRunning ? this.pauseTimer() : this.startTimer();
      });

      this.elements.resetButton.addEventListener("click", () => this.resetTimer());

      this.elements.modeButtons.forEach((button) => {
        button.addEventListener("click", () => this.switchMode(button.dataset.mode));
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

      this.elements.themeToggle.addEventListener("click", () => {
        this.settings.darkMode = !this.settings.darkMode;
        this.applyTheme(this.settings.darkMode ? "dark" : "light");
        this.populateSettingsForm();
        this.saveSettings();
      });

      this.elements.settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.saveSettings();
        this.showToast("Settings saved.");
      });

      this.elements.resetDefaultsButton.addEventListener("click", () => {
        this.settings = { ...DEFAULT_SETTINGS };
        this.applyDurationsFromSettings();
        this.switchMode(this.currentMode);
        this.applyTheme(this.settings.darkMode ? "dark" : "light");
        this.populateSettingsForm();
        this.saveSettings();
        this.showToast("Default settings restored.");
      });
    }

    // ==============================
    // Timer logic
    // ==============================
    startTimer() {
      if (this.isRunning) return;

      this.clearTimerInterval();
      this.isRunning = true;
      this.endTimestamp = Date.now() + this.remainingTime * 1000;

      if (this.currentMode === "pomodoro") {
        this.currentPomodoroBaseMinutes = this.stats.focusMinutesToday;
        this.lastDisplayedProgressMinute = -1;
      }

      this.enterFocusMode();
      this.updateStartPauseLabel();
      this.persistAppState();

      this.intervalId = window.setInterval(() => {
        this.tick();
      }, 80);
    }

    pauseTimer() {
      if (!this.isRunning) return;

      this.remainingTime = Math.max(0, (this.endTimestamp - Date.now()) / 1000);
      this.isRunning = false;
      this.endTimestamp = null;
      this.clearTimerInterval();

      this.exitFocusMode();
      this.updateDisplay();
      this.updateStartPauseLabel();
      this.updateStats();
      this.persistAppState();
    }

    resetTimer() {
      this.isRunning = false;
      this.endTimestamp = null;
      this.clearTimerInterval();
      this.remainingTime = this.durations[this.currentMode];
      this.lastDisplayedProgressMinute = -1;

      this.exitFocusMode();
      this.updateDisplay();
      this.updateStartPauseLabel();
      this.persistAppState();
    }

    switchMode(mode) {
      if (!Object.prototype.hasOwnProperty.call(this.durations, mode)) return;

      this.isRunning = false;
      this.endTimestamp = null;
      this.clearTimerInterval();
      this.currentMode = mode;
      this.remainingTime = this.durations[mode];
      this.lastDisplayedProgressMinute = -1;

      this.exitFocusMode();
      this.applyModeUI();
      this.updateDisplay();
      this.updateStartPauseLabel();
      this.persistAppState();
    }

    tick() {
      if (!this.isRunning) return;

      const remainingMs = Math.max(0, this.endTimestamp - Date.now());
      this.remainingTime = remainingMs / 1000;
      this.updateDisplay();

      if (this.currentMode === "pomodoro") {
        this.updateLiveFocusMinutes();
      }

      if (remainingMs <= 0) {
        this.completeTimer();
      }
    }

    clearTimerInterval() {
      if (this.intervalId) {
        window.clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }

    completeTimer() {
      const finishedMode = this.currentMode;

      this.isRunning = false;
      this.endTimestamp = null;
      this.clearTimerInterval();
      this.exitFocusMode();

      if (finishedMode === "pomodoro") {
        this.recordPomodoroCompletion();
      }

      const nextMode = this.getNextMode(finishedMode);
      this.currentMode = nextMode;
      this.remainingTime = this.durations[nextMode];
      this.lastDisplayedProgressMinute = -1;

      this.applyModeUI();
      this.updateDisplay();
      this.updateStartPauseLabel();
      this.updateStats();
      this.persistAppState();

      if (this.settings.soundEnabled) this.playNotification();
      this.showToast(`${MODE_LABELS[finishedMode]} complete. Switched to ${MODE_LABELS[nextMode]}.`);
    }

    getNextMode(finishedMode) {
      if (finishedMode === "pomodoro") {
        this.completedFocusSessionsInCycle += 1;
        if (this.completedFocusSessionsInCycle >= 4) {
          this.completedFocusSessionsInCycle = 0;
          return "longBreak";
        }
        return "shortBreak";
      }
      return "pomodoro";
    }

    updateDisplay() {
      this.elements.timerDisplay.textContent = this.formatClock(Math.ceil(this.remainingTime));
      this.updateProgressRing();
    }

    updateProgressRing() {
      const radius = this.elements.progressCircle.r.baseVal.value;
      const circumference = 2 * Math.PI * radius;
      const total = this.durations[this.currentMode];
      const progress = 1 - this.remainingTime / total;
      const safeProgress = Math.min(1, Math.max(0, progress));

      this.elements.progressCircle.style.strokeDasharray = `${circumference}`;
      this.elements.progressCircle.style.strokeDashoffset = `${circumference * (1 - safeProgress)}`;
    }

    updateStartPauseLabel() {
      this.elements.startPauseButton.textContent = this.isRunning ? "Pause" : "Start";
    }

    applyModeUI() {
      this.elements.body.dataset.mode = this.currentMode;
      this.elements.modeLabel.textContent = MODE_LABELS[this.currentMode];
      this.elements.modeButtons.forEach((button) => {
        const active = button.dataset.mode === this.currentMode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
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

    // ==============================
    // Panels
    // ==============================
    openPanel(panelType) {
      const openTarget = panelType === "stats" ? this.elements.statsPanel : this.elements.settingsPanel;
      const closeTarget = panelType === "stats" ? this.elements.settingsPanel : this.elements.statsPanel;

      closeTarget.classList.remove("is-open");
      closeTarget.setAttribute("aria-hidden", "true");

      openTarget.classList.add("is-open");
      openTarget.setAttribute("aria-hidden", "false");

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

    // ==============================
    // Stats and persistence
    // ==============================
    updateLiveFocusMinutes() {
      const elapsed = this.durations.pomodoro - this.remainingTime;
      const elapsedWholeMinutes = Math.floor(elapsed / 60);

      if (elapsedWholeMinutes !== this.lastDisplayedProgressMinute) {
        this.lastDisplayedProgressMinute = elapsedWholeMinutes;
        this.stats.focusMinutesToday = this.currentPomodoroBaseMinutes + elapsedWholeMinutes;
        this.stats.historyByDate[this.getDateStamp()] = this.stats.focusMinutesToday;
        this.updateStats();
      }
    }

    recordPomodoroCompletion() {
      this.refreshDateBoundaries();
      const today = this.getDateStamp();
      const focusMinutes = this.settings.focusDuration;

      this.stats.sessionsCompletedToday += 1;
      this.stats.focusMinutesToday = this.currentPomodoroBaseMinutes + focusMinutes;
      this.stats.historyByDate[today] = this.stats.focusMinutesToday;

      if (this.stats.lastStreakIncrementDate !== today) {
        if (!this.stats.lastStreakIncrementDate) {
          this.stats.streakDays = 1;
        } else {
          const diff = this.getDayDifference(this.stats.lastStreakIncrementDate, today);
          this.stats.streakDays = diff === 1 ? this.stats.streakDays + 1 : 1;
        }
        this.stats.lastStreakIncrementDate = today;
      }
    }

    updateStats() {
      this.refreshDateBoundaries();

      const focusToday = Math.max(0, Math.round(this.stats.focusMinutesToday));
      const weekly = this.getWeeklyFocusMinutes();
      const goalPct = Math.min(100, Math.round((focusToday / this.settings.dailyGoalMinutes) * 100));

      this.elements.statsFocusMinutes.textContent = `${focusToday} min`;
      this.elements.statsFocus.textContent = `You've focused for ${focusToday} minutes today.`;
      this.elements.statsSessions.textContent = `Sessions completed: ${this.stats.sessionsCompletedToday}`;
      this.elements.statsStreak.textContent = `Daily streak: ${this.stats.streakDays} day${this.stats.streakDays === 1 ? "" : "s"}`;
      this.elements.statsWeekly.textContent = `Weekly focus time: ${weekly} minutes`;
      this.elements.dailyGoalMeta.textContent = `${goalPct}%`;
      this.elements.dailyGoalFill.style.width = `${goalPct}%`;
    }

    refreshDateBoundaries() {
      const today = this.getDateStamp();
      if (this.stats.currentDate !== today) {
        this.stats.currentDate = today;
        this.stats.sessionsCompletedToday = 0;
        this.stats.focusMinutesToday = 0;
      }

      const oldestAllowed = this.getDateStamp(-6);
      Object.keys(this.stats.historyByDate).forEach((dateKey) => {
        if (dateKey < oldestAllowed) delete this.stats.historyByDate[dateKey];
      });

      if (!Object.prototype.hasOwnProperty.call(this.stats.historyByDate, today)) {
        this.stats.historyByDate[today] = this.stats.focusMinutesToday;
      }
    }

    getWeeklyFocusMinutes() {
      return Object.values(this.stats.historyByDate).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
    }

    persistAppState() {
      const payload = {
        isRunning: this.isRunning,
        currentMode: this.currentMode,
        durations: this.durations,
        remainingTime: this.remainingTime,
        endTimestamp: this.isRunning ? Date.now() + this.remainingTime * 1000 : null,
        completedFocusSessionsInCycle: this.completedFocusSessionsInCycle,
        stats: this.stats,
      };
      localStorage.setItem(STORAGE_KEYS.app, JSON.stringify(payload));
    }

    loadAppState() {
      const raw = localStorage.getItem(STORAGE_KEYS.app);
      if (!raw) {
        this.applyDurationsFromSettings();
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        this.currentMode = Object.prototype.hasOwnProperty.call(MODE_LABELS, parsed.currentMode)
          ? parsed.currentMode
          : "pomodoro";

        this.durations = {
          pomodoro: Number(parsed.durations?.pomodoro) || this.settings.focusDuration * 60,
          shortBreak: Number(parsed.durations?.shortBreak) || this.settings.shortBreakDuration * 60,
          longBreak: Number(parsed.durations?.longBreak) || this.settings.longBreakDuration * 60,
        };

        this.remainingTime = Number(parsed.remainingTime) || this.durations[this.currentMode];
        this.completedFocusSessionsInCycle = Number(parsed.completedFocusSessionsInCycle) || 0;
        this.stats = {
          ...this.stats,
          ...(parsed.stats || {}),
          historyByDate: { ...(parsed.stats?.historyByDate || {}) },
        };

        if (parsed.isRunning && parsed.endTimestamp) {
          const remaining = Math.max(0, (parsed.endTimestamp - Date.now()) / 1000);
          if (remaining > 0) {
            this.isRunning = false;
            this.remainingTime = remaining;
            this.startTimer();
          }
        }
      } catch {
        this.applyDurationsFromSettings();
      }
    }

    saveSettings() {
      const nextSettings = {
        focusDuration: this.sanitizeInt(this.elements.focusDurationInput.value, 25, 1, 120),
        shortBreakDuration: this.sanitizeInt(this.elements.shortBreakDurationInput.value, 5, 1, 60),
        longBreakDuration: this.sanitizeInt(this.elements.longBreakDurationInput.value, 15, 1, 120),
        soundEnabled: Boolean(this.elements.soundToggleInput.checked),
        darkMode: Boolean(this.elements.darkModeToggleInput.checked),
        dailyGoalMinutes: this.settings.dailyGoalMinutes,
      };

      this.settings = nextSettings;
      this.applyTheme(this.settings.darkMode ? "dark" : "light");
      this.applyDurationsFromSettings();

      if (!this.isRunning) {
        this.remainingTime = this.durations[this.currentMode];
        this.updateDisplay();
      }

      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings));
      this.persistAppState();
      this.updateStats();
    }

    loadSettings() {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (savedTheme) this.settings.darkMode = savedTheme === "dark";

      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) {
        this.applyDurationsFromSettings();
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      } catch {
        this.settings = { ...DEFAULT_SETTINGS };
      }

      this.applyDurationsFromSettings();
    }

    applyDurationsFromSettings() {
      this.durations = {
        pomodoro: this.settings.focusDuration * 60,
        shortBreak: this.settings.shortBreakDuration * 60,
        longBreak: this.settings.longBreakDuration * 60,
      };
    }

    populateSettingsForm() {
      this.elements.focusDurationInput.value = this.settings.focusDuration;
      this.elements.shortBreakDurationInput.value = this.settings.shortBreakDuration;
      this.elements.longBreakDurationInput.value = this.settings.longBreakDuration;
      this.elements.soundToggleInput.checked = this.settings.soundEnabled;
      this.elements.darkModeToggleInput.checked = this.settings.darkMode;
    }

    // ==============================
    // UI helpers
    // ==============================
    applyTheme(theme) {
      this.elements.body.dataset.theme = theme;
      this.elements.themeToggle.setAttribute("aria-checked", String(theme === "dark"));
      this.elements.darkModeToggleInput.checked = theme === "dark";
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    }

    showToast(message) {
      this.elements.toastMessage.textContent = message;
      this.elements.toast.classList.add("is-visible");
      this.elements.toast.setAttribute("aria-hidden", "false");

      if (this.toastTimeoutId) window.clearTimeout(this.toastTimeoutId);
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
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.58);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.6);
    }

    // ==============================
    // Utility
    // ==============================
    sanitizeInt(value, fallback, min, max) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, Math.round(parsed)));
    }

    formatClock(totalSeconds) {
      const mins = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const secs = String(totalSeconds % 60).padStart(2, "0");
      return `${mins}:${secs}`;
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
