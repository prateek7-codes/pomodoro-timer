(() => {
  const MODES = {
    pomodoro: { label: "Pomodoro", seconds: 25 * 60 },
    shortBreak: { label: "Short Break", seconds: 5 * 60 },
    longBreak: { label: "Long Break", seconds: 15 * 60 },
  };

  const STORAGE_KEY = "focusflow-state-v1";

  class FocusFlowApp {
    constructor() {
      this.state = {
        mode: "pomodoro",
        isRunning: false,
        duration: MODES.pomodoro.seconds,
        remainingSeconds: MODES.pomodoro.seconds,
        endTime: null,
        lastFrameTime: null,
        completedFocusSessionsInCycle: 0,
        stats: {
          dateStamp: this.getDateStamp(),
          sessionsCompletedToday: 0,
          focusSecondsToday: 0,
          streakDays: 0,
          lastCompletionDate: null,
        },
      };

      this.loadStoredState();
      this.cacheElements();
      this.setupRing();
      this.bindEvents();
      this.applyTheme(this.getInitialTheme());
      this.applyMode(this.state.mode, false);
      this.updateTimerUI();
      this.updateInsights();
      this.restoreRunningState();
    }

    cacheElements() {
      this.elements = {
        body: document.body,
        topNav: document.getElementById("topNav"),
        timerWrap: document.getElementById("timerWrap"),
        progressCircle: document.getElementById("progressCircle"),
        timerDisplay: document.getElementById("timerDisplay"),
        modeLabel: document.getElementById("modeLabel"),
        startPauseButton: document.getElementById("startPauseButton"),
        resetButton: document.getElementById("resetButton"),
        modeButtons: [...document.querySelectorAll(".mode-switch__option")],
        focusTimeText: document.getElementById("focusTimeText"),
        sessionsText: document.getElementById("sessionsText"),
        streakText: document.getElementById("streakText"),
        toast: document.getElementById("toast"),
        toastMessage: document.getElementById("toastMessage"),
        themeToggle: document.getElementById("themeToggle"),
      };
    }

    bindEvents() {
      this.elements.startPauseButton.addEventListener("click", () => {
        if (this.state.isRunning) {
          this.pauseTimer();
        } else {
          this.startTimer();
        }
      });

      this.elements.resetButton.addEventListener("click", () => {
        this.resetTimer();
      });

      this.elements.modeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          this.switchMode(button.dataset.mode, true);
        });
      });

      this.elements.themeToggle.addEventListener("click", () => {
        const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
        this.applyTheme(nextTheme);
        localStorage.setItem("focusflow-theme", nextTheme);
      });
    }

    setupRing() {
      this.radius = this.elements.progressCircle.r.baseVal.value;
      this.circumference = 2 * Math.PI * this.radius;
      this.elements.progressCircle.style.strokeDasharray = `${this.circumference}`;
    }

    getInitialTheme() {
      const savedTheme = localStorage.getItem("focusflow-theme");
      if (savedTheme) {
        return savedTheme;
      }
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    applyTheme(theme) {
      document.body.dataset.theme = theme;
      const isDark = theme === "dark";
      this.elements.themeToggle.setAttribute("aria-checked", String(isDark));
    }

    switchMode(mode, shouldSave) {
      if (!MODES[mode]) return;
      this.pauseTimer(false);
      this.state.mode = mode;
      this.state.duration = MODES[mode].seconds;
      this.state.remainingSeconds = MODES[mode].seconds;
      this.state.endTime = null;
      this.applyMode(mode, shouldSave);
      this.updateTimerUI();
      this.updateStartPauseButton();
    }

    applyMode(mode, shouldSave = true) {
      this.elements.body.dataset.mode = mode;
      this.elements.modeLabel.textContent = MODES[mode].label;
      this.elements.modeButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.mode === mode);
      });
      if (shouldSave) {
        this.persistState();
      }
    }

    startTimer() {
      if (this.state.isRunning) return;
      this.state.isRunning = true;
      this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;
      this.state.lastFrameTime = performance.now();
      this.elements.body.classList.add("is-focusing");
      this.elements.topNav.classList.add("is-hidden");
      this.elements.timerWrap.classList.add("is-running");
      this.updateStartPauseButton();
      this.persistState();
      requestAnimationFrame((timestamp) => this.tick(timestamp));
    }

    pauseTimer(restoreChrome = true) {
      if (!this.state.isRunning) return;
      this.state.isRunning = false;
      this.state.endTime = null;
      if (restoreChrome) {
        this.elements.body.classList.remove("is-focusing");
        this.elements.topNav.classList.remove("is-hidden");
      }
      this.elements.timerWrap.classList.remove("is-running");
      this.updateStartPauseButton();
      this.persistState();
    }

    resetTimer() {
      this.pauseTimer();
      this.state.remainingSeconds = this.state.duration;
      this.updateTimerUI();
      this.persistState();
    }

    tick(timestamp) {
      if (!this.state.isRunning) return;

      const msRemaining = Math.max(0, this.state.endTime - timestamp);
      this.state.remainingSeconds = msRemaining / 1000;
      this.updateTimerUI();

      if (msRemaining <= 0) {
        this.completeInterval();
        return;
      }

      requestAnimationFrame((nextTimestamp) => this.tick(nextTimestamp));
    }

    completeInterval() {
      this.state.isRunning = false;
      this.elements.body.classList.remove("is-focusing");
      this.elements.topNav.classList.remove("is-hidden");
      this.elements.timerWrap.classList.remove("is-running");

      if (this.state.mode === "pomodoro") {
        this.recordFocusSession();
        this.state.completedFocusSessionsInCycle += 1;
      }

      const previousModeLabel = MODES[this.state.mode].label;
      this.state.mode = this.getNextMode();
      this.state.duration = MODES[this.state.mode].seconds;
      this.state.remainingSeconds = this.state.duration;
      this.state.endTime = null;

      this.applyMode(this.state.mode, false);
      this.updateTimerUI();
      this.updateStartPauseButton();
      this.showToast(`${previousModeLabel} complete. Switched to ${MODES[this.state.mode].label}.`);
      this.playNotification();
      this.persistState();
    }

    getNextMode() {
      if (this.state.mode === "pomodoro") {
        if (this.state.completedFocusSessionsInCycle >= 4) {
          this.state.completedFocusSessionsInCycle = 0;
          return "longBreak";
        }
        return "shortBreak";
      }
      return "pomodoro";
    }

    recordFocusSession() {
      this.refreshStatsDate();
      this.state.stats.sessionsCompletedToday += 1;
      this.state.stats.focusSecondsToday += MODES.pomodoro.seconds;

      const today = this.getDateStamp();
      const previousCompletion = this.state.stats.lastCompletionDate;

      if (!previousCompletion) {
        this.state.stats.streakDays = 1;
      } else if (previousCompletion !== today) {
        const dayDiff = this.getDayDifference(previousCompletion, today);
        if (dayDiff === 1) {
          this.state.stats.streakDays += 1;
        } else if (dayDiff > 1) {
          this.state.stats.streakDays = 1;
        }
      }

      this.state.stats.lastCompletionDate = today;
      this.updateInsights();
    }

    refreshStatsDate() {
      const today = this.getDateStamp();
      if (this.state.stats.dateStamp !== today) {
        this.state.stats.dateStamp = today;
        this.state.stats.sessionsCompletedToday = 0;
        this.state.stats.focusSecondsToday = 0;
      }
    }

    getDayDifference(previousDate, currentDate) {
      const previous = new Date(`${previousDate}T00:00:00`);
      const current = new Date(`${currentDate}T00:00:00`);
      const msPerDay = 24 * 60 * 60 * 1000;
      return Math.round((current - previous) / msPerDay);
    }

    updateTimerUI() {
      const roundedSeconds = Math.ceil(this.state.remainingSeconds);
      this.elements.timerDisplay.textContent = this.formatClock(roundedSeconds);

      const progress = 1 - this.state.remainingSeconds / this.state.duration;
      const offset = this.circumference * (1 - Math.min(Math.max(progress, 0), 1));
      this.elements.progressCircle.style.strokeDashoffset = `${offset}`;
    }

    updateInsights() {
      this.refreshStatsDate();
      const focusText = this.formatFocusDuration(this.state.stats.focusSecondsToday);
      this.elements.focusTimeText.textContent = `You’ve focused for ${focusText} today.`;
      this.elements.sessionsText.textContent = `Sessions completed: ${this.state.stats.sessionsCompletedToday}`;
      this.elements.streakText.textContent = `Daily streak: ${this.state.stats.streakDays} day${
        this.state.stats.streakDays === 1 ? "" : "s"
      }`;
      this.persistState();
    }

    updateStartPauseButton() {
      this.elements.startPauseButton.textContent = this.state.isRunning ? "Pause" : "Start";
    }

    showToast(message) {
      this.elements.toastMessage.textContent = message;
      this.elements.toast.classList.add("is-visible");
      this.elements.toast.setAttribute("aria-hidden", "false");
      window.setTimeout(() => {
        this.elements.toast.classList.remove("is-visible");
        this.elements.toast.setAttribute("aria-hidden", "true");
      }, 3600);
    }

    playNotification() {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, audioContext.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.65);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.65);
    }

    formatClock(totalSeconds) {
      const mins = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const secs = String(totalSeconds % 60).padStart(2, "0");
      return `${mins}:${secs}`;
    }

    formatFocusDuration(totalSeconds) {
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    }

    persistState() {
      const snapshot = {
        mode: this.state.mode,
        duration: this.state.duration,
        remainingSeconds: this.state.remainingSeconds,
        isRunning: this.state.isRunning,
        endTimeWallClock: this.state.isRunning ? Date.now() + this.state.remainingSeconds * 1000 : null,
        completedFocusSessionsInCycle: this.state.completedFocusSessionsInCycle,
        stats: this.state.stats,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }

    loadStoredState() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      try {
        const stored = JSON.parse(raw);
        if (stored.mode && MODES[stored.mode]) {
          this.state.mode = stored.mode;
          this.state.duration = MODES[stored.mode].seconds;
          this.state.remainingSeconds = Number(stored.remainingSeconds) || this.state.duration;
        }

        this.state.completedFocusSessionsInCycle = Number(stored.completedFocusSessionsInCycle) || 0;
        this.state.stats = {
          ...this.state.stats,
          ...(stored.stats || {}),
        };

        if (stored.isRunning && stored.endTimeWallClock) {
          const remaining = Math.max(0, (stored.endTimeWallClock - Date.now()) / 1000);
          this.state.remainingSeconds = remaining || this.state.duration;
          this.state.isRunning = remaining > 0;
        }
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    restoreRunningState() {
      if (this.state.isRunning) {
        this.startTimer();
      }
    }

    getDateStamp() {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;
    }
  }

  new FocusFlowApp();
})();
