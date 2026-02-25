import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

const IST_TIMEZONE = "Asia/Kolkata";
const DEFAULT_CATEGORY_COLOR = "#4f8dfd";

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing Postgres connection string. Set POSTGRES_URL (recommended) or DATABASE_URL / NEON_DATABASE_URL."
  );
}

const sql = neon(connectionString);

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

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS planner_state (
      id INTEGER PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

async function getStateFromDb() {
  await ensureTable();

  const rows = await sql`SELECT payload FROM planner_state WHERE id = 1;`;

  if (rows.length === 0) {
    const normalized = normalizeState(defaultState);
    await sql`
      INSERT INTO planner_state (id, payload)
      VALUES (1, ${JSON.stringify(normalized)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();
    `;
    return normalized;
  }

  try {
    const raw = rows[0].payload;
    return normalizeState(raw);
  } catch {
    const normalized = normalizeState(defaultState);
    await sql`
      INSERT INTO planner_state (id, payload)
      VALUES (1, ${JSON.stringify(normalized)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();
    `;
    return normalized;
  }
}

async function saveStateToDb(payload) {
  await ensureTable();

  const safeState = normalizeState(payload);

  await sql`
    INSERT INTO planner_state (id, payload)
    VALUES (1, ${JSON.stringify(safeState)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = NOW();
  `;

  return safeState;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const state = await getStateFromDb();
      res.status(200).json(state);
      return;
    }

    if (req.method === "PUT") {
      const body =
        typeof req.body === "string" && req.body
          ? JSON.parse(req.body)
          : req.body;

      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid payload" });
        return;
      }

      await saveStateToDb(body);
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader("Allow", "GET, PUT");
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Error handling /api/state:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

