import Queue from 'bull';
import Redis from 'ioredis';
import Document from '../models/Document.js';
import { processDocument } from '../utils/documentProcessor.js';
import logger from '../utils/logger.js';

const redisConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  }
};

export const processDocumentQueue = new Queue('document processing', redisConfig);

processDocumentQueue.process('process-document', async (job) => {
  const { documentId, s3Key } = job.data;
  
  logger.info(`Starting processing for document: ${documentId}`);
  
  try {
    await processDocument(documentId, s3Key);
    logger.info(`Successfully processed document: ${documentId}`);
    
    return { success: true, documentId };
  } catch (error) {
    logger.error(`Failed to process document ${documentId}:`, error);
    
    await Document.findByIdAndUpdate(documentId, {
      status: 'failed',
      processingError: error.message
    });
    
    throw error; 
  }
});

// Event handlers
processDocumentQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed for document ${result.documentId}`);
});

processDocumentQueue.on('failed', (job, error) => {
  logger.error(`Job ${job.id} failed:`, error);
});

processDocumentQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

export default processDocumentQueue;