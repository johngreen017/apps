import express from "express";
import crypto from "node:crypto";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));

const PORT = process.env.PORT || 8080;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || "";
const PDF_PASSWORD = process.env.PDF_PASSWORD || "";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function auth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!SERVICE_TOKEN || !safeEqual(token, SERVICE_TOKEN)) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

function parseCLP(value) {
  if (!value) return 0;
  const digits = String(value).replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

function extractSalary(text) {
  const normalized = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .trim();

  const patterns = [
    /L[IÍ]QUIDO\s+A\s+PAGAR[\s:$.-]*([0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{5,})/i,
    /TOTAL\s+L[IÍ]QUIDO[\s:$.-]*([0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{5,})/i,
    /ALCANCE\s+L[IÍ]QUIDO[\s:$.-]*([0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{5,})/i,
    /L[IÍ]QUIDO(?:\s+TOTAL)?[\s:$.-]*([0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{5,})/i,
    /MONTO\s+A\s+DEPOSITAR[\s:$.-]*([0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{5,})/i
  ];

  for (const pattern of patterns) {
    const m = normalized.match(pattern);
    if (m) {
      const monto = parseCLP(m[1]);
      if (monto > 0) return { monto, etiqueta: m[0].slice(0, 80) };
    }
  }

  const lines = normalized.split(/\n+/).map(x => x.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/l[ií]quido|monto a depositar/i.test(lines[i])) {
      const nearby = lines.slice(i, i + 3).join(" ");
      const m = nearby.match(/([0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{5,})/);
      if (m) {
        const monto = parseCLP(m[1]);
        if (monto > 0) return { monto, etiqueta: lines[i].slice(0, 80) };
      }
    }
  }

  return null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "salary-pdf-service" });
});

app.post("/extract-salary", auth, async (req, res) => {
  try {
    if (!PDF_PASSWORD) return res.status(500).json({ ok: false, error: "PDF_PASSWORD no configurada" });

    const pdfBase64 = String(req.body?.pdfBase64 || "");
    if (!pdfBase64) return res.status(400).json({ ok: false, error: "Falta pdfBase64" });

    const bytes = Uint8Array.from(Buffer.from(pdfBase64, "base64"));
    const task = pdfjsLib.getDocument({
      data: bytes,
      password: PDF_PASSWORD,
      disableFontFace: true,
      useSystemFonts: true
    });

    const pdf = await task.promise;
    const pageTexts = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map(item => item.str || "").join(" "));
    }

    const text = pageTexts.join("\n");
    const salary = extractSalary(text);

    if (!salary) {
      return res.status(422).json({
        ok: false,
        error: "No se encontró el monto líquido en la liquidación"
      });
    }

    return res.json({
      ok: true,
      monto: salary.monto,
      moneda: "CLP"
    });
  } catch (err) {
    const message = String(err?.message || err || "Error");
    const wrongPassword = /password|encrypted|decrypt/i.test(message);
    return res.status(wrongPassword ? 422 : 500).json({
      ok: false,
      error: wrongPassword ? "No se pudo abrir el PDF con la clave configurada" : "No se pudo procesar el PDF"
    });
  }
});

app.listen(PORT, () => {
  console.log(`salary-pdf-service escuchando en puerto ${PORT}`);
});
