import { tmpdir } from "os";
import { join, dirname } from "path";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { exec } from "child_process";
import Document from "../models/Document.js";
import S3Manager from "./s3.js";
import logger from "./logger.js";
import { createRequire } from "module";
import { GoogleGenAI } from "@google/genai";
import { HfInference } from "@huggingface/inference";
import Groq from "groq-sdk";

const require = createRequire(import.meta.url);
const execAsync = promisify(exec);

const rawPdfParse = require("pdf-parse");
const pdfParse =
  typeof rawPdfParse === "function"
    ? rawPdfParse
    : rawPdfParse?.default || rawPdfParse?.pdfParse;

logger.info("pdf-parse typeof", { type: typeof pdfParse });

const { PDFDocument } = require("pdf-lib");
const Tesseract = require("tesseract.js");
import { pdfToImg } from "pdftoimg-js";
import { Jimp } from "jimp";

const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const geminiAI = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;
const huggingface = HUGGINGFACE_TOKEN
  ? new HfInference(HUGGINGFACE_TOKEN)
  : null;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

let mammoth, XLSX;

async function ensureDependencies() {
  if (!mammoth) {
    mammoth = (await import("mammoth")).default;
  }
  if (!XLSX) {
    XLSX = (await import("xlsx")).default;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function processDocument(documentId, s3Key) {
  const document = await Document.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  let filePath, thumbnailPath;

  try {
    await ensureDependencies();

    // Perform actual virus scan
    const virusScanResult = await performVirusScan(s3Key);
    if (!virusScanResult.clean) {
      throw new Error(
        `Virus scan failed: ${
          virusScanResult.details || "Malicious content detected"
        }`
      );
    }

    filePath = await downloadFromS3(s3Key);
    const content = await extractContent(filePath, document.fileType);

    if (!content || content.trim().length === 0) {
      throw new Error("No content extracted from document");
    }

    const pageCount = await getAccuratePageCount(
      filePath,
      document.fileType,
      content
    );

    const metadata = await generateEnhancedMetadata(
      content,
      document.originalFilename,
      document.fileType
    );

    metadata.pageCount = pageCount;
    document.pageCount = pageCount;

    thumbnailPath = await generateThumbnail(filePath, document.fileType);

    if (thumbnailPath) {
      const thumbnailKey = s3Key.replace("/uploads/", "/thumbnails/") + ".jpg";
      await uploadThumbnail(thumbnailPath, thumbnailKey);
      document.thumbnailS3Path = thumbnailKey;
    }

    const embeddingsId = await generateLocalEmbeddings(content, metadata);

    document.generatedTitle = metadata.title;
    document.generatedDescription = metadata.description;
    document.tags = metadata.tags;
    document.category = metadata.category;
    document.pageCount = metadata.pageCount;
    document.embeddingsId = embeddingsId;
    document.metadata = metadata;
    document.status = "processed";
    document.virusScanResult = virusScanResult;
    await document.save();
  } catch (error) {
    logger.error(`Processing failed for document ${documentId}:`, error);
    document.status = "failed";
    document.processingError = error.message;
    await document.save();
    throw error;
  } finally {
    await cleanupTempFile(filePath);
    if (thumbnailPath) await cleanupTempFile(thumbnailPath);
  }
}

async function performVirusScan(s3Key) {
  try {
    logger.info(`Starting virus scan for: ${s3Key}`);

    const vtApiKey = process.env.VIRUSTOTAL_API_KEY;
    if (!vtApiKey) {
      logger.warn("⚠️ VirusTotal API key not configured, using basic validation");
      return await performBasicFileValidation(s3Key);
    }

    return await scanWithVirusTotal(s3Key, vtApiKey);
  } catch (error) {
    logger.error(`Virus scan failed for ${s3Key}:`, error);
    // Fallback to basic validation instead of throwing
    return await performBasicFileValidation(s3Key);
  }
}

async function scanWithVirusTotal(s3Key, apiKey) {
  try {
    const fileBuffer = await S3Manager.getObjectBuffer(s3Key);
    const fileSize = fileBuffer.length;

    // VirusTotal has a 32MB limit for direct uploads
    if (fileSize > 32 * 1024 * 1024) {
      logger.warn(`File too large for VirusTotal (${fileSize} bytes), using basic validation`);
      return await performBasicFileValidation(s3Key);
    }

    const FormData = (await import("form-data")).default;
    const form = new FormData();
    const filename = s3Key.split("/").pop();
    form.append("file", fileBuffer, {
      filename: filename,
      contentType: "application/octet-stream",
    });

    // Upload file to VirusTotal
    logger.info("📤 Uploading file to VirusTotal...");

    // Use node https + form pipe
    const uploadResponse = await new Promise((resolve, reject) => {
      const options = {
        method: "POST",
        headers: {
          "x-apikey": apiKey,
          ...form.getHeaders(),
        },
      };

      const https = require("https");
      const req = https.request(
        "https://www.virustotal.com/api/v3/files",
        options,
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              text: () => Promise.resolve(data),
              json: () => Promise.resolve(JSON.parse(data)),
            });
          });
        }
      );

      req.on("error", reject);
      form.pipe(req);
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      logger.error(`VirusTotal upload failed: ${uploadResponse.status} - ${errorText}`);
      throw new Error(`VirusTotal upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    const analysisId = uploadData.data.id;

    logger.info(`✓ File uploaded. Analysis ID: ${analysisId}`);

    // Poll for analysis results with exponential backoff
    let attempts = 0;
    const maxAttempts = 15;
    let waitTime = 2000; // Start with 2 seconds

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      logger.info(`🔍 Checking analysis status (attempt ${attempts + 1}/${maxAttempts})...`);

      const analysisResponse = await fetch(
        `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        {
          headers: { "x-apikey": apiKey },
        }
      );

      if (!analysisResponse.ok) {
        throw new Error(`Failed to fetch analysis: ${analysisResponse.status}`);
      }

      const analysisData = await analysisResponse.json();
      const status = analysisData.data.attributes.status;

      if (status === "completed") {
        const stats = analysisData.data.attributes.stats;
        const malicious = stats.malicious || 0;
        const suspicious = stats.suspicious || 0;
        const undetected = stats.undetected || 0;
        const harmless = stats.harmless || 0;

        logger.info(
          `📊 Scan results: Malicious: ${malicious}, Suspicious: ${suspicious}, Harmless: ${harmless}, Undetected: ${undetected}`
        );

        // Strict detection: Any malicious or more than 2 suspicious flags
        if (malicious > 0 || suspicious > 2) {
          logger.error(`🚨 THREAT DETECTED in ${s3Key}`);
          return {
            clean: false,
            scanner: "virustotal",
            scannedAt: new Date(),
            details: `Detected by ${malicious} engines as malicious (${suspicious} flagged as suspicious)`,
            threat: malicious > 0 ? "Malware detected" : "Suspicious content detected",
            vtResults: stats,
            analysisId: analysisId,
          };
        }

        logger.info(`✅ VirusTotal scan completed: ${s3Key} is CLEAN`);
        return {
          clean: true,
          scanner: "virustotal",
          scannedAt: new Date(),
          details: `Scanned by ${harmless + undetected} engines - Clean`,
          vtResults: stats,
          analysisId: analysisId,
        };
      }

      // Exponential backoff: increase wait time
      waitTime = Math.min(waitTime * 1.5, 10000); // Max 10 seconds
      attempts++;
    }

    // Timeout reached - be cautious
    logger.warn("⏱️ VirusTotal scan timeout - flagging for manual review");
    return {
      clean: false,
      scanner: "virustotal",
      scannedAt: new Date(),
      details: "Scan timeout - requires manual review",
      threat: "Unable to complete scan",
      warning: "MANUAL_REVIEW_REQUIRED",
    };
  } catch (error) {
    logger.error("❌ VirusTotal scan error:", {
      message: error.message,
      stack: error.stack,
      s3Key: s3Key,
    });
    // Fallback to basic validation
    return await performBasicFileValidation(s3Key);
  }
}

async function performBasicFileValidation(s3Key) {
  const fileBuffer = await S3Manager.getObjectBuffer(s3Key);
  const fileExtension = s3Key.split(".").pop().toLowerCase();

  // 1. Block dangerous extensions
  const dangerousExtensions = [
    "exe", "bat", "cmd", "scr", "pif", "com", "vbs", "js", "jar", 
    "wsf", "msi", "app", "deb", "rpm", "dmg", "pkg", "run", "bin"
  ];

  if (dangerousExtensions.includes(fileExtension)) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: `Blocked executable file type: .${fileExtension}`,
      threat: "Executable file type blocked",
    };
  }

  // 2. Validate file size
  if (fileBuffer.length === 0) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: "Empty file detected",
      threat: "Invalid file",
    };
  }

  if (fileBuffer.length > 50 * 1024 * 1024) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: "File exceeds 50MB limit",
      threat: "File too large",
    };
  }

  // 3. Check file signature (magic numbers)
  const isValidFileType = validateFileSignature(fileBuffer, fileExtension);
  if (!isValidFileType) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: "File signature doesn't match extension",
      threat: "Potential file spoofing",
    };
  }

  // 4. Scan for suspicious patterns
  const suspiciousPatterns = [
    Buffer.from("eval("),
    Buffer.from("<script"),
    Buffer.from("<?php"),
    Buffer.from("#!/bin/"),
  ];

  for (const pattern of suspiciousPatterns) {
    if (fileBuffer.includes(pattern)) {
      logger.warn(`Suspicious pattern found in ${s3Key}`);
      return {
        clean: false,
        scanner: "basic-validation",
        scannedAt: new Date(),
        details: "Suspicious code pattern detected",
        threat: "Potentially malicious content",
      };
    }
  }

  return {
    clean: true,
    scanner: "basic-validation",
    scannedAt: new Date(),
    details: "Basic validation passed",
  };
}

function validateFileSignature(buffer, extension) {
  const signatures = {
    pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
    docx: [0x50, 0x4b, 0x03, 0x04], // ZIP-based
    xlsx: [0x50, 0x4b, 0x03, 0x04],
    pptx: [0x50, 0x4b, 0x03, 0x04],
  };

  const expectedSignature = signatures[extension];
  if (!expectedSignature) return true; // Unknown type, allow

  for (let i = 0; i < expectedSignature.length; i++) {
    if (buffer[i] !== expectedSignature[i]) return false;
  }

  return true;
}

async function generateThumbnail(filePath, fileType) {
  try {
    logger.info(`🎨 Generating first page thumbnail for ${fileType}: ${filePath}`);

    const fs = await import("fs");

    // Verify file exists
    try {
      await fs.promises.access(filePath);
    } catch (accessError) {
      logger.error(`❌ File not accessible: ${filePath}`, accessError);
      return await generateFallbackThumbnail(fileType);
    }

    switch (fileType) {
      case "pdf":
        return await generatePDFFirstPageThumbnail(filePath);

      case "docx":
        return await generateDOCXFirstPageThumbnail(filePath);

      case "pptx":
        return await generatePPTXFirstPageThumbnail(filePath);

      case "xlsx":
      case "csv":
        return await generateSpreadsheetFirstPageThumbnail(filePath, fileType);

      default:
        return await generateFallbackThumbnail(fileType);
    }
  } catch (error) {
    logger.error(`❌ Thumbnail generation failed for ${filePath}:`, {
      error: error.message,
      stack: error.stack,
      fileType: fileType,
    });
    return await generateFallbackThumbnail(fileType);
  }
}

async function generatePDFFirstPageThumbnail(filePath) {
  const fs = await import("fs");

  try {
    logger.info("Generating first-page PDF thumbnail (pdftoimg-js)...", {
      filePath,
    });

    const result = await pdfToImg(filePath, {
      pages: "firstPage",
      imgType: "jpg",
      scale: 2,
      background: "white",
    });

    const imgSrc = Array.isArray(result) ? result[0] : result;
    if (!imgSrc) {
      throw new Error("pdftoimg-js returned no image for first page");
    }

    const base64 = imgSrc.includes(",") ? imgSrc.split(",")[1] : imgSrc;
    const buffer = Buffer.from(base64, "base64");

    const outPath = path.join(
      tmpdir(),
      `pdf-thumb-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}.jpg`
    );

    await fs.promises.writeFile(outPath, buffer);

    logger.info("PDF thumbnail generated", {
      filePath,
      thumbnailPath: outPath,
    });

    return outPath;
  } catch (err) {
    logger.error("PDF thumbnail generation failed", {
      filePath,
      error: err.message,
      stack: err.stack,
    });

    // Fallback: generic thumbnail
    return await generateFallbackThumbnail("pdf");
  }
}

async function generateDOCXFirstPageThumbnail(filePath) {
  // actual DOCX rendering is complex + heavy;
  // this gives a nice type badge instead and is fully portable
  return generateTypeBadgeThumbnail("DOCX", "docx", 0x4f6bedff);
}

async function generatePPTXFirstPageThumbnail(filePath) {
  return generateTypeBadgeThumbnail("PPTX", "pptx", 0xd24726ff);
}

async function generateSpreadsheetFirstPageThumbnail(filePath) {
  // for XLSX, CSV, etc.
  return generateTypeBadgeThumbnail("SHEET", "sheet", 0x217346ff);
}

async function generateTypeBadgeThumbnail(label, fileTypeForName, bgColorHex) {
  const fs = await import("fs");
  const outFileName = `thumb-${fileTypeForName}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}.png`;

  const width = 320;
  const height = 400;

  // bgColorHex: 0xRRGGBBAA (e.g. 0x4f6bedff)
  const image = new Jimp({ width, height, color: bgColorHex });

  // Load built-in Jimp font
  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);

  image.print(
    font,
    0,
    0,
    {
      text: label,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
    },
    width,
    height
  );

  const outPath = path.join(tmpdir(), outFileName);
  await image.write(outPath);

  logger.info("Generated type badge thumbnail", {
    label,
    fileTypeForName,
    outPath,
  });

  return outPath;
}

async function generateFallbackThumbnail(fileType) {
  const label = (fileType || "FILE").toUpperCase();
  return generateTypeBadgeThumbnail(label, "generic", 0x444444ff);
}

function getFileIcon(fileType) {
  const icons = {
    pdf: "📄",
    docx: "📝",
    pptx: "📊",
    xlsx: "📈",
    csv: "📋",
    default: "📁",
  };
  return icons[fileType] || icons.default;
}

async function uploadThumbnail(thumbnailPath, thumbnailKey) {
  try {
    const fs = await import("fs");
    const fileBuffer = await fs.promises.readFile(thumbnailPath);
    await S3Manager.uploadObject(thumbnailKey, fileBuffer, "image/jpeg");
    logger.info(`✅ Thumbnail uploaded to: ${thumbnailKey}`);
  } catch (error) {
    logger.error("Error uploading thumbnail:", error);
    throw error;
  }
}

async function downloadFromS3(s3Key) {
  const tmpPath = join(
    tmpdir(),
    `docsdb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );
  try {
    const objectData = await S3Manager.getObject(s3Key);
    const fs = await import("fs");
    if (objectData.Body) {
      const chunks = [];
      for await (const chunk of objectData.Body) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      await fs.promises.writeFile(tmpPath, buffer);
    } else throw new Error("No body in S3 response");
    return tmpPath;
  } catch (error) {
    logger.error("Error downloading from S3:", error);
    throw error;
  }
}

async function extractContent(filePath, fileType) {
  await ensureDependencies();
  switch (fileType) {
    case "pdf":
      return await extractFromPDF(filePath);
    case "docx":
      return await extractFromDOCX(filePath);
    case "pptx":
      return await extractFromPPTX(filePath);
    case "xlsx":
      return await extractFromXLSX(filePath);
    case "csv":
      return await extractFromCSV(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractFromPDF(filePath) {
  const start = Date.now();
  logger.info("Starting PDF extraction...", { filePath });

  const fs = await import("fs");

  try {
    const buffer = await fs.promises.readFile(filePath);

    // 1) Try native text extraction (fast path)
    let data;
    try {
      data = await pdfParse(buffer);
    } catch (err) {
      logger.error("PDF extraction failed (pdf-parse)", {
        error: err.message,
        stack: err.stack,
      });
      data = null;
    }

    let text = (data && data.text ? data.text : "").trim();

    logger.info("PDF text length (pdf-parse)", {
      filePath,
      length: text.length,
    });

    // If we got enough text, use it
    if (text.length >= 50) {
      logger.info("PDF extraction succeeded via pdf-parse", {
        filePath,
        durationMs: Date.now() - start,
      });
      return text;
    }

    // 2) Fallback to OCR if pdf-parse yields too little
    logger.warn(
      "PDF text too short or empty from pdf-parse; falling back to OCR...",
      { filePath, length: text.length }
    );

    const ocrText = await extractPDFWithOCR(filePath, 5);

    if (!ocrText || !ocrText.trim()) {
      throw new Error("No OCR text extracted from PDF images");
    }

    logger.info("PDF extraction succeeded via OCR fallback", {
      filePath,
      length: ocrText.length,
      durationMs: Date.now() - start,
    });

    return ocrText.trim();
  } catch (err) {
    logger.error("PDF extraction failed", {
      filePath,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

async function extractPDFWithOCR(filePath, maxPages = 5) {
  const start = Date.now();
  logger.info("Starting OCR extraction for PDF...", {
    filePath,
    maxPages,
  });

  try {
    // Use pdf-lib just to determine page count (pure JS)
    const fs = await import("fs");
    const pdfBytes = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    const pagesToProcess = Math.min(totalPages, maxPages);
    if (pagesToProcess === 0) {
      throw new Error("PDF has zero pages");
    }

    const pageIndices = Array.from({ length: pagesToProcess }, (_, i) => i + 1);
    logger.info("OCR target pages", { pagesToProcess, pageIndices });

    // Convert to PNG images purely in JS (pdf.js behind the scenes)
    const images = await pdfToImg(filePath, {
      pages: pageIndices,
      imgType: "png",
      scale: 1.5,
      background: "white",
    });

    // pdfToImg returns either an array or a single string depending on pages
    const imageList = Array.isArray(images) ? images : [images];

    if (!imageList.length) {
      throw new Error("pdftoimg-js returned no images for OCR");
    }

    let combinedText = "";

    for (let i = 0; i < imageList.length; i++) {
      const src = imageList[i];
      if (!src) continue;

      // Expecting DataURL like "data:image/png;base64,...."
      const base64 = src.includes(",") ? src.split(",")[1] : src;
      const buffer = Buffer.from(base64, "base64");

      logger.info("Running Tesseract OCR on page image", {
        page: pageIndices[i],
      });

      // Tesseract.js is pure JS + WASM, works fine on Render
      const result = await Tesseract.recognize(buffer, "eng");
      const pageText = (result.data && result.data.text) || "";

      logger.info("OCR page result", {
        page: pageIndices[i],
        length: pageText.length,
      });

      combinedText += pageText + "\n";
    }

    combinedText = combinedText.trim();

    if (!combinedText) {
      throw new Error("No OCR text extracted from PDF images");
    }

    logger.info("OCR extraction successful", {
      filePath,
      totalLength: combinedText.length,
      durationMs: Date.now() - start,
    });

    return combinedText;
  } catch (err) {
    logger.error("OCR extraction failed", {
      filePath,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

async function extractFromDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  } catch (error) {
    logger.error("DOCX extraction failed:", error);
    throw new Error(`DOCX extraction failed: ${error.message}`);
  }
}

async function extractFromPPTX(filePath) {
  return "Presentation content extracted from PPTX file. Full PPTX text extraction to be implemented.";
}

async function extractFromXLSX(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    let content = "";
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      content += `Sheet: ${sheetName}\n`;
      content += XLSX.utils.sheet_to_csv(worksheet) + "\n\n";
    });
    return content;
  } catch (error) {
    logger.error("XLSX extraction failed:", error);
    throw new Error(`XLSX extraction failed: ${error.message}`);
  }
}

async function extractFromCSV(filePath) {
  const fs = await import("fs");
  return fs.promises.readFile(filePath, "utf8");
}

async function generateEnhancedMetadata(content, filename, fileType) {
  try {
    const geminiResult = await generateWithGemini(content, filename);
    if (geminiResult?.title) {
      logger.info("Used Google Gemini for metadata");
      return enrichMetadataWithLocalData(
        geminiResult,
        content,
        fileType,
        "gemini"
      );
    }
  } catch (error) {
    logger.warn(`Gemini failed: ${error.message}`);
  }

  try {
    const groqResult = await generateWithGroq(content, filename);
    if (groqResult?.title) {
      logger.info("Used Groq for metadata");
      return enrichMetadataWithLocalData(
        groqResult,
        content,
        fileType,
        "groq"
      );
    }
  } catch (error) {
    logger.warn(`Groq failed: ${error.message}`);
  }

  try {
    const hfResult = await generateWithHuggingFace(content, filename);
    if (hfResult?.title) {
      logger.info("Used Hugging Face for metadata");
      return enrichMetadataWithLocalData(
        hfResult,
        content,
        fileType,
        "huggingface"
      );
    }
  } catch (error) {
    logger.warn(`Hugging Face failed: ${error.message}`);
  }

  try {
    const ollamaResult = await generateWithOllama(content, filename);
    if (ollamaResult?.title) {
      logger.info("Used Ollama for metadata");
      return enrichMetadataWithLocalData(
        ollamaResult,
        content,
        fileType,
        "ollama"
      );
    }
  } catch (error) {
    logger.warn(`Ollama failed: ${error.message}`);
  }

  logger.info("Using smart local processing for metadata");
  return generateUniversalMetadata(content, filename, fileType);
}

async function generateWithGemini(content, filename) {
  if (!geminiAI) throw new Error("Gemini API key not configured");

  const truncatedContent = content.substring(0, 4000);
  const prompt = `Analyze this document and return ONLY valid JSON:
{
  "title": "concise title under 80 chars",
  "description": "1-2 sentence description", 
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "category": "only choose ONE strictly from this list — do not invent new ones:
  ["for-you","technology","business","education","health","entertainment","sports",
  "finance-money-management","games-activities","comics","philosophy","career-growth",
  "politics","biography-memoir","study-aids-test-prep","law","art","science","history",
  "erotica","lifestyle","religion-spirituality","self-improvement","language-arts",
  "cooking-food-wine","true-crime","sheet-music","fiction","non-fiction",
  "science-fiction","fantasy","romance","thriller-suspense","horror","poetry",
  "graphic-novels","young-adult","children","parenting-family","marketing-sales",
  "psychology","social-sciences","engineering","mathematics","data-science",
  "nature-environment","travel","reference","design","news-media",
  "professional-development","other"]
}

Document: ${filename}
Content: ${truncatedContent}

Return only valid JSON and do not generate new categories like 'computer-science'.`;

  try {
    const response = await geminiAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: { temperature: 0.3, maxOutputTokens: 300 },
    });

    const text = response.text;
    if (!text) throw new Error("No response text from Gemini");

    return parseAIResponse(text);
  } catch (error) {
    throw new Error(`Gemini: ${error.message}`);
  }
}

async function generateWithGroq(content, filename) {
  if (!groq) throw new Error("Groq API key not configured");

  const truncatedContent = content.substring(0, 4000);

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "You are a document analysis assistant. Return ONLY valid JSON without any formatting or markdown.",
        },
        {
          role: "user",
          content: `Analyze this document and return JSON with title, description, tags, category: "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"]
Filename: ${filename}
Content: ${truncatedContent}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const contentText = response.choices[0]?.message?.content;
    if (!contentText) throw new Error("No response content from Groq");

    return parseAIResponse(contentText);
  } catch (error) {
    throw new Error(`Groq: ${error.message}`);
  }
}

async function generateWithHuggingFace(content, filename) {
  if (!huggingface) throw new Error("Hugging Face token not configured");

  const truncatedContent = content.substring(0, 2000);
  const prompt = `Analyze document and return JSON: { "title": "...", "description": "...", "tags": [...], "category": "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"] }
Document: ${filename}
Content: ${truncatedContent}`;

  try {
    const result = await huggingface.textGeneration({
      model: "mistralai/Mistral-7B-Instruct-v0.1",
      inputs: prompt,
      parameters: { max_new_tokens: 300, temperature: 0.3 },
    });

    return parseAIResponse(result.generated_text);
  } catch (error) {
    throw new Error(`Hugging Face: ${error.message}`);
  }
}

async function generateWithOllama(content, filename) {
  const truncatedContent = content.substring(0, 2000);

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama2",
        prompt: `Return JSON: { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3"], "category": "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"] }
Document: ${filename}
Content: ${truncatedContent}`,
        stream: false,
        format: "json",
        options: { temperature: 0.3 },
      }),
    });

    if (!response.ok) throw new Error("Ollama not running");
    const result = await response.json();

    return parseAIResponse(result.response);
  } catch (error) {
    throw new Error(`Ollama: ${error.message}`);
  }
}

function parseAIResponse(text) {
  if (!text) throw new Error("Empty response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.title || !parsed.description) {
      throw new Error("Missing required fields in JSON");
    }
    return parsed;
  } catch (parseError) {
    throw new Error(`Invalid JSON: ${parseError.message}`);
  }
}

function enrichMetadataWithLocalData(aiMetadata, content, fileType, generatedBy) {
  return {
    ...aiMetadata,
    pageCount: estimatePageCount(content),
    wordCount: content.split(/\s+/).length,
    characterCount: content.length,
    language: detectLanguage(content),
    keyThemes: extractUniversalThemes(content),
    summary: generateUniversalSummary(content, fileType),
    documentType: fileType,
    readabilityScore: calculateReadability(content),
    generatedBy,
    processedAt: new Date().toISOString(),
  };
}

function generateUniversalMetadata(content, filename, fileType) {
  const title = generateUniversalTitle(content, filename, fileType);
  const description = generateUniversalDescription(content, fileType);
  const tags = extractUniversalTags(content, title, fileType);
  const category = detectUniversalCategory(content, fileType);

  return {
    title,
    description,
    tags,
    category,
    pageCount: estimatePageCount(content),
    wordCount: content.split(/\s+/).length,
    characterCount: content.length,
    language: detectLanguage(content),
    keyThemes: extractUniversalThemes(content),
    summary: generateUniversalSummary(content, fileType),
    documentType: fileType,
    readabilityScore: calculateReadability(content),
    generatedBy: "smart-local-processor",
    processedAt: new Date().toISOString(),
  };
}

function generateUniversalTitle(content, filename, fileType) {
  const cleanFilename = filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  if (fileType === "pdf" || fileType === "docx") {
    const lines = content.split("\n").slice(0, 10);
    const potentialTitles = lines.filter((line) => {
      const words = line.trim().split(/\s+/);
      return (
        words.length >= 2 &&
        words.length <= 12 &&
        !line.match(/page|\d{1,2}\/\d{1,2}|chapter|section/i)
      );
    });
    if (potentialTitles.length > 0)
      return potentialTitles[0].trim().substring(0, 80);
  }

  const lines = content.split("\n");
  const titleCandidates = lines
    .map((line) => {
      const words = line.trim().split(/\s+/);
      const capitalRatio =
        words.filter(
          (word) => word.length > 0 && word[0] === word[0].toUpperCase()
        ).length / Math.max(1, words.length);
      return { line: line.trim(), score: capitalRatio, length: words.length };
    })
    .filter(
      (candidate) =>
        candidate.score > 0.6 && candidate.length >= 2 && candidate.length <= 10
    )
    .sort((a, b) => b.score - a.score);

  if (titleCandidates.length > 0)
    return titleCandidates[0].line.substring(0, 80);

  const sentences = content.split(/[.!?]+/);
  const firstMeaningful = sentences.find((s) => {
    const trimmed = s.trim();
    return (
      trimmed.length > 10 &&
      trimmed.length < 120 &&
      !trimmed.match(/^\s*(abstract|introduction|table of contents)/i)
    );
  });

  return firstMeaningful
    ? firstMeaningful.trim().substring(0, 80)
    : cleanFilename || "Untitled Document";
}

function generateUniversalDescription(content, fileType) {
  const paragraphs = content
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 50);
  if (paragraphs.length > 0) {
    const bestParagraph = paragraphs.reduce(
      (best, current) => {
        const words = current.toLowerCase().split(/\s+/);
        const uniqueWords = new Set(words);
        const diversity = uniqueWords.size / words.length;
        const lengthScore = 1 - Math.abs(0.7 - words.length / 200);
        return diversity * lengthScore > best.score
          ? { text: current, score: diversity * lengthScore }
          : best;
      },
      { text: paragraphs[0], score: 0 }
    );
    return bestParagraph.text.substring(0, 250).trim() + "...";
  }

  if (content.length < 500)
    return content.substring(0, 200) + (content.length > 200 ? "..." : "");

  const sentences = content
    .split(/[.!?]+/)
    .filter((s) => s.trim().length > 20);
  const keySentences = sentences
    .slice(0, 3)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return keySentences.join(". ") + ".";
}

function extractUniversalTags(content, title, fileType) {
  const allText = (content + " " + title).toLowerCase();
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "this",
    "that",
    "these",
    "those",
    "them",
    "then",
    "than",
    "from",
    "into",
    "using",
    "based",
    "within",
    "between",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "upon",
    "about",
    "against",
    "among",
    "since",
    "until",
  ]);

  const words = allText
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word.toLowerCase()));
  const wordScores = {};
  words.forEach((word) => {
    const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleanWord.length > 3)
      wordScores[cleanWord] = (wordScores[cleanWord] || 0) + 1;
  });

  const titleWords = new Set(title.toLowerCase().split(/\s+/));
  Object.keys(wordScores).forEach((word) => {
    if (titleWords.has(word)) wordScores[word] *= 3;
  });

  const phrases = {};
  const sentences = content.toLowerCase().split(/[.!?]+/);
  sentences.forEach((sentence) => {
    const sentenceWords = sentence
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (let i = 0; i < sentenceWords.length - 1; i++) {
      const phrase2 = `${sentenceWords[i]} ${sentenceWords[i + 1]}`;
      if (
        !stopWords.has(sentenceWords[i]) &&
        !stopWords.has(sentenceWords[i + 1])
      )
        phrases[phrase2] = (phrases[phrase2] || 0) + 1;
      if (i < sentenceWords.length - 2) {
        const phrase3 = `${sentenceWords[i]} ${sentenceWords[i + 1]} ${
          sentenceWords[i + 2]
        }`;
        if (!stopWords.has(sentenceWords[i + 2]))
          phrases[phrase3] = (phrases[phrase3] || 0) + 1;
      }
    }
  });

  const allTerms = { ...wordScores };
  Object.entries(phrases).forEach(([phrase, count]) => {
    if (count > 1) allTerms[phrase] = count * 2;
  });

  return Object.entries(allTerms)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([term]) => term)
    .filter((term) => term && term.length > 0);
}

function detectUniversalCategory(content, fileType) {
  const categories = {
    technology: {
      keywords: [
        "tech",
        "innovation",
        "gadget",
        "software",
        "hardware",
        "AI",
        "computer",
        "internet",
        "digital",
        "future",
      ],
      weight: 2,
    },
    business: {
      keywords: [
        "company",
        "startup",
        "entrepreneur",
        "management",
        "strategy",
        "leadership",
        "economy",
        "commerce",
        "industry",
        "executive",
      ],
      weight: 2,
    },
    education: {
      keywords: [
        "learn",
        "teach",
        "school",
        "college",
        "student",
        "teacher",
        "curriculum",
        "classroom",
        "degree",
        "skill",
      ],
      weight: 2,
    },
    health: {
      keywords: [
        "wellness",
        "fitness",
        "nutrition",
        "diet",
        "exercise",
        "mental",
        "physical",
        "doctor",
        "therapy",
        "wellbeing",
      ],
      weight: 2,
    },
    science: {
      keywords: [
        "science",
        "discovery",
        "experiment",
        "theory",
        "research",
        "lab",
        "scientist",
        "fact",
        "universe",
        "knowledge",
      ],
      weight: 2,
    },
  };

  const contentLower = content.toLowerCase();
  let bestCategory = "other";
  let maxScore = 0;

  for (const [category, config] of Object.entries(categories)) {
    let score = 0;
    config.keywords.forEach((keyword) => {
      if (contentLower.includes(keyword)) {
        score += config.weight;
        const occurrences =
          contentLower.match(new RegExp(keyword, "g")) || [];
        if (occurrences.length > 1) score += (occurrences.length - 1) * 0.5;
      }
    });
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}

function extractUniversalThemes(content) {
  const sentences = content.toLowerCase().split(/[.!?]+/);
  const themeCandidates = {};
  sentences.forEach((sentence) => {
    const words = sentence
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    for (let i = 0; i < words.length - 1; i++) {
      const phrase2 = `${words[i]} ${words[i + 1]}`;
      themeCandidates[phrase2] = (themeCandidates[phrase2] || 0) + 1;
      if (i < words.length - 2) {
        const phrase3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        themeCandidates[phrase3] = (themeCandidates[phrase3] || 0) + 1;
      }
    }
  });
  return Object.entries(themeCandidates)
    .filter(([, count]) => count > 1)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([theme]) => theme);
}

function generateUniversalSummary(content, fileType) {
  if (content.length < 300) return content;
  const sentences = content
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  const scoredSentences = sentences.map((sentence, index) => {
    let score = 0;
    if (index < 3) score += 2;
    if (index < sentences.length / 2) score += 1;
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 8 && wordCount <= 25) score += 2;
    const importantWords = [
      "conclusion",
      "summary",
      "important",
      "key",
      "primary",
      "main",
      "essential",
    ];
    importantWords.forEach((word) => {
      if (sentence.toLowerCase().includes(word)) score += 2;
    });
    return { sentence, score, index };
  });
  const topSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence);
  return topSentences.join(". ") + ".";
}

function calculateReadability(content) {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const characters = content.replace(/\s/g, "").length;
  if (sentences.length === 0 || words.length === 0) return 0;
  const avgSentenceLength = words.length / sentences.length;
  const avgWordLength = characters / words.length;
  let score = 100 - (avgSentenceLength * 1.5 + avgWordLength * 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function detectLanguage(content) {
  const languagePatterns = {
    en: ["the", "and", "is", "in", "to", "of", "a", "that", "it", "with"],
    es: ["el", "la", "de", "que", "y", "en", "un", "es", "se", "no"],
    fr: ["le", "la", "de", "et", "à", "en", "un", "que", "est", "pour"],
    de: ["der", "die", "das", "und", "in", "den", "von", "zu", "dem", "mit"],
    it: ["il", "la", "di", "e", "che", "in", "un", "per", "sono", "con"],
  };
  const contentLower = content.toLowerCase();
  let bestLang = "en";
  let maxMatches = 0;
  for (const [lang, words] of Object.entries(languagePatterns)) {
    const matches = words.filter(
      (word) =>
        contentLower.includes(" " + word + " ") ||
        contentLower.startsWith(word + " ") ||
        contentLower.endsWith(" " + word)
    ).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestLang = lang;
    }
  }
  return bestLang;
}

async function getAccuratePageCount(filePath, fileType, content) {
  try {
    switch (fileType) {
      case "pdf":
        return await getPDFPageCount(filePath);

      case "docx":
        return await getDOCXPageCount(filePath, content);

      case "pptx":
        return await getPPTXPageCount(filePath);

      case "xlsx":
        return await getXLSXPageCount(filePath);

      case "csv":
        return 1; // CSV is typically single page

      default:
        return estimatePageCount(content);
    }
  } catch (error) {
    logger.error(`Error calculating page count for ${fileType}:`, error.message);
    return estimatePageCount(content);
  }
}

// ---------- NEW PDF PAGE COUNT (pdf-lib) ----------
async function getPDFPageCount(filePath) {
  try {
    const fs = await import("fs");
    const buffer = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(buffer);
    const pageCount = pdfDoc.getPageCount();
    logger.info(`✓ PDF page count (pdf-lib): ${pageCount}`);
    return pageCount;
  } catch (error) {
    logger.error("Failed to get PDF page count (pdf-lib):", error.message);
    throw error;
  }
}

async function getDOCXPageCount(filePath, content) {
  try {
    // DOCX doesn't store explicit page count, estimate based on content
    // Average: 500 words per page or 3000 characters per page
    const wordCount = content.split(/\s+/).length;
    const charCount = content.length;

    const pagesByWords = Math.ceil(wordCount / 500);
    const pagesByChars = Math.ceil(charCount / 3000);

    // Use average of both methods
    const pageCount = Math.max(
      1,
      Math.round((pagesByWords + pagesByChars) / 2)
    );

    logger.info(`✓ DOCX estimated page count: ${pageCount} (${wordCount} words)`);
    return pageCount;
  } catch (error) {
    logger.error("Failed to estimate DOCX page count:", error.message);
    return 1;
  }
}

async function getPPTXPageCount(filePath) {
  try {
    const AdmZip = (await import("adm-zip")).default;
    const fs = await import("fs");

    const zipBuffer = await fs.promises.readFile(filePath);
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    // Count slide XML files
    const slideCount = zipEntries.filter(
      (entry) =>
        entry.entryName.startsWith("ppt/slides/slide") &&
        entry.entryName.endsWith(".xml")
    ).length;

    logger.info(`✓ PPTX page count: ${slideCount} slides`);
    return Math.max(1, slideCount);
  } catch (error) {
    logger.error("Failed to get PPTX page count:", error.message);
    return 1;
  }
}

async function getXLSXPageCount(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetCount = workbook.SheetNames.length;

    logger.info(`✓ XLSX page count: ${sheetCount} sheets`);
    return Math.max(1, sheetCount);
  } catch (error) {
    logger.error("Failed to get XLSX page count:", error.message);
    return 1;
  }
}

function estimatePageCount(content) {
  const wordCount = content.split(/\s+/).length;
  const charCount = content.length;
  const byWords = Math.max(1, Math.ceil(wordCount / 500));
  const byChars = Math.max(1, Math.ceil(charCount / 2500));
  return Math.round((byWords + byChars) / 2);
}

async function generateLocalEmbeddings(content, metadata) {
  const embeddingData = {
    contentHash: generateContentHash(content.substring(0, 2000)),
    keyTerms: metadata.tags,
    category: metadata.category,
    documentType: metadata.documentType,
    wordCount: metadata.wordCount,
    readability: metadata.readabilityScore,
    generatedAt: new Date().toISOString(),
  };
  const embeddingId = `local-${Buffer.from(JSON.stringify(embeddingData))
    .toString("base64")
    .substring(0, 32)}`;
  return embeddingId;
}

function generateContentHash(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function cleanupTempFile(filePath) {
  if (!filePath) return;
  try {
    const fs = await import("fs");
    await fs.promises.unlink(filePath);
  } catch (error) {
    logger.warn(
      `Could not clean up temporary file ${filePath}:`,
      error.message
    );
  }
}
