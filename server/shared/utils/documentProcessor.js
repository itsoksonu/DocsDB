import { tmpdir } from "os";
import { join, dirname } from "path";
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
import { createCanvas } from "canvas";

const require = createRequire(import.meta.url);
const execAsync = promisify(exec);

const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const geminiAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const huggingface = HUGGINGFACE_TOKEN ? new HfInference(HUGGINGFACE_TOKEN) : null;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

let pdfParse, mammoth, XLSX;

async function ensureDependencies() {
  if (!pdfParse) {
    const pdfModule = await import("pdf-parse");
    pdfParse = pdfModule.default || pdfModule;
  }
  if (!mammoth) {
    mammoth = (await import("mammoth")).default;
  }
  if (!XLSX) {
    XLSX = (await import("xlsx")).default;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return {
      canvas: canvas,
      context: context,
    };
  }

  reset(canvasAndContext, width, height) {
    // Do nothing - https://github.com/mozilla/pdf.js/issues/12476
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
    canvasAndContext.canvas.style = {}; // Fix for scaled canvas
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export async function processDocument(documentId, s3Key) {
  const document = await Document.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  let filePath, thumbnailPath;

  try {
    await ensureDependencies();
    
    // Perform actual virus scan
    const virusScanResult = await performVirusScan(s3Key);
    if (!virusScanResult.clean) {
      throw new Error(`Virus scan failed: ${virusScanResult.details || 'Malicious content detected'}`);
    }

    filePath = await downloadFromS3(s3Key);
    const content = await extractContent(filePath, document.fileType);

    if (!content || content.trim().length === 0) {
      throw new Error("No content extracted from document");
    }

    const metadata = await generateEnhancedMetadata(content, document.originalFilename, document.fileType);
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
    
    // Check if ClamAV is available
    try {
      await execAsync('which clamscan');
    } catch {
      logger.warn('ClamAV not found, using basic file type validation');
      return await performBasicFileValidation(s3Key);
    }

    // Download file for scanning
    const fileBuffer = await S3Manager.getObjectBuffer(s3Key);
    const tmpPath = join(tmpdir(), `scan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    
    const fs = await import("fs");
    await fs.promises.writeFile(tmpPath, fileBuffer);

    try {
      // Perform ClamAV scan
      const { stdout, stderr } = await execAsync(`clamscan --no-summary --infected "${tmpPath}"`);
      
      if (stderr && stderr.includes('FOUND')) {
        throw new Error(`Virus detected: ${stderr}`);
      }

      // Additional security checks
      await validateFileSafety(tmpPath, s3Key);

      logger.info(`✅ Virus scan completed for: ${s3Key}`);
      return { 
        clean: true, 
        scanner: "clamav", 
        scannedAt: new Date(),
        details: "No threats detected"
      };

    } finally {
      await cleanupTempFile(tmpPath);
    }

  } catch (error) {
    logger.error(`Virus scan failed for ${s3Key}:`, error);
    
    if (error.message.includes('FOUND') || error.message.includes('infected')) {
      return { 
        clean: false, 
        scanner: "clamav", 
        scannedAt: new Date(),
        details: error.message,
        threat: "Known malware detected"
      };
    }
    
    throw new Error(`Virus scan failed: ${error.message}`);
  }
}

async function performBasicFileValidation(s3Key) {
  const fileExtension = s3Key.split('.').pop().toLowerCase();
  const dangerousExtensions = ['exe', 'bat', 'cmd', 'scr', 'pif', 'com', 'vbs', 'js', 'jar', 'wsf', 'msi'];
  
  if (dangerousExtensions.includes(fileExtension)) {
    return { 
      clean: false, 
      scanner: "basic-validation", 
      scannedAt: new Date(),
      details: `Potentially dangerous file type: .${fileExtension}`,
      threat: "Executable file type blocked"
    };
  }

  return { 
    clean: true, 
    scanner: "basic-validation", 
    scannedAt: new Date(),
    details: "Basic validation passed"
  };
}

async function validateFileSafety(filePath, s3Key) {
  const fs = await import("fs");
  const fileStats = await fs.promises.stat(filePath);
  
  // Check for suspicious file characteristics
  if (fileStats.size === 0) {
    throw new Error("Empty file detected");
  }

  // Check file size (max 50MB)
  if (fileStats.size > 50 * 1024 * 1024) {
    throw new Error("File too large (max 50MB)");
  }
}

async function ensurePDFDependencies() {
  try {
    // Check if canvas is available
    await import('canvas');
    
    // Check if pdfjs-dist is available
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    
    logger.info('✅ PDF thumbnail dependencies are available');
    return true;
  } catch (error) {
    logger.error('❌ PDF thumbnail dependencies missing:', error.message);
    return false;
  }
}

async function generateThumbnail(filePath, fileType) {
  try {
    logger.info(`Generating thumbnail for ${fileType} file: ${filePath}`);
    
    // Check if file exists and is accessible
    const fs = await import("fs");
    try {
      await fs.promises.access(filePath);
    } catch (accessError) {
      logger.error(`File not accessible: ${filePath}`, accessError);
      return await generateFallbackThumbnail(fileType);
    }
    
    switch (fileType) {
      case "pdf":
        // Check dependencies first
        const pdfDepsAvailable = await ensurePDFDependencies();
        if (!pdfDepsAvailable) {
          logger.warn('PDF dependencies not available, using enhanced fallback');
          return await generateEnhancedPDFFallback(filePath);
        }
        return await generatePDFThumbnail(filePath);
      case "docx":
        return await generateDOCXThumbnail(filePath);
      case "pptx":
        return await generatePPTXThumbnail(filePath);
      case "xlsx":
      case "csv":
        return await generateSpreadsheetThumbnail(filePath, fileType);
      default:
        return await generateFallbackThumbnail(fileType);
    }
  } catch (error) {
    logger.error(`Thumbnail generation failed for ${filePath}:`, {
      error: error.message,
      fileType: fileType
    });
    return await generateFallbackThumbnail(fileType);
  }
}

async function generatePDFThumbnail(filePath) {
  const fs = await import("fs");
  
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import('canvas');

    logger.info(`Generating PDF thumbnail for: ${filePath}`);

    // Read PDF file
    const dataBuffer = await fs.promises.readFile(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    
    const canvasFactory = new NodeCanvasFactory();

    // Optional: for better font and cmap support
    const CMAP_URL = join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'cmaps') + '/';
    const STANDARD_FONT_DATA_URL = join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';

    // Load PDF document
    const pdf = await pdfjsLib.getDocument({ 
      data: uint8Array,
      verbosity: 0,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      canvasFactory: canvasFactory
    }).promise;

    logger.info(`PDF loaded successfully. Pages: ${pdf.numPages}`);

    // Use first page for thumbnail
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    
    // Calculate dimensions for thumbnail (300x400)
    const scale = Math.min(300 / viewport.width, 400 / viewport.height) * 0.8;
    const scaledViewport = page.getViewport({ scale });
    
    // Create canvas using factory
    const canvasAndContext = canvasFactory.create(
      scaledViewport.width,
      scaledViewport.height
    );
    const ctx = canvasAndContext.context;

    // Professional background
    const gradient = ctx.createLinearGradient(0, 0, scaledViewport.width, scaledViewport.height);
    gradient.addColorStop(0, '#f8f9fa');
    gradient.addColorStop(1, '#e9ecef');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, scaledViewport.width, scaledViewport.height);
    
    // White background for PDF content
    ctx.fillStyle = 'white';
    ctx.fillRect(-5, -5, scaledViewport.width + 10, scaledViewport.height + 10);
    
    // Render PDF page to canvas
    const renderContext = {
      canvasContext: ctx,
      viewport: scaledViewport
    };

    await page.render(renderContext).promise;
    logger.info('PDF page rendered successfully');

    // Add border
    ctx.strokeStyle = '#dee2e6';
    ctx.lineWidth = 2;
    ctx.strokeRect(-5, -5, scaledViewport.width + 10, scaledViewport.height + 10);

    // Add subtle shadow
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.strokeRect(-5, -5, scaledViewport.width + 10, scaledViewport.height + 10);
    ctx.shadowColor = 'transparent';

    // Now, to fit into 300x400, create a larger canvas and draw this one centered
    const fullCanvas = createCanvas(300, 400);
    const fullCtx = fullCanvas.getContext('2d');

    // Background for full
    const fullGradient = fullCtx.createLinearGradient(0, 0, 300, 400);
    fullGradient.addColorStop(0, '#f8f9fa');
    fullGradient.addColorStop(1, '#e9ecef');
    fullCtx.fillStyle = fullGradient;
    fullCtx.fillRect(0, 0, 300, 400);

    const xOffset = (300 - scaledViewport.width) / 2;
    const yOffset = (400 - scaledViewport.height) / 2;

    // Draw the rendered content centered
    fullCtx.drawImage(canvasAndContext.canvas, xOffset, yOffset);

    // Cleanup
    canvasFactory.destroy(canvasAndContext);
    page.cleanup();
    pdf.destroy();

    const tmpPath = join(tmpdir(), `pdf-thumb-${Date.now()}.jpg`);
    const buffer = fullCanvas.toBuffer('image/jpeg', { quality: 0.85 });
    await fs.promises.writeFile(tmpPath, buffer);
    
    logger.info(`PDF thumbnail saved to: ${tmpPath}`);
    return tmpPath;

  } catch (error) {
    logger.error('PDF thumbnail generation failed:', {
      message: error.message,
      stack: error.stack,
      filePath: filePath
    });
    
    // Return enhanced fallback thumbnail for PDF
    return await generateEnhancedPDFFallback(filePath);
  }
}

async function generateEnhancedPDFFallback(filePath) {
  const fs = await import("fs");
  const { createCanvas } = await import('canvas');
  
  try {
    let pageCount = 1;
    let fileSize = 'Unknown';
    
    try {
      // Get file stats for size
      const stats = await fs.promises.stat(filePath);
      fileSize = formatFileSize(stats.size);
      
      // Try to get page count without worker
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const dataBuffer = await fs.promises.readFile(filePath);
      const uint8Array = new Uint8Array(dataBuffer);
      const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
      pageCount = pdf.numPages;
    } catch (e) {
      logger.warn('Could not determine PDF details for fallback:', e.message);
    }

    const canvas = createCanvas(300, 400);
    const ctx = canvas.getContext('2d');
    
    // Professional PDF-style background
    const gradient = ctx.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, '#dc3545');
    gradient.addColorStop(1, '#c82333');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 300, 400);

    // Main document card
    ctx.fillStyle = 'white';
    ctx.roundRect(20, 20, 260, 300, 10);
    ctx.fill();
    
    // Card shadow
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.shadowColor = 'transparent';

    // PDF icon
    ctx.fillStyle = '#dc3545';
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('📄', 150, 120);

    // "PDF" text
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('PDF DOCUMENT', 150, 190);

    // Page count
    ctx.fillStyle = '#6c757d';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`${pageCount} Page${pageCount !== 1 ? 's' : ''}`, 150, 220);

    // File size
    ctx.font = '14px Arial';
    ctx.fillText(fileSize, 150, 245);

    // Footer note
    ctx.fillStyle = '#adb5bd';
    ctx.font = '12px Arial';
    ctx.fillText('Preview Generated', 150, 270);

    const tmpPath = join(tmpdir(), `pdf-fallback-${Date.now()}.jpg`);
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    await fs.promises.writeFile(tmpPath, buffer);
    
    return tmpPath;
  } catch (fallbackError) {
    logger.error('Even PDF fallback generation failed:', fallbackError);
    return await generateFallbackThumbnail('pdf');
  }
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function generateDOCXThumbnail(filePath) {
  const { createCanvas } = await import('canvas');
  const fs = await import("fs");

  try {
    // Extract text content from DOCX
    const result = await mammoth.extractRawText({ path: filePath });
    const content = result.value || "Document content";
    
    const canvas = createCanvas(300, 400);
    const ctx = canvas.getContext('2d');
    
    // Professional document background
    const gradient = ctx.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, '#4f6bed');
    gradient.addColorStop(1, '#3b5bdb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 300, 400);
    
    // Document "page"
    ctx.fillStyle = 'white';
    ctx.fillRect(20, 20, 260, 360);
    
    // Document shadow
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, 260, 360);
    ctx.shadowColor = 'transparent';
    
    // Document lines (simulating text)
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('DOCUMENT', 150, 60);
    
    ctx.fillStyle = '#666';
    ctx.font = '12px Arial';
    
    // Sample document content preview
    const lines = content.split('\n').slice(0, 8);
    let yPos = 100;
    
    lines.forEach(line => {
      if (line.trim().length > 0 && yPos < 350) {
        const truncated = line.substring(0, 35) + (line.length > 35 ? '...' : '');
        ctx.fillText(truncated, 40, yPos);
        yPos += 20;
      }
    });
    
    // Document icon
    ctx.fillStyle = '#4f6bed';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('📝', 150, 220);
    
    const tmpPath = join(tmpdir(), `docx-thumb-${Date.now()}.jpg`);
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    await fs.promises.writeFile(tmpPath, buffer);
    
    return tmpPath;
  } catch (error) {
    logger.warn('DOCX thumbnail generation failed, using fallback:', error.message);
    return await generateFallbackThumbnail('docx');
  }
}

async function generatePPTXThumbnail(filePath) {
  const { createCanvas } = await import('canvas');
  const fs = await import("fs");

  try {
    const canvas = createCanvas(300, 400);
    const ctx = canvas.getContext('2d');
    
    // Presentation-style background
    const gradient = ctx.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, '#ff6b6b');
    gradient.addColorStop(1, '#ee5a52');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 300, 400);
    
    // Slide representation
    ctx.fillStyle = 'white';
    ctx.fillRect(30, 30, 240, 300);
    
    // Slide shadow
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = '#ffd8d8';
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, 240, 300);
    ctx.shadowColor = 'transparent';
    
    // Slide content simulation
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PRESENTATION', 150, 80);
    
    // Bullet points
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    
    const bulletPoints = [
      '• Key point one',
      '• Important data',
      '• Summary slide',
      '• Conclusion'
    ];
    
    bulletPoints.forEach((point, index) => {
      ctx.fillText(point, 60, 120 + (index * 30));
    });
    
    // Chart visualization
    ctx.fillStyle = '#4f6bed';
    ctx.fillRect(80, 250, 40, 40);
    ctx.fillStyle = '#ffa726';
    ctx.fillRect(140, 230, 40, 60);
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(200, 210, 40, 80);
    
    // Presentation icon
    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('📊', 150, 350);
    
    const tmpPath = join(tmpdir(), `pptx-thumb-${Date.now()}.jpg`);
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    await fs.promises.writeFile(tmpPath, buffer);
    
    return tmpPath;
  } catch (error) {
    logger.warn('PPTX thumbnail generation failed, using fallback:', error.message);
    return await generateFallbackThumbnail('pptx');
  }
}

async function generateSpreadsheetThumbnail(filePath, fileType) {
  const { createCanvas } = await import('canvas');
  const fs = await import("fs");

  try {
    const canvas = createCanvas(300, 400);
    const ctx = canvas.getContext('2d');
    
    // Spreadsheet-style background
    const gradient = ctx.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, '#20c997');
    gradient.addColorStop(1, '#12b886');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 300, 400);
    
    // Spreadsheet grid
    ctx.fillStyle = 'white';
    ctx.fillRect(20, 20, 260, 300);
    
    // Grid shadow
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle = '#c3fae8';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, 260, 300);
    ctx.shadowColor = 'transparent';
    
    // Draw spreadsheet grid
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 0.5;
    
    // Vertical lines
    for (let x = 20; x <= 280; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, 320);
      ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 20; y <= 320; y += 30) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(280, y);
      ctx.stroke();
    }
    
    // Header row
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(20, 20, 260, 30);
    
    // Header text
    ctx.fillStyle = '#495057';
    ctx.font = 'bold 12px Arial';
    const headers = ['A', 'B', 'C', 'D', 'E', 'F'];
    headers.forEach((header, index) => {
      ctx.fillText(header, 40 + (index * 40), 40);
    });
    
    // Sample data
    ctx.fillStyle = '#666';
    ctx.font = '11px Arial';
    const sampleData = [
      ['Data 1', '123', '45.6', 'Info'],
      ['Value 2', '456', '78.9', 'Text'],
      ['Item 3', '789', '12.3', 'Data']
    ];
    
    sampleData.forEach((row, rowIndex) => {
      row.forEach((cell, cellIndex) => {
        ctx.fillText(cell, 40 + (cellIndex * 40), 75 + (rowIndex * 30));
      });
    });
    
    // Spreadsheet icon
    ctx.fillStyle = '#20c997';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(fileType === 'xlsx' ? '📈' : '📋', 150, 370);
    
    const tmpPath = join(tmpdir(), `${fileType}-thumb-${Date.now()}.jpg`);
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    await fs.promises.writeFile(tmpPath, buffer);
    
    return tmpPath;
  } catch (error) {
    logger.warn('Spreadsheet thumbnail generation failed, using fallback:', error.message);
    return await generateFallbackThumbnail(fileType);
  }
}

async function generateFallbackThumbnail(fileType) {
  try {
    const { createCanvas } = await import('canvas');
    const fs = await import("fs");
    
    const tmpPath = join(tmpdir(), `fallback-thumb-${fileType}-${Date.now()}.jpg`);
    const canvas = createCanvas(300, 400);
    const ctx = canvas.getContext('2d');
    
    // Professional gradient background based on file type
    const gradients = {
      pdf: ['#ff6b6b', '#ee5a52'],
      docx: ['#4f6bed', '#3b5bdb'],
      pptx: ['#ffa726', '#f59f00'],
      xlsx: ['#20c997', '#12b886'],
      csv: ['#20c997', '#12b886'],
      default: ['#6c757d', '#495057']
    };
    
    const gradientColors = gradients[fileType] || gradients.default;
    const gradient = ctx.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, gradientColors[0]);
    gradient.addColorStop(1, gradientColors[1]);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 300, 400);
    
    // File icon container
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(150, 180, 60, 0, Math.PI * 2);
    ctx.fill();
    
    // File icon
    ctx.fillStyle = gradientColors[0];
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    
    const icon = getFileIcon(fileType);
    ctx.fillText(icon, 150, 190);
    
    // File type text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px Arial';
    ctx.fillText(fileType.toUpperCase(), 150, 270);
    
    // Document text
    ctx.font = '14px Arial';
    ctx.fillText('DOCUMENT', 150, 290);
    
    // Subtle border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 280, 380);
    
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    await fs.promises.writeFile(tmpPath, buffer);
    
    return tmpPath;
  } catch (error) {
    logger.error('Fallback thumbnail generation failed:', error);
    return null;
  }
}

function getFileIcon(fileType) {
  const icons = {
    pdf: '📄',
    docx: '📝',
    pptx: '📊',
    xlsx: '📈',
    csv: '📋',
    default: '📁'
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
  const tmpPath = join(tmpdir(), `docsdb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
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
    case "pdf": return await extractFromPDF(filePath);
    case "docx": return await extractFromDOCX(filePath);
    case "pptx": return await extractFromPPTX(filePath);
    case "xlsx": return await extractFromXLSX(filePath);
    case "csv": return await extractFromCSV(filePath);
    default: throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractFromPDF(filePath) {
  try {
    const fs = await import("fs");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const dataBuffer = await fs.promises.readFile(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    let textContent = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      textContent += content.items.map((item) => item.str).join(" ") + "\n\n";
    }
    return textContent.trim();
  } catch (error) {
    logger.error("PDF extraction failed:", error);
    throw new Error(`PDF extraction failed: ${error.message}`);
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
      logger.info('✅ Used Google Gemini for metadata');
      return enrichMetadataWithLocalData(geminiResult, content, fileType, 'gemini');
    }
  } catch (error) {
    logger.warn(`Gemini failed: ${error.message}`);
  }

  try {
    const groqResult = await generateWithGroq(content, filename);
    if (groqResult?.title) {
      logger.info('✅ Used Groq for metadata');
      return enrichMetadataWithLocalData(groqResult, content, fileType, 'groq');
    }
  } catch (error) {
    logger.warn(`Groq failed: ${error.message}`);
  }

  try {
    const hfResult = await generateWithHuggingFace(content, filename);
    if (hfResult?.title) {
      logger.info('✅ Used Hugging Face for metadata');
      return enrichMetadataWithLocalData(hfResult, content, fileType, 'huggingface');
    }
  } catch (error) {
    logger.warn(`Hugging Face failed: ${error.message}`);
  }

  try {
    const ollamaResult = await generateWithOllama(content, filename);
    if (ollamaResult?.title) {
      logger.info('✅ Used Ollama for metadata');
      return enrichMetadataWithLocalData(ollamaResult, content, fileType, 'ollama');
    }
  } catch (error) {
    logger.warn(`Ollama failed: ${error.message}`);
  }

  logger.info('ℹ️ Using smart local processing for metadata');
  return generateUniversalMetadata(content, filename, fileType);
}

async function generateWithGemini(content, filename) {
  if (!geminiAI) throw new Error('Gemini API key not configured');
  
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
      config: { temperature: 0.3, maxOutputTokens: 300 }
    });

    const text = response.text;
    if (!text) throw new Error('No response text from Gemini');

    return parseAIResponse(text);
  } catch (error) {
    throw new Error(`Gemini: ${error.message}`);
  }
}

async function generateWithGroq(content, filename) {
  if (!groq) throw new Error('Groq API key not configured');

  const truncatedContent = content.substring(0, 4000);
  
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You are a document analysis assistant. Return ONLY valid JSON without any formatting or markdown."
        },
        {
          role: "user",
          content: `Analyze this document and return JSON with title, description, tags, category: "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"]
Filename: ${filename}
Content: ${truncatedContent}`
        }
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const contentText = response.choices[0]?.message?.content;
    if (!contentText) throw new Error('No response content from Groq');

    return parseAIResponse(contentText);
  } catch (error) {
    throw new Error(`Groq: ${error.message}`);
  }
}

async function generateWithHuggingFace(content, filename) {
  if (!huggingface) throw new Error('Hugging Face token not configured');

  const truncatedContent = content.substring(0, 2000);
  const prompt = `Analyze document and return JSON: { "title": "...", "description": "...", "tags": [...], "category": "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"] }
Document: ${filename}
Content: ${truncatedContent}`;

  try {
    const result = await huggingface.textGeneration({
      model: "mistralai/Mistral-7B-Instruct-v0.1",
      inputs: prompt,
      parameters: { max_new_tokens: 300, temperature: 0.3 }
    });

    return parseAIResponse(result.generated_text);
  } catch (error) {
    throw new Error(`Hugging Face: ${error.message}`);
  }
}

async function generateWithOllama(content, filename) {
  const truncatedContent = content.substring(0, 2000);
  
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama2',
        prompt: `Return JSON: { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3"], "category": "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"] }
Document: ${filename}
Content: ${truncatedContent}`,
        stream: false,
        format: 'json',
        options: { temperature: 0.3 }
      })
    });

    if (!response.ok) throw new Error('Ollama not running');
    const result = await response.json();
    
    return parseAIResponse(result.response);
  } catch (error) {
    throw new Error(`Ollama: ${error.message}`);
  }
}

function parseAIResponse(text) {
  if (!text) throw new Error('Empty response');
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');
  
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.title || !parsed.description) {
      throw new Error('Missing required fields in JSON');
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
    processedAt: new Date().toISOString()
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
      return words.length >= 2 && words.length <= 12 && !line.match(/page|\d{1,2}\/\d{1,2}|chapter|section/i);
    });
    if (potentialTitles.length > 0) return potentialTitles[0].trim().substring(0, 80);
  }

  const lines = content.split("\n");
  const titleCandidates = lines.map((line) => {
    const words = line.trim().split(/\s+/);
    const capitalRatio = words.filter(word => word.length > 0 && word[0] === word[0].toUpperCase()).length / Math.max(1, words.length);
    return { line: line.trim(), score: capitalRatio, length: words.length };
  }).filter(candidate => candidate.score > 0.6 && candidate.length >= 2 && candidate.length <= 10)
    .sort((a, b) => b.score - a.score);

  if (titleCandidates.length > 0) return titleCandidates[0].line.substring(0, 80);

  const sentences = content.split(/[.!?]+/);
  const firstMeaningful = sentences.find((s) => {
    const trimmed = s.trim();
    return trimmed.length > 10 && trimmed.length < 120 && !trimmed.match(/^\s*(abstract|introduction|table of contents)/i);
  });

  return firstMeaningful ? firstMeaningful.trim().substring(0, 80) : cleanFilename || "Untitled Document";
}

function generateUniversalDescription(content, fileType) {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 50);
  if (paragraphs.length > 0) {
    const bestParagraph = paragraphs.reduce((best, current) => {
      const words = current.toLowerCase().split(/\s+/);
      const uniqueWords = new Set(words);
      const diversity = uniqueWords.size / words.length;
      const lengthScore = 1 - Math.abs(0.7 - words.length / 200);
      return diversity * lengthScore > best.score ? { text: current, score: diversity * lengthScore } : best;
    }, { text: paragraphs[0], score: 0 });
    return bestParagraph.text.substring(0, 250).trim() + "...";
  }

  if (content.length < 500) return content.substring(0, 200) + (content.length > 200 ? "..." : "");

  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const keySentences = sentences.slice(0, 3).map((s) => s.trim()).filter((s) => s.length > 0);
  return keySentences.join(". ") + ".";
}

function extractUniversalTags(content, title, fileType) {
  const allText = (content + " " + title).toLowerCase();
  const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "as", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "this", "that", "these", "those", "them", "then", "than", "from", "into", "using", "based", "within", "between", "through", "during", "before", "after", "above", "below", "upon", "about", "against", "among", "since", "until"]);
  
  const words = allText.split(/\s+/).filter((word) => word.length > 3 && !stopWords.has(word.toLowerCase()));
  const wordScores = {};
  words.forEach((word) => {
    const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleanWord.length > 3) wordScores[cleanWord] = (wordScores[cleanWord] || 0) + 1;
  });

  const titleWords = new Set(title.toLowerCase().split(/\s+/));
  Object.keys(wordScores).forEach((word) => { if (titleWords.has(word)) wordScores[word] *= 3; });

  const phrases = {};
  const sentences = content.toLowerCase().split(/[.!?]+/);
  sentences.forEach((sentence) => {
    const sentenceWords = sentence.trim().split(/\s+/).filter((w) => w.length > 2);
    for (let i = 0; i < sentenceWords.length - 1; i++) {
      const phrase2 = `${sentenceWords[i]} ${sentenceWords[i + 1]}`;
      if (!stopWords.has(sentenceWords[i]) && !stopWords.has(sentenceWords[i + 1])) phrases[phrase2] = (phrases[phrase2] || 0) + 1;
      if (i < sentenceWords.length - 2) {
        const phrase3 = `${sentenceWords[i]} ${sentenceWords[i + 1]} ${sentenceWords[i + 2]}`;
        if (!stopWords.has(sentenceWords[i + 2])) phrases[phrase3] = (phrases[phrase3] || 0) + 1;
      }
    }
  });

  const allTerms = { ...wordScores };
  Object.entries(phrases).forEach(([phrase, count]) => { if (count > 1) allTerms[phrase] = count * 2; });

  return Object.entries(allTerms).sort(([, a], [, b]) => b - a).slice(0, 12).map(([term]) => term).filter((term) => term && term.length > 0);
}

function detectUniversalCategory(content, fileType) {
  const categories = {
    technology: { keywords: ["tech", "innovation", "gadget", "software", "hardware", "AI", "computer", "internet", "digital", "future"], weight: 2 },
    business: { keywords: ["company", "startup", "entrepreneur", "management", "strategy", "leadership", "economy", "commerce", "industry", "executive"], weight: 2 },
    education: { keywords: ["learn", "teach", "school", "college", "student", "teacher", "curriculum", "classroom", "degree", "skill"], weight: 2 },
    health: { keywords: ["wellness", "fitness", "nutrition", "diet", "exercise", "mental", "physical", "doctor", "therapy", "wellbeing"], weight: 2 },
    science: { keywords: ["science", "discovery", "experiment", "theory", "research", "lab", "scientist", "fact", "universe", "knowledge"], weight: 2 },
  };

  const contentLower = content.toLowerCase();
  let bestCategory = "other";
  let maxScore = 0;

  for (const [category, config] of Object.entries(categories)) {
    let score = 0;
    config.keywords.forEach((keyword) => {
      if (contentLower.includes(keyword)) {
        score += config.weight;
        const occurrences = (contentLower.match(new RegExp(keyword, "g")) || []).length;
        if (occurrences > 1) score += (occurrences - 1) * 0.5;
      }
    });
    if (score > maxScore) { maxScore = score; bestCategory = category; }
  }
  return bestCategory;
}

function extractUniversalThemes(content) {
  const sentences = content.toLowerCase().split(/[.!?]+/);
  const themeCandidates = {};
  sentences.forEach((sentence) => {
    const words = sentence.trim().split(/\s+/).filter((w) => w.length > 3);
    for (let i = 0; i < words.length - 1; i++) {
      const phrase2 = `${words[i]} ${words[i + 1]}`;
      themeCandidates[phrase2] = (themeCandidates[phrase2] || 0) + 1;
      if (i < words.length - 2) {
        const phrase3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        themeCandidates[phrase3] = (themeCandidates[phrase3] || 0) + 1;
      }
    }
  });
  return Object.entries(themeCandidates).filter(([, count]) => count > 1).sort(([, a], [, b]) => b - a).slice(0, 8).map(([theme]) => theme);
}

function generateUniversalSummary(content, fileType) {
  if (content.length < 300) return content;
  const sentences = content.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10);
  const scoredSentences = sentences.map((sentence, index) => {
    let score = 0;
    if (index < 3) score += 2;
    if (index < sentences.length / 2) score += 1;
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 8 && wordCount <= 25) score += 2;
    const importantWords = ["conclusion", "summary", "important", "key", "primary", "main", "essential"];
    importantWords.forEach((word) => { if (sentence.toLowerCase().includes(word)) score += 2; });
    return { sentence, score, index };
  });
  const topSentences = scoredSentences.sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.index - b.index).map((s) => s.sentence);
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
    const matches = words.filter((word) => contentLower.includes(" " + word + " ") || contentLower.startsWith(word + " ") || contentLower.endsWith(" " + word)).length;
    if (matches > maxMatches) { maxMatches = matches; bestLang = lang; }
  }
  return bestLang;
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
  const embeddingId = `local-${Buffer.from(JSON.stringify(embeddingData)).toString("base64").substring(0, 32)}`;
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
    logger.warn(`Could not clean up temporary file ${filePath}:`, error.message);
  }
}
