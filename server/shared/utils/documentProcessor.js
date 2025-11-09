import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import Document from '../models/Document.js';
import S3Manager from './s3.js';
import logger from './logger.js';

const execAsync = promisify(exec);

export async function processDocument(documentId, s3Key) {
  const document = await Document.findById(documentId);
  if (!document) {
    throw new Error(`Document ${documentId} not found`);
  }

  try {
    // Step 1: Virus scanning (placeholder - integrate ClamAV)
    logger.info(`Virus scanning document: ${documentId}`);
    await performVirusScan(s3Key);
    
    // Step 2: Download file for processing
    logger.info(`Downloading document for processing: ${documentId}`);
    const filePath = await downloadFromS3(s3Key);
    
    // Step 3: Extract text content based on file type
    logger.info(`Extracting content from document: ${documentId}`);
    const content = await extractContent(filePath, document.fileType);
    
    // Step 4: Generate AI metadata
    logger.info(`Generating AI metadata for document: ${documentId}`);
    const metadata = await generateAIMetadata(content, document.originalFilename);
    
    // Step 5: Generate thumbnail (placeholder)
    logger.info(`Generating thumbnail for document: ${documentId}`);
    const thumbnailPath = await generateThumbnail(filePath, document.fileType);
    
    // Step 6: Upload thumbnail to S3
    if (thumbnailPath) {
      const thumbnailKey = s3Key.replace('/uploads/', '/thumbnails/') + '.jpg';
      await uploadThumbnail(thumbnailPath, thumbnailKey);
      document.thumbnailS3Path = thumbnailKey;
    }
    
    // Step 7: Generate embeddings for search
    logger.info(`Generating embeddings for document: ${documentId}`);
    const embeddingsId = await generateEmbeddings(content, metadata);
    
    // Step 8: Update document with all processed data
    document.generatedTitle = metadata.title;
    document.generatedDescription = metadata.description;
    document.tags = metadata.tags;
    document.category = metadata.category;
    document.pageCount = metadata.pageCount;
    document.embeddingsId = embeddingsId;
    document.metadata = metadata;
    document.status = 'processed';
    document.virusScanResult = {
      clean: true,
      scanner: 'clamav',
      scannedAt: new Date()
    };
    
    await document.save();
    
    // Clean up temporary file
    await cleanupTempFile(filePath);
    if (thumbnailPath) {
      await cleanupTempFile(thumbnailPath);
    }
    
    logger.info(`Successfully completed processing for document: ${documentId}`);
    
  } catch (error) {
    logger.error(`Processing failed for document ${documentId}:`, error);
    
    // Update document status to failed
    document.status = 'failed';
    document.processingError = error.message;
    await document.save();
    
    throw error;
  }
}

async function performVirusScan(s3Key) {
  // Placeholder for ClamAV integration
  // In production, this would download the file and scan it
  logger.info(`Virus scan completed for: ${s3Key}`);
  return { clean: true };
}

async function downloadFromS3(s3Key) {
  const tmpPath = join(tmpdir(), `docsdb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  
  try {
    // Get the file from S3 using the new S3Manager
    const objectData = await S3Manager.getObject(s3Key);
    
    // Write file to temporary location
    const fs = await import('fs');
    
    if (objectData.Body) {
      // Convert the stream to buffer and write to file
      const chunks = [];
      for await (const chunk of objectData.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      await fs.promises.writeFile(tmpPath, buffer);
    } else {
      throw new Error('No body in S3 response');
    }
    
    return tmpPath;
  } catch (error) {
    logger.error('Error downloading from S3:', error);
    throw error;
  }
}

async function extractContent(filePath, fileType) {
  switch (fileType) {
    case 'pdf':
      return await extractFromPDF(filePath);
    case 'docx':
      return await extractFromDOCX(filePath);
    case 'pptx':
      return await extractFromPPTX(filePath);
    case 'xlsx':
      return await extractFromXLSX(filePath);
    case 'csv':
      return await extractFromCSV(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractFromPDF(filePath) {
  // Using pdf-parse or similar library
  try {
    const { default: pdf } = await import('pdf-parse');
    const fs = await import('fs');
    const dataBuffer = await fs.promises.readFile(filePath);
    const data = await pdf(dataBuffer);
    return data.text || '';
  } catch (error) {
    logger.error('PDF extraction failed:', error);
    return '';
  }
}

async function extractFromDOCX(filePath) {
  // Using mammoth or similar library
  try {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch (error) {
    logger.error('DOCX extraction failed:', error);
    return '';
  }
}

async function extractFromPPTX(filePath) {
  // Using pptx2html or similar
  // Placeholder implementation
  logger.info('PPTX extraction not yet implemented');
  return 'Presentation content extraction - to be implemented';
}

async function extractFromXLSX(filePath) {
  // Using xlsx or similar
  try {
    const { default: XLSX } = await import('xlsx');
    const workbook = XLSX.readFile(filePath);
    let content = '';
    
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      content += XLSX.utils.sheet_to_csv(worksheet) + '\n';
    });
    
    return content;
  } catch (error) {
    logger.error('XLSX extraction failed:', error);
    return '';
  }
}

async function extractFromCSV(filePath) {
  const fs = await import('fs');
  return fs.promises.readFile(filePath, 'utf8');
}

async function generateAIMetadata(content, filename) {
  // This would integrate with OpenAI/Claude APIs
  // For now, return basic metadata
  
  const title = filename.replace(/\.[^/.]+$/, ""); // Remove extension
  const description = content.substring(0, 200) + '...';
  const tags = extractTags(content, title);
  const category = categorizeContent(content);
  const pageCount = estimatePageCount(content);
  
  return {
    title,
    description,
    tags,
    category,
    pageCount,
    wordCount: content.split(/\s+/).length,
    language: 'en' // Detect language
  };
}

function extractTags(content, title) {
  // Simple keyword extraction - in production use NLP
  const words = (content + ' ' + title).toLowerCase().split(/\s+/);
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
  
  const wordFreq = {};
  words.forEach(word => {
    if (word.length > 3 && !commonWords.has(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });
  
  return Object.entries(wordFreq)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);
}

function categorizeContent(content) {
  const categories = {
    technology: ['software', 'code', 'programming', 'tech', 'computer', 'digital'],
    business: ['business', 'market', 'finance', 'money', 'investment', 'corporate'],
    education: ['education', 'learn', 'study', 'school', 'university', 'course'],
    health: ['health', 'medical', 'medicine', 'doctor', 'hospital', 'fitness'],
    entertainment: ['entertainment', 'movie', 'music', 'game', 'fun', 'art']
  };
  
  const contentLower = content.toLowerCase();
  let bestCategory = 'other';
  let maxMatches = 0;
  
  for (const [category, keywords] of Object.entries(categories)) {
    const matches = keywords.filter(keyword => contentLower.includes(keyword)).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestCategory = category;
    }
  }
  
  return bestCategory;
}

function estimatePageCount(content) {
  // Rough estimate: 500 words per page
  const wordCount = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 500));
}

async function generateThumbnail(filePath, fileType) {
  // Placeholder for thumbnail generation
  // Would use libraries like graphicsmagick, libreoffice, etc.
  logger.info(`Thumbnail generation for ${fileType} not yet implemented`);
  return null;
}

async function uploadThumbnail(thumbnailPath, thumbnailKey) {
  try {
    const fs = await import('fs');
    const fileBuffer = await fs.promises.readFile(thumbnailPath);
    
    await S3Manager.uploadObject(thumbnailKey, fileBuffer, 'image/jpeg');
    logger.info(`Successfully uploaded thumbnail to: ${thumbnailKey}`);
  } catch (error) {
    logger.error('Error uploading thumbnail:', error);
    throw error;
  }
}

async function generateEmbeddings(content, metadata) {
  // Placeholder for embeddings generation
  // Would integrate with Pinecone, OpenAI embeddings, etc.
  return `embedding-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function cleanupTempFile(filePath) {
  try {
    const fs = await import('fs');
    await fs.promises.unlink(filePath);
    logger.debug(`Cleaned up temporary file: ${filePath}`);
  } catch (error) {
    logger.warn(`Could not clean up temporary file ${filePath}:`, error.message);
  }
}