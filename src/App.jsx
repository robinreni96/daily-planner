import React, { useEffect, useMemo, useRef, useState } from "react";

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

function autoCarryForwardPendingTasks(state, targetDate) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const todayTasks = tasks.filter((task) => task?.date === targetDate);
  const todayMaxOrder = todayTasks.reduce((max, task, index) => {
    const orderValue = Number.isFinite(Number(task?.order)) ? Number(task.order) : index;
    return Math.max(max, orderValue);
  }, -1);

  let nextOrder = todayMaxOrder + 1;
  let changed = false;

  const nextTasks = tasks.map((task) => {
    const taskDate = String(task?.date || "");
    const shouldMove =
      !task?.done &&
      !task?.hidden &&
      taskDate &&
      taskDate < targetDate;

    if (!shouldMove) return task;
    changed = true;
    return { ...task, date: targetDate, order: nextOrder++, inProgress: false };
  });

  return changed ? { ...state, tasks: nextTasks } : state;
}

function getCategoryRankMap(categories) {
  return new Map(categories.map((category, index) => [category, index]));
}

function orderTasksForDay(tasks, selectedDate, categories) {
  const categoryRank = getCategoryRankMap(categories);
  return tasks
    .filter((task) => task.date === selectedDate)
    .map((task, index) => ({
      task,
      orderValue: Number.isFinite(Number(task.order)) ? Number(task.order) : index,
      categoryRank: categoryRank.get(task.category) ?? Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => {
      if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
      return a.orderValue - b.orderValue;
    })
    .map((entry) => entry.task);
}

function setTaskProgressState(tasks, taskId, inProgress) {
  return tasks.map((task) => (task.id === taskId ? { ...task, inProgress } : task));
}

function parseMeetingFields(meetingTime) {
  const match = String(meetingTime || "").match(/^(\d{2}):(\d{2})\s(AM|PM)/);
  if (!match) {
    return { meetingHour: "09", meetingMinute: "00", meetingAmPm: "AM" };
  }
  return {
    meetingHour: match[1],
    meetingMinute: match[2],
    meetingAmPm: match[3]
  };
}

function buildMeetingTimeFromFields(values) {
  if (values.taskType !== "Meeting") return "";
  if (!values.meetingHour || !values.meetingMinute || !values.meetingAmPm) return "";
  return `${values.meetingHour}:${values.meetingMinute} ${values.meetingAmPm} IST`;
}

function buildTaskFormFromTask(task, fallbackDate) {
  const meetingFields = parseMeetingFields(task.meetingTime);
  return {
    taskName: task.name || "",
    taskDescription: task.description || "",
    priority: task.priority || "Medium",
    category: task.category || "General",
    taskType: task.taskType || "Work",
    taskDate: task.date || fallbackDate,
    meetingHour: meetingFields.meetingHour,
    meetingMinute: meetingFields.meetingMinute,
    meetingAmPm: meetingFields.meetingAmPm
  };
}

function createDefaultState() {
  const today = getTodayDateIST();
  return {
    tasks: [],
    categories: ["General"],
    categoryColors: { General: DEFAULT_CATEGORY_COLOR },
    selectedDate: today,
    sortBy: "priority",
    pomodoroTimers: {},
    activeTaskId: null
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
  const normalizedTasks = tasks
    .filter((task) => task && typeof task === "object")
    .map((task) => ({
      ...task,
      inProgress: Boolean(task.inProgress) && !task.done && !task.hidden
    }));
  const categories = Array.isArray(raw.categories)
    ? Array.from(new Set(raw.categories.map((x) => String(x || "").trim()).filter(Boolean)))
    : fallback.categories;

  return {
    tasks: normalizedTasks,
    categories: categories.length ? categories : fallback.categories,
    categoryColors: buildCategoryColors(raw.categoryColors, categories),
    selectedDate: typeof raw.selectedDate === "string" && raw.selectedDate ? raw.selectedDate : fallback.selectedDate,
    sortBy: ALLOWED_SORT_BY.has(raw.sortBy) ? raw.sortBy : fallback.sortBy,
    pomodoroTimers: normalizePomodoroTimers(raw.pomodoroTimers),
    activeTaskId:
      typeof raw.activeTaskId === "string" && normalizedTasks.some((task) => task.id === raw.activeTaskId)
        ? raw.activeTaskId
        : null
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
  const [draggingCategory, setDraggingCategory] = useState(null);
  const [openTaskMenuId, setOpenTaskMenuId] = useState(null);
  const [isStateLoaded, setIsStateLoaded] = useState(false);
  const [pomodoroTimers, setPomodoroTimers] = useState(createDefaultState().pomodoroTimers);
  const [activeTaskId, setActiveTaskId] = useState(createDefaultState().activeTaskId);
  const [focusedTaskId, setFocusedTaskId] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const activeTaskIdRef = useRef(createDefaultState().activeTaskId);
  const queuedSaveRef = useRef(null);
  const isSaveInFlightRef = useRef(false);
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
  const [editForm, setEditForm] = useState({
    taskName: "",
    taskDescription: "",
    priority: "Medium",
    category: "General",
    taskType: "Work",
    taskDate: today,
    meetingHour: "09",
    meetingMinute: "00",
    meetingAmPm: "AM"
  });

  function queuePersistState(nextState, errorMessage = "Failed to persist state to DB:") {
    queuedSaveRef.current = nextState;
    if (isSaveInFlightRef.current) return;

    isSaveInFlightRef.current = true;
    void (async function flushSaveQueue() {
      while (queuedSaveRef.current) {
        const snapshot = queuedSaveRef.current;
        queuedSaveRef.current = null;

        try {
          await saveStateToDb(snapshot);
        } catch (error) {
          console.error(errorMessage, error);
        }
      }

      isSaveInFlightRef.current = false;
      if (queuedSaveRef.current) {
        queuePersistState(queuedSaveRef.current, errorMessage);
      }
    })();
  }

  function persist(next, pomodoroTimersOverride = pomodoroTimers) {
    const withTimers = {
      ...next,
      pomodoroTimers: pomodoroTimersOverride,
      activeTaskId: next.activeTaskId ?? null
    };
    setData(withTimers);
    queuePersistState(withTimers);
  }

  useEffect(() => {
    let isCancelled = false;
    fetchStateFromDb()
      .then((loaded) => {
        if (isCancelled) return;
        const landingState = { ...loaded, selectedDate: today };
        const stateWithCarryForward = autoCarryForwardPendingTasks(landingState, today);
        const didCarryForward = stateWithCarryForward !== landingState;
        if (didCarryForward) {
          queuePersistState(stateWithCarryForward, "Failed to persist auto carry-forward state to DB:");
        }
        setData(stateWithCarryForward);
        setSortBy(stateWithCarryForward.sortBy || "priority");
        setPomodoroTimers(stateWithCarryForward.pomodoroTimers || {});
        activeTaskIdRef.current = stateWithCarryForward.activeTaskId || null;
        setActiveTaskId(stateWithCarryForward.activeTaskId || null);
        setForm((prev) => ({
          ...prev,
          category: stateWithCarryForward.categories[0] || "General",
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
      queuePersistState(next, "Failed to persist timer state to DB:");
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

  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  useEffect(() => {
    if (!activeTaskId) return;
    const exists = data.tasks.some((task) => task.id === activeTaskId);
    if (!exists) setActiveTaskId(null);
  }, [activeTaskId, data.tasks]);

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

    const categories = [...data.categories, name];
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

  function submitTask(event) {
    event.preventDefault();

    const name = form.taskName.trim();
    const date = form.taskDate;
    if (!name || !date) return;

    const meetingTime = buildMeetingTimeFromFields(form);
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
      inProgress: false,
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

  function startTask(taskId) {
    const tasks = setTaskProgressState(data.tasks, taskId, true).map((task) =>
      task.id === taskId ? { ...task, done: false, hidden: false } : task
    );
    activeTaskIdRef.current = null;
    setActiveTaskId(null);
    persist({ ...data, tasks, activeTaskId: null });
  }

  function stopTask(taskId) {
    const tasks = data.tasks.map((task) =>
      task.id === taskId ? { ...task, inProgress: false } : task
    );
    const nextTimers = { ...pomodoroTimers };
    delete nextTimers[taskId];
    setPomodoroTimers(nextTimers);
    activeTaskIdRef.current = null;
    setActiveTaskId(null);
    persist({ ...data, tasks, activeTaskId: null }, nextTimers);
  }

  function completeTask(taskId) {
    const tasks = data.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return { ...task, done: true, hidden: true, inProgress: false };
    });
    const nextTimers = { ...pomodoroTimers };
    delete nextTimers[taskId];
    setPomodoroTimers(nextTimers);
    activeTaskIdRef.current = null;
    setActiveTaskId(null);
    persist({ ...data, tasks, activeTaskId: null }, nextTimers);
  }

  function hideTask(taskId) {
    const tasks = data.tasks.map((task) =>
      task.id === taskId ? { ...task, hidden: true, done: false, inProgress: false } : task
    );
    activeTaskIdRef.current = null;
    setActiveTaskId(null);
    persist({ ...data, tasks, activeTaskId: null });
  }

  function restoreTask(taskId) {
    const tasks = data.tasks.map((task) =>
      task.id === taskId ? { ...task, hidden: false, done: false, inProgress: false } : task
    );
    persist({ ...data, tasks });
  }

  function deleteTask(taskId) {
    const tasks = data.tasks.filter((task) => task.id !== taskId);
    const nextTimers = { ...pomodoroTimers };
    delete nextTimers[taskId];
    setPomodoroTimers(nextTimers);
    activeTaskIdRef.current = null;
    setActiveTaskId(null);
    persist({ ...data, tasks, activeTaskId: null }, nextTimers);
    if (focusedTaskId === taskId) {
      setFocusedTaskId(null);
    }
    if (editingTaskId === taskId) {
      setEditingTaskId(null);
    }
  }

  function reorderTasksWithinDay(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      setDraggingId(null);
      return;
    }

    const sameDateTasks = orderTasksForDay(data.tasks, data.selectedDate, data.categories);
    const otherTasks = data.tasks.filter((task) => task.date !== data.selectedDate);

    const fromIndex = sameDateTasks.findIndex((task) => task.id === sourceId);
    const toIndex = sameDateTasks.findIndex((task) => task.id === targetId);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggingId(null);
      return;
    }

    const reordered = [...sameDateTasks];
    const [moved] = reordered.splice(fromIndex, 1);
    const targetCategory = reordered[toIndex]?.category || sameDateTasks[toIndex]?.category || moved.category;
    const movedTask = moved.category === targetCategory ? moved : { ...moved, category: targetCategory };
    reordered.splice(toIndex, 0, movedTask);

    const reindexed = reordered.map((task, index) => ({ ...task, order: index }));
    const nextTasks = [...otherTasks, ...reindexed];

    const next = { ...data, tasks: nextTasks, sortBy: "manual" };
    setSortBy("manual");
    persist(next);
    setDraggingId(null);
  }

  function reorderCategories(sourceCategory, targetCategory) {
    if (!sourceCategory || !targetCategory || sourceCategory === targetCategory) {
      setDraggingCategory(null);
      return;
    }

    const categories = [...data.categories];
    const fromIndex = categories.indexOf(sourceCategory);
    const toIndex = categories.indexOf(targetCategory);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggingCategory(null);
      return;
    }

    const reordered = [...categories];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    persist({ ...data, categories: reordered });
    setDraggingCategory(null);
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
      const tasks = setTaskProgressState(data.tasks, taskId, true).map((task) =>
        task.id === taskId ? { ...task, done: false, hidden: false } : task
      );
      activeTaskIdRef.current = null;
      setActiveTaskId(null);
      persist({ ...data, tasks, activeTaskId: null }, nextTimers);
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
    const tasks = setTaskProgressState(data.tasks, taskId, true).map((task) =>
      task.id === taskId ? { ...task, done: false, hidden: false } : task
    );
    activeTaskIdRef.current = null;
    setActiveTaskId(null);
    persist({ ...data, tasks, activeTaskId: null }, nextTimers);
  }

  function openEditTask(taskId) {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    setEditingTaskId(taskId);
    setEditForm(buildTaskFormFromTask(task, today));
    setOpenTaskMenuId(null);
  }

  function updateEditForm(field, value) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  function submitEditTask(event) {
    event.preventDefault();
    if (!editingTaskId) return;

    const name = editForm.taskName.trim();
    const date = editForm.taskDate;
    if (!name || !date) return;

    const meetingTime = buildMeetingTimeFromFields(editForm);
    if (editForm.taskType === "Meeting" && !meetingTime) {
      alert("Meeting time is required for Meeting tasks.");
      return;
    }

    const tasks = data.tasks.map((task) => {
      if (task.id !== editingTaskId) return task;
      return {
        ...task,
        name,
        description: editForm.taskDescription.trim(),
        priority: editForm.priority,
        category: editForm.category,
        taskType: editForm.taskType,
        meetingTime,
        date
      };
    });

    persist({ ...data, tasks, selectedDate: date });
    setEditingTaskId(null);
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
    const isPastDayView = data.selectedDate < today;
    const filtered = data.tasks.filter((task) => {
      if (task.date !== data.selectedDate) return false;
      if (!showAllTasks && task.hidden) {
        const isPastClosedTask = isPastDayView && task.done;
        if (!isPastClosedTask) return false;
      }
      if (filterType !== "All" && task.taskType !== filterType) return false;
      if (filterCategory !== "All" && task.category !== filterCategory) return false;
      if (filterStatus === "Pending" && task.done) return false;
      if (filterStatus === "Completed" && !task.done) return false;
      return true;
    });

    if (sortBy === "manual") {
      const withOrder = filtered.map((task, index) => ({
        task,
        orderValue: Number.isFinite(task.order) ? Number(task.order) : index,
        categoryRank: getCategoryRankMap(data.categories).get(task.category) ?? Number.MAX_SAFE_INTEGER
      }));

      withOrder.sort((a, b) => {
        if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
        return a.orderValue - b.orderValue;
      });
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
    return data.categories
      .filter((category) => groups[category]?.length)
      .map((category) => [category, groups[category]]);
  }, [data.categories, visibleTasks]);
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
              <section
                className={`category-group ${draggingCategory === category ? "dragging-category" : ""}`}
                key={category}
                style={getCategorySectionStyle(category)}
                draggable
                onDragStart={() => setDraggingCategory(category)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorderCategories(draggingCategory, category)}
                onDragEnd={() => setDraggingCategory(null)}
              >
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
                        className={`task ${task.done ? "done" : ""} ${task.inProgress ? "in-progress" : ""}`}
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
                            {task.inProgress && <span className="pill in-progress-pill">In Progress</span>}
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
                                  if (task.inProgress) {
                                    stopTask(task.id);
                                  } else {
                                    startTask(task.id);
                                  }
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                {task.inProgress ? "Stop Task" : "Start Task"}
                              </button>
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
                                onClick={() => openEditTask(task.id)}
                              >
                                Edit Task
                              </button>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  completeTask(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                Complete Task
                              </button>
                              <button
                                type="button"
                                className="task-menu-item"
                                onClick={() => {
                                  deleteTask(task.id);
                                  setOpenTaskMenuId(null);
                                }}
                              >
                                Delete Task
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

      {editingTaskId && (
        <div className="timer-modal-backdrop" role="presentation" onClick={() => setEditingTaskId(null)}>
          <section
            className="timer-modal edit-task-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit task"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="timer-modal-close"
              onClick={() => setEditingTaskId(null)}
              aria-label="Close edit task dialog"
            >
              ✕
            </button>
            <p className="timer-modal-kicker">Edit Task</p>
            <h2>Update Task</h2>
            <form className="form panel-body" onSubmit={submitEditTask}>
              <label>
                Task Name
                <input
                  value={editForm.taskName}
                  onChange={(event) => updateEditForm("taskName", event.target.value)}
                  required
                />
              </label>

              <label>
                Task Description
                <textarea
                  value={editForm.taskDescription}
                  onChange={(event) => updateEditForm("taskDescription", event.target.value)}
                />
              </label>

              <div className="row-3">
                <label>
                  Priority
                  <select
                    value={editForm.priority}
                    onChange={(event) => updateEditForm("priority", event.target.value)}
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </label>

                <label>
                  Task Type
                  <select
                    value={editForm.taskType}
                    onChange={(event) => updateEditForm("taskType", event.target.value)}
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
                    value={editForm.taskDate}
                    onChange={(event) => updateEditForm("taskDate", event.target.value)}
                    required
                  />
                </label>
              </div>

              <label>
                Category
                <select
                  value={editForm.category}
                  onChange={(event) => updateEditForm("category", event.target.value)}
                >
                  {data.categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              {editForm.taskType === "Meeting" && (
                <div className="meeting-block">
                  <div className="row-3">
                    <label>
                      Hour
                      <select
                        value={editForm.meetingHour}
                        onChange={(event) => updateEditForm("meetingHour", event.target.value)}
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
                        value={editForm.meetingMinute}
                        onChange={(event) => updateEditForm("meetingMinute", event.target.value)}
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
                        value={editForm.meetingAmPm}
                        onChange={(event) => updateEditForm("meetingAmPm", event.target.value)}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}

              <div className="timer-modal-actions">
                <button type="submit" className="timer-btn modal-primary">
                  Save Changes
                </button>
                <button
                  type="button"
                  className="timer-btn modal-secondary"
                  onClick={() => setEditingTaskId(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
