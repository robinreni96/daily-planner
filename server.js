import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";
const DEFAULT_CATEGORY_COLOR = "#4f8dfd";

function getTodayDateIST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const defaultState = {
  tasks: [],
  categories: ["General"],
  categoryColors: { General: DEFAULT_CATEGORY_COLOR },
  selectedDate: getTodayDateIST()
};

function normalizeState(payload) {
  const categoriesInput = Array.isArray(payload?.categories)
    ? payload.categories
    : defaultState.categories;

  const categories = Array.from(
    new Set(categoriesInput.map((x) => String(x || "").trim()).filter(Boolean))
  );

  if (!categories.includes("General")) {
    categories.unshift("General");
  }

  const categoryColors = {};
  const rawColors = payload?.categoryColors;
  if (rawColors && typeof rawColors === "object") {
    for (const [key, value] of Object.entries(rawColors)) {
      const category = String(key || "").trim();
      const color = String(value || "").trim();
      if (category && /^#[0-9a-fA-F]{6}$/.test(color)) {
        categoryColors[category] = color;
      }
    }
  }

  for (const category of categories) {
    if (!categoryColors[category]) {
      categoryColors[category] = DEFAULT_CATEGORY_COLOR;
    }
  }

  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const safeTasks = tasks
    .filter((task) => task && typeof task === "object")
    .map((task) => ({
      id: String(task.id || randomUUID()),
      name: String(task.name || ""),
      description: String(task.description || ""),
      priority: String(task.priority || "Medium"),
      category: categories.includes(String(task.category || ""))
        ? String(task.category)
        : "General",
      taskType: String(task.taskType || "Work"),
      meetingTime: String(task.meetingTime || ""),
      date: String(task.date || getTodayDateIST()),
      done: Boolean(task.done),
      hidden: Boolean(task.hidden),
      createdAt: Number(task.createdAt || Date.now())
    }));

  return {
    tasks: safeTasks,
    categories,
    categoryColors,
    selectedDate: String(payload?.selectedDate || getTodayDateIST())
  };
}

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "planner.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("temp_store = MEMORY");

db.exec(`
  CREATE TABLE IF NOT EXISTS planner_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const upsertStateStmt = db.prepare(`
  INSERT INTO planner_state (id, payload, updated_at)
  VALUES (1, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
`);

const getStateStmt = db.prepare("SELECT payload FROM planner_state WHERE id = 1");

upsertStateStmt.run(JSON.stringify(defaultState));

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

app.get("/api/state", (_req, res) => {
  const row = getStateStmt.get();
  if (!row) {
    res.status(404).json({ error: "State not found" });
    return;
  }

  try {
    const parsed = JSON.parse(row.payload);
    res.json(normalizeState(parsed));
  } catch {
    const fallback = normalizeState(defaultState);
    upsertStateStmt.run(JSON.stringify(fallback));
    res.json(fallback);
  }
});

app.put("/api/state", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  try {
    const safeState = normalizeState(req.body);
    upsertStateStmt.run(JSON.stringify(safeState));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to persist state" });
  }
});

const distDir = path.join(__dirname, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: "index.html" }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Planner API running on http://${HOST}:${PORT}`);
  console.log(`SQLite DB: ${dbPath}`);
  if (!fs.existsSync(distDir)) {
    console.log("dist/ not found. Build frontend with: npm run build");
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
