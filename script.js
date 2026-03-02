(() => {
  "use strict";

  const STORAGE_KEYS = {
    app: "focusflow-state-v4",
    settings: "focusflow-settings-v4",
    theme: "focusflow-theme-v4",
  };

  const DEFAULT_SETTINGS = {
    focus: 25,
    short: 5,
    long: 15,
    sound: true,
    darkMode: false,
    dailyGoalMinutes: 120,
  };

  const MODE_LABEL = { pomodoro: "Pomodoro", short: "Short Break", long: "Long Break" };

  class FocusFlow {
    constructor() {
      this.el = this.cacheElements();
      // Centralized state object
      this.state = {
        isRunning: false,
        currentMode: "pomodoro",
        remainingTime: DEFAULT_SETTINGS.focus * 60,
        timerInterval: null,
        endAt: null,
        completedFocusCycleCount: 0,
        settings: { ...DEFAULT_SETTINGS },
        stats: {
          dateStamp: this.getDateStamp(),
          focusMinutesToday: 0,
          sessionsCompletedToday: 0,
          streakDays: 0,
          lastStreakDate: null,
          historyByDate: {},
        },
      };
      this.toastTimer = null;
    }

    init() {
      this.loadSettings();
      this.loadStats();
      this.loadAppState();
      this.updateModeUI();
      this.updateDisplay();
      this.updateStats();
      this.populateSettings();
      this.applyTheme(this.state.settings.darkMode ? "dark" : "light");
      this.bindEvents();
    }

    cacheElements() {
      return {
        body: document.body,
        topNav: document.getElementById("topNav"),
        timerWrap: document.getElementById("timerWrap"),
        timer: document.getElementById("timer"),
        modeLabel: document.getElementById("modeLabel"),
        progressCircle: document.getElementById("progressCircle"),
        modeButtons: [...document.querySelectorAll(".mode-btn")],
        startBtn: document.getElementById("startBtn"),
        resetBtn: document.getElementById("resetBtn"),
        themeToggle: document.getElementById("themeToggle"),

        statsButton: document.getElementById("statsButton"),
        settingsButton: document.getElementById("settingsButton"),
        statsPanel: document.getElementById("statsPanel"),
        settingsPanel: document.getElementById("settingsPanel"),
        panelOverlay: document.getElementById("panelOverlay"),
        closeButtons: [...document.querySelectorAll("[data-close-panel]")],

        focusTime: document.getElementById("focusTime"),
        sessionsCount: document.getElementById("sessionsCount"),
        streakCount: document.getElementById("streakCount"),
        weeklyFocus: document.getElementById("weeklyFocus"),
        dailyGoal: document.getElementById("dailyGoal"),
        dailyGoalFill: document.getElementById("dailyGoalFill"),

        settingsForm: document.getElementById("settingsForm"),
        focusInput: document.getElementById("focusInput"),
        shortInput: document.getElementById("shortInput"),
        longInput: document.getElementById("longInput"),
        soundToggle: document.getElementById("soundToggle"),
        darkToggle: document.getElementById("darkToggle"),
        resetDefaultsButton: document.getElementById("resetDefaultsButton"),

        toast: document.getElementById("toast"),
        toastMessage: document.getElementById("toastMessage"),
      };
    }

    durations() {
      return {
        pomodoro: this.state.settings.focus * 60,
        short: this.state.settings.short * 60,
        long: this.state.settings.long * 60,
      };
    }

    bindEvents() {
      this.el.startBtn.addEventListener("click", () => (this.state.isRunning ? this.pauseTimer() : this.startTimer()));
      this.el.resetBtn.addEventListener("click", () => this.resetTimer());
      this.el.modeButtons.forEach((btn) => btn.addEventListener("click", () => this.switchMode(btn.dataset.mode)));

      this.el.statsButton.addEventListener("click", () => this.openPanel("stats"));
      this.el.settingsButton.addEventListener("click", () => this.openPanel("settings"));
      this.el.panelOverlay.addEventListener("click", () => this.closePanel());
      this.el.closeButtons.forEach((b) => b.addEventListener("click", () => this.closePanel()));
      document.addEventListener("keydown", (e) => e.key === "Escape" && this.closePanel());

      this.el.themeToggle.addEventListener("click", () => {
        this.state.settings.darkMode = !this.state.settings.darkMode;
        this.applyTheme(this.state.settings.darkMode ? "dark" : "light");
        this.el.darkToggle.checked = this.state.settings.darkMode;
        this.saveSettings();
      });

      this.el.settingsForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveSettings();
        this.showToast("Settings saved.");
      });

      this.el.resetDefaultsButton.addEventListener("click", () => {
        this.state.settings = { ...DEFAULT_SETTINGS };
        this.populateSettings();
        this.applyTheme(this.state.settings.darkMode ? "dark" : "light");
        this.resetTimer();
        this.saveSettings();
      });
    }

    startTimer() {
      if (this.state.isRunning) return;
      this.clearTimer();
      this.state.isRunning = true;
      this.state.endAt = Date.now() + this.state.remainingTime * 1000;
      this.updateStartPause();
      this.enterFocusMode();
      this.saveAppState();

      this.state.timerInterval = window.setInterval(() => {
        const leftMs = Math.max(0, this.state.endAt - Date.now());
        this.state.remainingTime = Math.ceil(leftMs / 1000);
        this.updateDisplay();
        if (leftMs <= 0) this.onComplete();
      }, 1000);
    }

    pauseTimer() {
      if (!this.state.isRunning) return;
      this.state.remainingTime = Math.max(0, Math.ceil((this.state.endAt - Date.now()) / 1000));
      this.state.isRunning = false;
      this.state.endAt = null;
      this.clearTimer();
      this.exitFocusMode();
      this.updateStartPause();
      this.updateDisplay();
      this.saveAppState();
    }

    resetTimer() {
      this.state.isRunning = false;
      this.state.endAt = null;
      this.clearTimer();
      this.state.remainingTime = this.durations()[this.state.currentMode];
      this.exitFocusMode();
      this.updateStartPause();
      this.updateDisplay();
      this.saveAppState();
    }

    clearTimer() {
      if (this.state.timerInterval) {
        clearInterval(this.state.timerInterval);
        this.state.timerInterval = null;
      }
    }

    switchMode(mode) {
      if (!this.durations()[mode]) return;
      this.state.currentMode = mode;
      this.state.isRunning = false;
      this.state.endAt = null;
      this.clearTimer();
      this.state.remainingTime = this.durations()[mode];
      this.updateModeUI();
      this.updateStartPause();
      this.updateDisplay();
      this.exitFocusMode();
      this.saveAppState();
    }

    onComplete() {
      this.clearTimer();
      this.state.isRunning = false;
      this.state.endAt = null;
      this.state.remainingTime = 0;
      this.updateDisplay();

      if (this.state.currentMode === "pomodoro") {
        this.completeFocusSession();
      }

      const next = this.nextMode();
      this.state.currentMode = next;
      this.state.remainingTime = this.durations()[next];
      this.updateModeUI();
      this.updateStartPause();
      this.exitFocusMode();
      this.updateStats();
      this.saveAppState();
      this.saveStats();

      if (this.state.settings.sound) this.playSound();
      this.showToast(`Session complete. Switched to ${MODE_LABEL[next]}.`);
    }

    nextMode() {
      if (this.state.currentMode !== "pomodoro") return "pomodoro";
      this.state.completedFocusCycleCount += 1;
      if (this.state.completedFocusCycleCount >= 4) {
        this.state.completedFocusCycleCount = 0;
        return "long";
      }
      return "short";
    }

    updateDisplay() {
      this.el.timer.textContent = this.formatMMSS(this.state.remainingTime);
      const r = this.el.progressCircle.r.baseVal.value;
      const c = 2 * Math.PI * r;
      const total = this.durations()[this.state.currentMode];
      const progress = Math.min(1, Math.max(0, 1 - this.state.remainingTime / total));
      this.el.progressCircle.style.strokeDasharray = String(c);
      this.el.progressCircle.style.strokeDashoffset = String(c * (1 - progress));
    }

    updateModeUI() {
      this.el.body.dataset.mode = this.state.currentMode;
      this.el.modeLabel.textContent = MODE_LABEL[this.state.currentMode];
      this.el.modeButtons.forEach((b) => {
        const active = b.dataset.mode === this.state.currentMode;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
    }

    updateStartPause() {
      this.el.startBtn.textContent = this.state.isRunning ? "Pause" : "Start";
    }

    openPanel(kind) {
      const show = kind === "stats" ? this.el.statsPanel : this.el.settingsPanel;
      const hide = kind === "stats" ? this.el.settingsPanel : this.el.statsPanel;
      hide.classList.remove("is-open");
      hide.setAttribute("aria-hidden", "true");
      show.classList.add("is-open");
      show.setAttribute("aria-hidden", "false");
      this.el.panelOverlay.hidden = false;
      requestAnimationFrame(() => this.el.panelOverlay.classList.add("is-visible"));
      this.el.body.classList.add("no-scroll");
      if (kind === "stats") this.updateStats();
      if (kind === "settings") this.populateSettings();
    }

    closePanel() {
      this.el.statsPanel.classList.remove("is-open");
      this.el.settingsPanel.classList.remove("is-open");
      this.el.statsPanel.setAttribute("aria-hidden", "true");
      this.el.settingsPanel.setAttribute("aria-hidden", "true");
      this.el.panelOverlay.classList.remove("is-visible");
      this.el.body.classList.remove("no-scroll");
      setTimeout(() => {
        if (!this.el.panelOverlay.classList.contains("is-visible")) this.el.panelOverlay.hidden = true;
      }, 360);
    }

    completeFocusSession() {
      this.refreshDateOnLoad();
      const today = this.getDateStamp();
      this.state.stats.focusMinutesToday += this.state.settings.focus;
      this.state.stats.sessionsCompletedToday += 1;
      this.state.stats.historyByDate[today] = (this.state.stats.historyByDate[today] || 0) + this.state.settings.focus;

      if (this.state.stats.lastStreakDate !== today) {
        if (!this.state.stats.lastStreakDate) {
          this.state.stats.streakDays = 1;
        } else {
          const gap = this.dayDiff(this.state.stats.lastStreakDate, today);
          this.state.stats.streakDays = gap === 1 ? this.state.stats.streakDays + 1 : 1;
        }
        this.state.stats.lastStreakDate = today;
      }
    }

    updateStats() {
      this.refreshDateOnLoad();
      const todayMin = this.state.stats.focusMinutesToday;
      const weekly = Object.values(this.state.stats.historyByDate).reduce((a, b) => a + Number(b || 0), 0);
      const pct = Math.min(100, Math.round((todayMin / this.state.settings.dailyGoalMinutes) * 100));

      this.el.focusTime.textContent = `${todayMin} min`;
      this.el.sessionsCount.textContent = `Sessions completed: ${this.state.stats.sessionsCompletedToday}`;
      this.el.streakCount.textContent = `Daily streak: ${this.state.stats.streakDays} day${this.state.stats.streakDays === 1 ? "" : "s"}`;
      this.el.weeklyFocus.textContent = `Weekly focus time: ${weekly} minutes`;
      this.el.dailyGoal.textContent = `${pct}%`;
      this.el.dailyGoalFill.style.width = `${pct}%`;
    }

    refreshDateOnLoad() {
      const today = this.getDateStamp();
      if (this.state.stats.dateStamp !== today) {
        this.state.stats.dateStamp = today;
        this.state.stats.focusMinutesToday = 0;
        this.state.stats.sessionsCompletedToday = 0;
      }
      const oldest = this.getDateStamp(-6);
      Object.keys(this.state.stats.historyByDate).forEach((d) => {
        if (d < oldest) delete this.state.stats.historyByDate[d];
      });
    }

    loadStats() {
      const raw = localStorage.getItem(STORAGE_KEYS.app);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.stats) this.state.stats = { ...this.state.stats, ...parsed.stats, historyByDate: { ...(parsed.stats.historyByDate || {}) } };
      } catch {}
      this.refreshDateOnLoad();
    }

    saveStats() {
      this.saveAppState();
    }

    loadSettings() {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (savedTheme) this.state.settings.darkMode = savedTheme === "dark";
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) return;
      try {
        this.state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {}
    }

    saveSettings() {
      this.state.settings.focus = this.clamp(this.el.focusInput.value, 25, 1, 120);
      this.state.settings.short = this.clamp(this.el.shortInput.value, 5, 1, 60);
      this.state.settings.long = this.clamp(this.el.longInput.value, 15, 1, 120);
      this.state.settings.sound = Boolean(this.el.soundToggle.checked);
      this.state.settings.darkMode = Boolean(this.el.darkToggle.checked);

      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.state.settings));
      localStorage.setItem(STORAGE_KEYS.theme, this.state.settings.darkMode ? "dark" : "light");
      this.applyTheme(this.state.settings.darkMode ? "dark" : "light");

      if (!this.state.isRunning) {
        this.state.remainingTime = this.durations()[this.state.currentMode];
        this.updateDisplay();
      }
      this.updateStats();
      this.saveAppState();
    }

    loadAppState() {
      const raw = localStorage.getItem(STORAGE_KEYS.app);
      if (!raw) {
        this.state.remainingTime = this.durations().pomodoro;
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        this.state.currentMode = parsed.currentMode && this.durations()[parsed.currentMode] ? parsed.currentMode : "pomodoro";
        this.state.remainingTime = Number(parsed.remainingTime) || this.durations()[this.state.currentMode];
        this.state.completedFocusCycleCount = Number(parsed.completedFocusCycleCount) || 0;

        if (parsed.isRunning && parsed.endAt) {
          const remain = Math.max(0, Math.ceil((parsed.endAt - Date.now()) / 1000));
          this.state.remainingTime = remain || this.durations()[this.state.currentMode];
          if (remain > 0) this.startTimer();
        }
      } catch {}
    }

    saveAppState() {
      const payload = {
        isRunning: this.state.isRunning,
        currentMode: this.state.currentMode,
        remainingTime: this.state.remainingTime,
        endAt: this.state.isRunning ? Date.now() + this.state.remainingTime * 1000 : null,
        completedFocusCycleCount: this.state.completedFocusCycleCount,
        stats: this.state.stats,
      };
      localStorage.setItem(STORAGE_KEYS.app, JSON.stringify(payload));
    }

    populateSettings() {
      this.el.focusInput.value = this.state.settings.focus;
      this.el.shortInput.value = this.state.settings.short;
      this.el.longInput.value = this.state.settings.long;
      this.el.soundToggle.checked = this.state.settings.sound;
      this.el.darkToggle.checked = this.state.settings.darkMode;
    }

    applyTheme(theme) {
      this.el.body.dataset.theme = theme;
      this.el.themeToggle.setAttribute("aria-checked", String(theme === "dark"));
    }

    enterFocusMode() {
      this.el.body.classList.add("is-focusing");
      this.el.topNav.classList.add("is-hidden");
      this.el.timerWrap.classList.add("is-running");
    }

    exitFocusMode() {
      this.el.body.classList.remove("is-focusing");
      this.el.topNav.classList.remove("is-hidden");
      this.el.timerWrap.classList.remove("is-running");
    }

    showToast(message) {
      this.el.toastMessage.textContent = message;
      this.el.toast.classList.add("is-visible");
      this.el.toast.setAttribute("aria-hidden", "false");
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.el.toast.classList.remove("is-visible");
        this.el.toast.setAttribute("aria-hidden", "true");
      }, 3200);
    }

    playSound() {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.58);
    }

    formatMMSS(seconds) {
      const m = String(Math.floor(seconds / 60)).padStart(2, "0");
      const s = String(seconds % 60).padStart(2, "0");
      return `${m}:${s}`;
    }

    clamp(v, fallback, min, max) {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    }

    getDateStamp(offset = 0) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    dayDiff(a, b) {
      return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
    }
  }

  new FocusFlow().init();
})();
