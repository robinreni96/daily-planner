# Daily Planner

A production-ready task planner for data-science workflows with:
- category-based task grouping
- task types (`Work`, `Learning`, `Meeting`)
- priority colors
- clone-to-next-day action
- hidden/completed task workflow
- persistent local database storage (SQLite)

## Tech Stack
- Frontend: React + Vite
- Backend: Express
- Database: SQLite (`better-sqlite3`)

## Project Structure
- `src/` React UI
- `server.js` API server + static file server (production)
- `data/planner.db` SQLite database file
- `vite.config.js` Dev proxy (`/api` -> backend)

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run frontend + backend together:
   ```bash
   npm run dev
   ```
3. Open the Vite URL shown in terminal (for example `http://localhost:5173`).

Backend health endpoint:
- `GET /api/health`

## Production Run (No Docker)
1. Build frontend:
   ```bash
   npm run build
   ```
2. Start server:
   ```bash
   npm run start
   ```
3. Open:
   - `http://<your-host>:8787`

In production, `server.js` serves both:
- API endpoints under `/api/*`
- React app from `dist/`

## Environment Variables
Copy `.env.example` and set values as needed.

- `PORT` (default: `8787`)
- `HOST` (default: `0.0.0.0`)
- `NODE_ENV` (`production` recommended in cloud)
- `DATA_DIR` (optional path for SQLite directory)

## Docker Deployment
Build image:
```bash
docker build -t daily-planner .
```

Run container:
```bash
docker run -d \
  --name daily-planner \
  -p 8787:8787 \
  -v $(pwd)/data:/app/data \
  -e NODE_ENV=production \
  daily-planner
```

Open:
- `http://<your-host>:8787`

## Cloud VM Deployment (Ubuntu Example)
1. Install Node.js 20+.
2. Clone repo and install dependencies:
   ```bash
   npm install
   ```
3. Build app:
   ```bash
   npm run build
   ```
4. Start app with a process manager (PM2):
   ```bash
   npm install -g pm2
   pm2 start npm --name daily-planner -- run start
   pm2 save
   pm2 startup
   ```
5. Put Nginx in front (recommended), reverse-proxy to `127.0.0.1:8787`.

## Data Persistence and Backup
Database file:
- `data/planner.db`

Backup:
```bash
cp data/planner.db data/planner.db.backup
```

Restore:
```bash
cp data/planner.db.backup data/planner.db
```

## Production Hardening Already Included
- SQLite WAL mode + normalized writes
- payload normalization before persistence
- API + SPA served by one backend in production
- graceful shutdown handling (`SIGINT`, `SIGTERM`)
- basic hardening headers (`X-Frame-Options`, `nosniff`, etc.)

## Scripts
- `npm run dev` - run API + frontend dev server
- `npm run build` - build frontend bundle
- `npm run start` - start production server
- `npm run preview` - Vite preview (frontend only)
