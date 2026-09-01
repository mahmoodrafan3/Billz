import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFDocument } from "pdf-lib";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Health check ──
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Directories ──
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const OUTPUT_DIR = path.join(process.cwd(), "outputs");
const PYTHON_SCRIPT = path.join(__dirname, "split_bills.py");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Serve React frontend ──
const frontendPath = path.join(process.cwd(), "../web/dist");
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

// ── Multer config ──
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

// ── Upload PDF → split bills ──
app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const splitMode = (req.body.splitMode as string) || "auto-detect";

    const jobId = uuidv4();
    const jobDir = path.join(OUTPUT_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    if (splitMode === "auto-detect") {
      try {
        const { stdout, stderr } = await execFileAsync("python", [
          PYTHON_SCRIPT,
          filePath,
          jobDir,
        ], { timeout: 120000 });

        if (stderr) {
          console.warn("Python script stderr:", stderr);
        }

        const lines = stdout.trim().split("\n");
        const jsonLine = lines.find((l) => l.startsWith("{") || l.startsWith("["));
        if (!jsonLine) {
          throw new Error("No JSON output from bill detector");
        }
        const result = JSON.parse(jsonLine);

        if (result.error) {
          fs.unlinkSync(filePath);
          fs.rmSync(jobDir, { recursive: true, force: true });
          return res.status(400).json({ error: result.error });
        }

        fs.unlinkSync(filePath);

        const bills = result.bills.map((bill: any) => ({
          id: bill.filename.replace(".pdf", ""),
          name: bill.name,
          pages: bill.pages,
          downloadUrl: `/api/download/${jobId}/${bill.filename}`,
          previewUrl: `/api/preview/${jobId}/${bill.previewFilename}`,
          pageInfo: bill.pages > 1 ? `${bill.pages} pages` : "1 page",
        }));

        return res.json({
          jobId,
          totalPages: result.totalPages,
          totalBills: result.totalBills,
          splitMode: "auto-detect",
          bills,
        });
      } catch (pythonError: any) {
        console.error("Python script error:", pythonError);
        fs.unlinkSync(filePath);
        fs.rmSync(jobDir, { recursive: true, force: true });
        return res.status(500).json({
          error: `Bill detection failed: ${pythonError.message}`,
        });
      }
    }

    // Simple modes: by-page or every-n
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    const bills: {
      id: string;
      name: string;
      pages: number;
      downloadUrl: string;
      pageInfo: string;
    }[] = [];

    if (splitMode === "by-page") {
      for (let i = 0; i < pageCount; i++) {
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
        newPdf.addPage(copiedPage);
        const out = await newPdf.save();
        const billId = `bill_${i + 1}`;
        const filename = `${billId}.pdf`;
        fs.writeFileSync(path.join(jobDir, filename), out);

        bills.push({
          id: billId,
          name: `Page ${i + 1}`,
          pages: 1,
          downloadUrl: `/api/download/${jobId}/${filename}`,
          pageInfo: `Page ${i + 1}`,
        });
      }
    } else if (splitMode === "every-n") {
      const pagesPerBill = parseInt(req.body.pagesPerBill as string) || 1;
      let billCounter = 0;

      for (let start = 0; start < pageCount; start += pagesPerBill) {
        billCounter++;
        const end = Math.min(start + pagesPerBill, pageCount);
        const newPdf = await PDFDocument.create();
        const pageIndices = Array.from(
          { length: end - start },
          (_, i) => start + i
        );
        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach((page) => newPdf.addPage(page));
        const out = await newPdf.save();
        const billId = `bill_${billCounter}`;
        const filename = `${billId}.pdf`;
        fs.writeFileSync(path.join(jobDir, filename), out);

        bills.push({
          id: billId,
          name: `Bill ${billCounter}`,
          pages: end - start,
          downloadUrl: `/api/download/${jobId}/${filename}`,
          pageInfo: `Pages ${start + 1}–${end}`,
        });
      }
    }

    fs.unlinkSync(filePath);

    res.json({
      jobId,
      totalPages: pageCount,
      totalBills: bills.length,
      splitMode,
      bills,
    });
  } catch (error: any) {
    console.error("Error processing PDF:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message || "Failed to process PDF" });
  }
});

// ── Download individual bill ──
app.get("/api/download/:jobId/:filename", (req, res) => {
  const { jobId, filename } = req.params;
  const filePath = path.join(OUTPUT_DIR, jobId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, filename);
});

// ── Preview image ──
app.get("/api/preview/:jobId/:filename", (req, res) => {
  const { jobId, filename } = req.params;
  const filePath = path.join(OUTPUT_DIR, jobId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Preview not found" });
  }

  res.setHeader("Content-Type", "image/png");
  res.sendFile(filePath);
});

// ── Download all bills merged ──
app.get("/api/download-all/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const jobDir = path.join(OUTPUT_DIR, jobId);

  if (!fs.existsSync(jobDir)) {
    return res.status(404).json({ error: "Job not found" });
  }

  const files = fs
    .readdirSync(jobDir)
    .filter((f) => f.endsWith(".pdf"))
    .sort();

  const mergedPdf = await PDFDocument.create();
  for (const file of files) {
    const pdfBytes = fs.readFileSync(path.join(jobDir, file));
    const pdf = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="all-bills.pdf"`
  );
  res.send(Buffer.from(mergedBytes));
});

// ── Cleanup ──
app.delete("/api/jobs/:jobId", (req, res) => {
  const { jobId } = req.params;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
  res.json({ success: true });
});

// ── SPA fallback: serve index.html for all non-API routes ──
app.get("*", (req, res) => {
  const indexPath = path.join(frontendPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: "Frontend not found", frontendPath });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
