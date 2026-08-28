# 📋 Billz — Medical Shop Tool

A full-stack web app for wholesale medical shops to **upload a combined PDF of bills**, **auto-separate them**, and **download/share individual bills**.

## Features

- 📤 **Upload** a combined PDF with multiple bills
- ✂️ **Auto-split** by page or every N pages
- 📥 **Download** individual bills as separate PDFs
- 📦 **Download All** as a combined PDF
- 🖱️ **Drag & Drop** upload support
- 📱 **Mobile-friendly** responsive UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Express + TypeScript |
| PDF Processing | pdf-lib |

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)

### Install & Run

```bash
# Clone and install
cd billz
pnpm install

# Run both frontend and backend
pnpm dev

# Or run separately:
pnpm dev:api   # Backend on http://localhost:3001
pnpm dev:web   # Frontend on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## How It Works

1. **Upload** your combined PDF (all bills in one file)
2. **Choose split mode:**
   - **Each page = 1 bill** — splits every page into its own PDF
   - **Every N pages = 1 bill** — groups pages together (e.g., 2 pages per bill)
3. **Download** individual bills or all at once
4. **Share** each PDF with the respective medical shop

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload & split PDF |
| `GET` | `/api/download/:jobId/:filename` | Download individual bill |
| `GET` | `/api/download-all/:jobId` | Download all as combined PDF |
| `GET` | `/api/jobs/:jobId` | List bills for a job |
| `DELETE` | `/api/jobs/:jobId` | Cleanup job files |
