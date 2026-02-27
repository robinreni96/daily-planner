import React, { useEffect, useMemo, useState } from "react";

const API_STATE_PATH = "/api/state";
const IST_TIMEZONE = "Asia/Kolkata";
const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
const DEFAULT_CATEGORY_COLOR = "#4f8dfd";
const ALLOWED_SORT_BY = new Set(["priority", "category", "taskType", "createdAt", "manual"]);
const DEFAULT_POMODORO_SECONDS = 30 * 60;

function getTodayDateIST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDateIST(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: IST_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function parseMeetingMinutes(timeLabel) {
  if (!timeLabel) return 9999;
  const match = timeLabel.match(/^(\d{2}):(\d{2})\s(AM|PM)/);
  if (!match) return 9999;
  let hour = Number(match[1]) % 12;
  if (match[3] === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function getNextDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().slice(0, 10);
}

function toRgba(hex, alpha) {
  if (!hex || typeof hex !== "string") return `rgba(79,141,253,${alpha})`;
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return `rgba(79,141,253,${alpha})`;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatSeconds(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizePomodoroTimers(rawTimers) {
  if (!rawTimers || typeof rawTimers !== "object") return {};

  const normalized = {};
  Object.entries(rawTimers).forEach(([taskId, timer]) => {
    if (!taskId || !timer || typeof timer !== "object") return;

    const durationCandidate = Number(timer.durationSeconds);
    const durationSeconds =
      Number.isFinite(durationCandidate) && durationCandidate > 0
        ? Math.floor(durationCandidate)
        : DEFAULT_POMODORO_SECONDS;

    const remainingCandidate = Number(timer.remainingSeconds);
    const remainingSeconds = Number.isFinite(remainingCandidate)
      ? Math.max(0, Math.min(durationSeconds, Math.floor(remainingCandidate)))
      : durationSeconds;

    normalized[taskId] = {
      remainingSeconds,
      durationSeconds,
      isRunning: Boolean(timer.isRunning) && remainingSeconds > 0
    };
  });

  return normalized;
}

function createDefaultState() {
  const today = getTodayDateIST();
  return {
    tasks: [],
    categories: ["General"],
    categoryColors: { General: DEFAULT_CATEGORY_COLOR },
    selectedDate: today,
    sortBy: "priority",
    pomodoroTimers: {}
  };
}

function buildCategoryColors(rawCategoryColors, categories) {
  const map = {};
  if (rawCategoryColors && typeof rawCategoryColors === "object") {
    Object.keys(rawCategoryColors).forEach((key) => {
      const value = String(rawCategoryColors[key] || "").trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) map[key] = value;
    });
  }
  (categories.length ? categories : ["General"]).forEach((category) => {
    if (!map[category]) map[category] = DEFAULT_CATEGORY_COLOR;
  });
  return map;
}

function normalizeState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== "object") return fallback;

  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const categories = Array.isArray(raw.categories)
    ? Array.from(new Set(raw.categories.map((x) => String(x || "").trim()).filter(Boolean)))
    : fallback.categories;

  return {
    tasks,
    categories: categories.length ? categories : fallback.categories,
    categoryColors: buildCategoryColors(raw.categoryColors, categories),
    selectedDate: typeof raw.selectedDate === "string" && raw.selectedDate ? raw.selectedDate : fallback.selectedDate,
    sortBy: ALLOWED_SORT_BY.has(raw.sortBy) ? raw.sortBy : fallback.sortBy,
    pomodoroTimers: normalizePomodoroTimers(raw.pomodoroTimers)
  };
}

async function fetchStateFromDb() {
  const response = await fetch(API_STATE_PATH);
  if (!response.ok) throw new Error(`Failed to load state: ${response.status}`);
  const payload = await response.json();
  return normalizeState(payload);
}

async function saveStateToDb(nextState) {
  await fetch(API_STATE_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextState)
  });
}

export default function App() {
  const today = getTodayDateIST();
  const [data, setData] = useState(createDefaultState);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [sortBy, setSortBy] = useState(createDefaultState().sortBy);
  const [filterType, setFilterType] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [openTaskMenuId, setOpenTaskMenuId] = useState(null);
  const [isStateLoaded, setIsStateLoaded] = useState(false);
  const [pomodoroTimers, setPomodoroTimers] = useState(createDefaultState().pomodoroTimers);
  const [focusedTaskId, setFocusedTaskId] = useState(null);
  const hasRunningPomodoro = useMemo(
    () => Object.values(pomodoroTimers).some((timer) => timer?.isRunning),
    [pomodoroTimers]
  );

  const [newCategory, setNewCategory] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(DEFAULT_CATEGORY_COLOR);
  const [form, setForm] = useState({
    taskName: "",
    taskDescription: "",
    priority: "Medium",
    category: data.categories[0] || "General",
    taskType: "Work",
    taskDate: data.selectedDate || today,
    meetingHour: "09",
    meetingMinute: "00",
    meetingAmPm: "AM"
  });

  function persist(next, pomodoroTimersOverride = pomodoroTimers) {
    const withTimers = {
      ...next,
      pomodoroTimers: pomodoroTimersOverride
    };
    setData(withTimers);
    saveStateToDb(withTimers).catch((error) => {
      console.error("Failed to persist state to DB:", error);
    });
  }

  useEffect(() => {
    let isCancelled = false;
    fetchStateFromDb()
      .then((loaded) => {
        if (isCancelled) return;
        const landingState = { ...loaded, selectedDate: today };
        setData(landingState);
        setSortBy(loaded.sortBy || "priority");
        setPomodoroTimers(loaded.pomodoroTimers || {});
        setForm((prev) => ({
          ...prev,
          category: loaded.categories[0] || "General",
          taskDate: today
        }));
        setIsStateLoaded(true);
      })
      .catch((error) => {
        console.error("Failed to load state from DB:", error);
        if (!isCancelled) setIsStateLoaded(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [today]);

  useEffect(() => {
    if (!hasRunningPomodoro) return undefined;

    const intervalId = setInterval(() => {
      setPomodoroTimers((prev) => {
        let hasChange = false;
        const next = { ...prev };

        Object.entries(prev).forEach(([taskId, timer]) => {
          if (!timer?.isRunning) return;

          const current = Number(timer.remainingSeconds ?? DEFAULT_POMODORO_SECONDS);
          const durationSeconds = Number(timer.durationSeconds ?? DEFAULT_POMODORO_SECONDS);
          const remainingSeconds = Math.max(current - 1, 0);
          const isRunning = remainingSeconds > 0;

          if (remainingSeconds !== current || isRunning !== timer.isRunning) {
            hasChange = true;
            next[taskId] = { ...timer, durationSeconds, remainingSeconds, isRunning };
          }
        });

        return hasChange ? next : prev;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [hasRunningPomodoro]);

  useEffect(() => {
    if (!isStateLoaded) return;
    setData((prev) => {
      if (prev.pomodoroTimers === pomodoroTimers) return prev;
      const next = { ...prev, pomodoroTimers };
      saveStateToDb(next).catch((error) => {
        console.error("Failed to persist timer state to DB:", error);
      });
      return next;
    });
  }, [pomodoroTimers, isStateLoaded]);

  useEffect(() => {
    if (!focusedTaskId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setFocusedTaskId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedTaskId]);

  useEffect(() => {
    if (!openTaskMenuId) return undefined;
    const onDocumentClick = () => setOpenTaskMenuId(null);
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [openTaskMenuId]);

  useEffect(() => {
    if (!focusedTaskId) return;
    const exists = data.tasks.some((task) => task.id === focusedTaskId);
    if (!exists) setFocusedTaskId(null);
  }, [data.tasks, focusedTaskId]);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name) return;

    const exists = data.categories.some((cat) => cat.toLowerCase() === name.toLowerCase());
    if (exists) {
      setNewCategory("");
      return;
    }

    const categories = [...data.categories, name].sort((a, b) => a.localeCompare(b));
    const categoryColors = { ...data.categoryColors, [name]: newCategoryColor };
    const next = { ...data, categories, categoryColors };
    persist(next);

    setForm((prev) => ({ ...prev, category: name }));
    setFilterCategory((current) => (current === "All" ? current : name));
    setNewCategory("");
    setNewCategoryColor(DEFAULT_CATEGORY_COLOR);
  }

  function deleteCategory(categoryName) {
    if (categoryName === "General") {
      alert("General category cannot be deleted.");
      return;
    }

    const categories = data.categories.filter((item) => item !== categoryName);
    const fallbackCategory = categories.includes("General") ? "General" : categories[0];
    const tasks = data.tasks.map((task) =>
      task.category === categoryName ? { ...task, category: fallbackCategory } : task
    );
    const categoryColors = { ...data.categoryColors };
    delete categoryColors[categoryName];

    const next = { ...data, categories, categoryColors, tasks };
    persist(next);

    if (form.category === categoryName) {
      setForm((prev) => ({ ...prev, category: fallbackCategory }));
    }
    if (filterCategory === categoryName) {
      setFilterCategory("All");
    }
  }

  function buildMeetingTime() {
    if (form.taskType !== "Meeting") return "";
    if (!form.meetingHour || !form.meetingMinute || !form.meetingAmPm) return "";
    return `${form.meetingHour}:${form.meetingMinute} ${form.meetingAmPm} IST`;
  }

  function submitTask(event) {
    event.preventDefault();

    const name = form.taskName.trim();
    const date = form.taskDate;
    if (!name || !date) return;

    const meetingTime = buildMeetingTime();
    if (form.taskType === "Meeting" && !meetingTime) {
      alert("Meeting time is required for Meeting tasks.");
      return;
    }

    const newTask = {
      id: crypto.randomUUID(),
      name,
      description: form.taskDescription.trim(),
      priority: form.priority,
      category: form.category,
      taskType: form.taskType,
      meetingTime,
      date,
      done: false,
      hidden: false,
      createdAt: Date.now()
    };

    const next = {
      ...data,
      tasks: [...data.tasks, newTask],
      selectedDate: date
    };

    persist(next);
    setForm((prev) => ({
      ...prev,
      taskName: "",
      taskDescription: "",
      priority: "Medium",
      category: data.categories[0] || "General",
      taskType: "Work",
      taskDate: date,
      meetingHour: "09",
      meetingMinute: "00",
      meetingAmPm: "AM"
    }));
  }

  function toggleDone(taskId) {
    const tasks = data.tasks.map((task) => {
      if (task.id !== taskId) return task;
      if (task.done || task.hidden) {
        return { ...task, done: false, hidden: false };
      }
      return { ...task, done: true, hidden: true };
    });
    persist({ ...data, tasks });
  }

  function hideTask(taskId) {
    const tasks = data.tasks.map((task) =>
      task.id === taskId ? { ...task, hidden: true, done: false } : task
    );
    persist({ ...data, tasks });
  }

  function restoreTask(taskId) {
    const tasks = data.tasks.map((task) =>
      task.id === taskId ? { ...task, hidden: false } : task
    );
    persist({ ...data, tasks });
  }

  function moveTaskToNextDay(taskId) {
    const tasks = data.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            date: getNextDate(task.date),
            done: false,
            hidden: false
          }
        : task
    );
    persist({ ...data, tasks });
  }

  function cloneTaskToNextDay(taskId) {
    const source = data.tasks.find((task) => task.id === taskId);
    if (!source) return;

    const clone = {
      ...source,
      id: crypto.randomUUID(),
      date: getNextDate(source.date),
      done: false,
      hidden: false,
      createdAt: Date.now()
    };

    persist({ ...data, tasks: [...data.tasks, clone] });
  }

  function reorderTasksWithinDay(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      setDraggingId(null);
      return;
    }

    const sameDateTasks = data.tasks.filter((task) => task.date === data.selectedDate);
    const otherTasks = data.tasks.filter((task) => task.date !== data.selectedDate);

    const ordered = sameDateTasks
      .map((task, index) => ({
        task,
        orderValue: Number.isFinite(task.order) ? Number(task.order) : index
      }))
      .sort((a, b) => a.orderValue - b.orderValue)
      .map((entry) => entry.task);

    const fromIndex = ordered.findIndex((task) => task.id === sourceId);
    const toIndex = ordered.findIndex((task) => task.id === targetId);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggingId(null);
      return;
    }

    const reordered = [...ordered];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const reindexed = reordered.map((task, index) => ({ ...task, order: index }));
    const nextTasks = [...otherTasks, ...reindexed];

    const next = { ...data, tasks: nextTasks, sortBy: "manual" };
    setSortBy("manual");
    persist(next);
    setDraggingId(null);
  }

  function updateSortBy(value) {
    const safeValue = ALLOWED_SORT_BY.has(value) ? value : "priority";
    setSortBy(safeValue);
    persist({ ...data, sortBy: safeValue });
  }

  function getPomodoroTimer(taskId) {
    const timer = pomodoroTimers[taskId];
    const durationSeconds = Number(timer?.durationSeconds ?? DEFAULT_POMODORO_SECONDS);
    return {
      remainingSeconds: Number(timer?.remainingSeconds ?? DEFAULT_POMODORO_SECONDS),
      durationSeconds,
      isRunning: Boolean(timer?.isRunning)
    };
  }

  function hasPomodoroStarted(taskId) {
    return Boolean(pomodoroTimers[taskId]);
  }

  function startPomodoro(taskId) {
    const existing = pomodoroTimers[taskId];

    if (existing && Number(existing.remainingSeconds) > 0) {
      const nextTimers = {
        ...pomodoroTimers,
        [taskId]: { ...existing, isRunning: true }
      };
      setPomodoroTimers(nextTimers);
      persist({ ...data }, nextTimers);
      return;
    }

    const input = window.prompt("Set timer in minutes", "30");
    if (input === null) return;

    const minutes = Number.parseInt(input, 10);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
    const durationSeconds = safeMinutes * 60;
    const nextTimers = {
      ...pomodoroTimers,
      [taskId]: {
        remainingSeconds: durationSeconds,
        durationSeconds,
        isRunning: true
      }
    };
    setPomodoroTimers(nextTimers);
    persist({ ...data }, nextTimers);
  }

  function pausePomodoro(taskId) {
    const current = pomodoroTimers[taskId] || {
        remainingSeconds: DEFAULT_POMODORO_SECONDS,
        durationSeconds: DEFAULT_POMODORO_SECONDS,
        isRunning: false
      };

    const nextTimers = {
      ...pomodoroTimers,
      [taskId]: { ...current, isRunning: false }
    };
    setPomodoroTimers(nextTimers);
    persist({ ...data }, nextTimers);
  }

  function resetPomodoro(taskId) {
    if (!pomodoroTimers[taskId]) return;
    const nextTimers = { ...pomodoroTimers };
    delete nextTimers[taskId];
    setPomodoroTimers(nextTimers);
    persist({ ...data }, nextTimers);
  }

  function getPomodoroProgressPercent(remainingSeconds, durationSeconds) {
    const safeDuration = Math.max(1, Number(durationSeconds) || DEFAULT_POMODORO_SECONDS);
    const remaining = Math.max(0, Math.min(safeDuration, Number(remainingSeconds) || 0));
    const elapsed = safeDuration - remaining;
    return Math.round((elapsed / safeDuration) * 100);
  }

  function changeSelectedDate(value) {
    const selectedDate = value || today;
    const next = { ...data, selectedDate };
    persist(next);
    setForm((prev) => ({ ...prev, taskDate: selectedDate }));
  }

  function resetFilters() {
    setFilterType("All");
    setFilterCategory("All");
    setFilterStatus("All");
    updateSortBy("priority");
  }

  function getCategoryPillStyle(category) {
    const base = data.categoryColors?.[category] || DEFAULT_CATEGORY_COLOR;
    return {
      background: toRgba(base, 0.16),
      borderColor: toRgba(base, 0.45),
      color: base
    };
  }

  function getCategorySectionStyle(category) {
    const base = data.categoryColors?.[category] || DEFAULT_CATEGORY_COLOR;
    return {
      background: toRgba(base, 0.1),
      borderColor: toRgba(base, 0.35)
    };
  }

  const visibleTasks = useMemo(() => {
    const filtered = data.tasks.filter((task) => {
      if (task.date !== data.selectedDate) return false;
      if (!showAllTasks && task.hidden) return false;
      if (filterType !== "All" && task.taskType !== filterType) return false;
      if (filterCategory !== "All" && task.category !== filterCategory) return false;
      if (filterStatus === "Pending" && task.done) return false;
      if (filterStatus === "Completed" && !task.done) return false;
      return true;
    });

    if (sortBy === "manual") {
      const withOrder = filtered.map((task, index) => ({
        task,
        orderValue: Number.isFinite(task.order) ? Number(task.order) : index
      }));

      withOrder.sort((a, b) => a.orderValue - b.orderValue);
      return withOrder.map((entry) => entry.task);
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "priority") {
        const rankDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
        if (rankDiff !== 0) return rankDiff;
        if (a.taskType === "Meeting" && b.taskType === "Meeting") {
          return parseMeetingMinutes(a.meetingTime) - parseMeetingMinutes(b.meetingTime);
        }
        return a.name.localeCompare(b.name);
      }

      if (sortBy === "category") {
        const diff = a.category.localeCompare(b.category);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      }

      if (sortBy === "taskType") {
        const diff = a.taskType.localeCompare(b.taskType);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      }

      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return sorted;
  }, [data.tasks, data.selectedDate, filterType, filterCategory, filterStatus, sortBy, showAllTasks]);

  const groupedTasks = useMemo(() => {
    const groups = {};
    visibleTasks.forEach((task) => {
      if (!groups[task.category]) groups[task.category] = [];
      groups[task.category].push(task);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleTasks]);
  const focusedTask = useMemo(
    () => data.tasks.find((task) => task.id === focusedTaskId) || null,
    [data.tasks, focusedTaskId]
  );

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <h1>Daily Planner</h1>
          <p className="hero-date">Viewing (IST): {formatDateIST(data.selectedDate)}</p>
        </div>
      </section>

      <section className={`grid ${isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
        <aside className={`sidebar ${isSidebarOpen ? "open" : "collapsed"}`}>
          <button
            type="button"
            className="collapse-handle"
            aria-label={isSidebarOpen ? "Collapse add todo panel" : "Expand add todo panel"}
            onClick={() => setIsSidebarOpen((prev) => !prev)}
          >
            {isSidebarOpen ? "◀" : "▶"}
          </button>
          {isSidebarOpen ? (
            <div className="panel">
              <header className="panel-header">
                <h2>Add task</h2>
              </header>

              <form className="form panel-body" onSubmit={submitTask}>
                <label>
                  Task Name
                  <input
                    value={form.taskName}
                    onChange={(event) => updateForm("taskName", event.target.value)}
                    placeholder="e.g. Error analysis for churn model"
                    required
                  />
                </label>

                <label>
                  Task Description
                  <textarea
                    value={form.taskDescription}
                    onChange={(event) => updateForm("taskDescription", event.target.value)}
                    placeholder="Optional notes"
                  />
                </label>

                <div className="row-3">
                  <label>
                    Priority
                    <select
                      value={form.priority}
                      onChange={(event) => updateForm("priority", event.target.value)}
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </label>

                  <label>
                    Task Type
                    <select
                      value={form.taskType}
                      onChange={(event) => updateForm("taskType", event.target.value)}
                    >
                      <option value="Work">Work</option>
                      <option value="Learning">Learning</option>
                      <option value="Meeting">Meeting</option>
                    </select>
                  </label>

                  <label>
                    Date
                    <input
                      type="date"
                      value={form.taskDate}
                      onChange={(event) => updateForm("taskDate", event.target.value)}
                      required
                    />
                  </label>
                </div>

                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={(event) => updateForm("category", event.target.value)}
                  >
                    {data.categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                {form.taskType === "Meeting" && (
                  <div className="meeting-block">
                    <div className="row-3">
                      <label>
                        Hour
                        <select
                          value={form.meetingHour}
                          onChange={(event) => updateForm("meetingHour", event.target.value)}
                        >
                          {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((hour) => (
                            <option key={hour} value={hour}>
                              {hour}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Minute
                        <select
                          value={form.meetingMinute}
                          onChange={(event) => updateForm("meetingMinute", event.target.value)}
                        >
                          <option value="00">00</option>
                          <option value="15">15</option>
                          <option value="30">30</option>
                          <option value="45">45</option>
                        </select>
                      </label>

                      <label>
                        AM/PM
                        <select
                          value={form.meetingAmPm}
                          onChange={(event) => updateForm("meetingAmPm", event.target.value)}
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </label>
                    </div>
                    <p className="hint">Saved in IST (GMT+5:30).</p>
                  </div>
                )}

                <label>
                  Insert Category
                  <div className="inline-row category-row">
                    <input
                      value={newCategory}
                      onChange={(event) => setNewCategory(event.target.value)}
                      placeholder="e.g. Research"
                    />
                    <input
                      type="color"
                      className="category-color-picker"
                      value={newCategoryColor}
                      aria-label="Category color"
                      title="Category color"
                      onChange={(event) => setNewCategoryColor(event.target.value)}
                    />
                    <button type="button" className="btn-soft" onClick={addCategory}>
                      Add
                    </button>
                  </div>
                </label>

                <div className="category-list">
                  {data.categories.map((category) => (
                    <div className="category-item" key={category}>
                      <span
                        className="category-dot"
                        style={{ background: data.categoryColors?.[category] || DEFAULT_CATEGORY_COLOR }}
                      />
                      <span className="category-name">{category}</span>
                      {category !== "General" && (
                        <button
                          type="button"
                          className="icon-btn delete category-delete"
                          aria-label={`Delete ${category} category`}
                          title={`Delete ${category} category`}
                          onClick={() => deleteCategory(category)}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button type="submit" className="btn-primary primary-full">
                  Save task
                </button>
              </form>
            </div>
          ) : (
            <div className="collapsed-note">Add Todo</div>
          )}
        </aside>

        <section className={`content ${isSettingsOpen ? "settings-open" : "settings-collapsed"}`}>
          <div className="task-view">
            {visibleTasks.length === 0 && (
              <div className="empty">No tasks match your filters for this date.</div>
            )}

            {groupedTasks.map(([category, tasks]) => (
              <section className="category-group" key={category} style={getCategorySectionStyle(category)}>
                <div className="category-group-head">
                  <span className="category-group-dot" style={{ background: data.categoryColors?.[category] || DEFAULT_CATEGORY_COLOR }} />
                  <h3>{category}</h3>
                  <span>{tasks.length}</span>
                </div>

                <ul className="task-list">
                  {tasks.map((task) => {
                    const timer = getPomodoroTimer(task.id);
                    const isTimerVisible = hasPomodoroStarted(task.id);
                    return (
                      <li
                        key={task.id}
                        className={`task ${task.done ? "done" : ""}`}
                        draggable
                        onDragStart={() => setDraggingId(task.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => reorderTasksWithinDay(draggingId, task.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={() => setFocusedTaskId(task.id)}
                      >
                        <div>
                          <div className="task-title">{task.name}</div>
                          <div className="task-desc">{task.description || "No description"}</div>
                          {isTimerVisible && (
                            <div className={`pomodoro-time ${timer.isRunning ? "running" : ""}`}>
                              {formatSeconds(timer.remainingSeconds)}
                            </div>
                          )}
                          <div className="meta">
                            {task.hidden && <span className="pill hidden-pill">Hidden</span>}
                            <span className={`pill tasktype-${task.taskType.toLowerCase()}`}>{task.taskType}</span>
                            <span className={`pill priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
                            {task.taskType === "Meeting" && task.meetingTime && (
                              <span className="pill">{task.meetingTime}</span>
                            )}
                          </div>
                        </div>

                        <div className="task-actions">
                          <button
                            type="button"
                            className="task-menu-trigger"
                            aria-label="Open task options"
                            title="Task options"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenTaskMenuId((current) => (current === task.id ? null : task.id));
                            }}
                          >
                            ⋮
                          </button>
                          {openTaskMenuId === task.id && (
                            <div className="task-menu-panel" onClick={(event) => event.stopPropagation()}>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  if (timer.isRunning) {
                                    pausePomodoro(task.id);
                                  } else {
                                    startPomodoro(task.id);
                                  }
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                {timer.isRunning ? "Pause Timer" : "Start Timer"}
                              </button>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  resetPomodoro(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                Reset Timer
                              </button>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  toggleDone(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                {task.done ? "Mark Pending" : "Mark Complete"}
                              </button>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  cloneTaskToNextDay(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                Clone to Next Day
                              </button>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  moveTaskToNextDay(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                Move to Next Day
                              </button>
                              <button
                                type="button"
                                className="task-menu-item danger"
                                onClick={() => {
                                  task.hidden ? restoreTask(task.id) : hideTask(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                {task.hidden ? "Restore Task" : "Hide Task"}
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

          </div>

          <aside className={`settings-panel ${isSettingsOpen ? "open" : "collapsed"}`}>
            <button
              type="button"
              className="settings-handle"
              aria-label={isSettingsOpen ? "Collapse task settings panel" : "Expand task settings panel"}
              onClick={() => setIsSettingsOpen((prev) => !prev)}
            >
              {isSettingsOpen ? "▶" : "◀"}
            </button>
            {isSettingsOpen ? (
              <div className="settings-body panel">
                <header className="panel-header">
                  <h3>Task settings</h3>
                </header>
                <div className="toolbar panel-body">
                  <label>
                    View Date
                    <input
                      type="date"
                      value={data.selectedDate}
                      onChange={(event) => changeSelectedDate(event.target.value)}
                    />
                  </label>

                  <label>
                    Sort By
                    <select value={sortBy} onChange={(event) => updateSortBy(event.target.value)}>
                      <option value="priority">Priority</option>
                      <option value="category">Category</option>
                      <option value="taskType">Task Type</option>
                      <option value="createdAt">Newest</option>
                      <option value="manual">Custom order</option>
                    </select>
                  </label>

                  <label>
                    Filter Type
                    <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                      <option value="All">All</option>
                      <option value="Work">Work</option>
                      <option value="Learning">Learning</option>
                      <option value="Meeting">Meeting</option>
                    </select>
                  </label>

                  <label>
                    Filter Category
                    <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}>
                      <option value="All">All</option>
                      {data.categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Filter Status
                    <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                      <option value="All">All</option>
                      <option value="Pending">Pending</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </label>

                  <div className="toolbar-actions">
                    <button type="button" className="btn-soft" onClick={resetFilters}>
                      Reset Filters
                    </button>
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={() => setShowAllTasks((prev) => !prev)}
                    >
                      {showAllTasks ? "Active Tasks" : "All Tasks"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="collapsed-note">Task Settings</div>
            )}
          </aside>
        </section>
      </section>

      {focusedTask && (() => {
        const timer = getPomodoroTimer(focusedTask.id);
        const progressPercent = getPomodoroProgressPercent(
          timer.remainingSeconds,
          timer.durationSeconds
        );
        return (
          <div className="timer-modal-backdrop" role="presentation" onClick={() => setFocusedTaskId(null)}>
            <section
              className="timer-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Pomodoro timer for ${focusedTask.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="timer-modal-close"
                onClick={() => setFocusedTaskId(null)}
                aria-label="Close timer screen"
              >
                ✕
              </button>
              <p className="timer-modal-kicker">Focused Session</p>
              <h2>{focusedTask.name}</h2>
              <p className="timer-modal-meta">
                {focusedTask.category} • {focusedTask.taskType} • {focusedTask.priority}
              </p>
              <div className="timer-circle-wrap">
                <svg className="timer-circle" viewBox="0 0 120 120" aria-hidden="true">
                  <circle className="timer-circle-bg" cx="60" cy="60" r="52" />
                  <circle
                    className="timer-circle-progress"
                    cx="60"
                    cy="60"
                    r="52"
                    style={{
                      strokeDasharray: `${2 * Math.PI * 52}`,
                      strokeDashoffset: `${2 * Math.PI * 52 * (1 - progressPercent / 100)}`
                    }}
                  />
                </svg>
                <div className="timer-modal-clock">{formatSeconds(timer.remainingSeconds)}</div>
              </div>
              <div className="timer-modal-actions">
                <button
                  type="button"
                  className={`timer-btn modal-primary ${timer.isRunning ? "running" : ""}`}
                  onClick={() => {
                    if (timer.isRunning) {
                      pausePomodoro(focusedTask.id);
                    } else {
                      startPomodoro(focusedTask.id);
                    }
                  }}
                >
                  {timer.isRunning ? "Pause Timer" : "Start Timer"}
                </button>
                <button
                  type="button"
                  className="timer-btn modal-secondary"
                  onClick={() => resetPomodoro(focusedTask.id)}
                >
                  Reset
                </button>
              </div>
            </section>
          </div>
        );
      })()}
    </main>
  );
}
