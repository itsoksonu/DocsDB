import Queue from "bull";
import Redis from "ioredis";
import Document from "../models/Document.js";
import { processDocument } from "../utils/documentProcessor.js";
import logger from "../utils/logger.js";

const redisConfig = {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
  },
};

import { getSocketIO } from "../utils/socket.js";

export const processDocumentQueue = new Queue(
  "document processing",
  redisConfig
);

export const PROCESS_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  // The job record is removed once it settles, which frees the stable jobId
  // below for the next retry. Status and processingError live on the Document,
  // so nothing useful is lost with the job record.
  removeOnComplete: true,
  removeOnFail: true,
};

/**
 * Single place that knows how a document gets queued, so the upload flow and
 * the manual reprocess flow can never drift apart on retry settings.
 *
 * The stable jobId makes enqueueing idempotent while a job for this document is
 * still live: a double-clicked retry cannot start two workers on the same file.
 */
export function enqueueProcessing(documentId, s3Key) {
  return processDocumentQueue.add(
    "process-document",
    { documentId: String(documentId), s3Key },
    { ...PROCESS_JOB_OPTIONS, jobId: `process-${documentId}` }
  );
}

processDocumentQueue.process("process-document", async (job) => {
  const { documentId, s3Key } = job.data;

  // attemptsMade is 0 on the first run, so the last attempt is the one where
  // attemptsMade has reached attempts - 1.
  const maxAttempts = job.opts?.attempts || 1;
  const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

  logger.info(
    `Starting processing for document: ${documentId} (attempt ${
      job.attemptsMade + 1
    }/${maxAttempts})`
  );

  try {
    await processDocument(
      documentId,
      s3Key,
      (progress) => {
        try {
          const io = getSocketIO();
          io.to(`document_${documentId}`).emit("processing-progress", {
            documentId,
            ...progress,
          });
        } catch (err) {
          logger.warn("Failed to emit progress socket event:", err);
        }
      },
      { isFinalAttempt }
    );

    // Emit final success event
    try {
      const io = getSocketIO();
      io.to(`document_${documentId}`).emit("processing-progress", {
        documentId,
        step: "completed",
        message: "Processing complete!",
        completed: true,
      });
    } catch (err) {
      logger.warn("Failed to emit completion socket event:", err);
    }

    logger.info(`Successfully processed document: ${documentId}`);

    return { success: true, documentId };
  } catch (error) {
    logger.error(`Failed to process document ${documentId}:`, error);

    if (isFinalAttempt) {
      // processDocument already persisted the failure; this is the belt to its
      // braces for the case where it threw before reaching its own catch.
      await Document.findByIdAndUpdate(documentId, {
        status: "failed",
        processingError: error.message,
      });

      try {
        const io = getSocketIO();
        io.to(`document_${documentId}`).emit("processing-progress", {
          documentId,
          step: "failed",
          message: error.message,
          failed: true,
        });
      } catch (err) {
        logger.warn("Failed to emit failure socket event:", err);
      }
    }

    throw error;
  }
});

// Automated Document Fetcher job. Searches external open-access sources,
// downloads documents, and enqueues each as a normal "process-document" job.
// fetchDocuments is imported dynamically to avoid a circular import
// (fetcher.js depends on processDocumentQueue exported from this file).
processDocumentQueue.process("fetch-documents", async (job) => {
  const { category, count, requestedBy } = job.data;

  logger.info(
    `Starting fetch job ${job.id}: category="${category}" count=${count}`
  );

  try {
    const { fetchDocuments, resolveOwnerId } = await import(
      "../utils/documentFetcher/fetcher.js"
    );

    const userId = await resolveOwnerId(requestedBy);
    if (!userId) {
      throw new Error(
        "No owner user for fetched documents — set FETCHER_SYSTEM_USER_ID or create an admin user"
      );
    }

    const { documents } = await fetchDocuments({
      category,
      count,
      userId,
      onProgress: (progress) => {
        // Surface progress to Bull so GET /fetch-docs/:jobId can report it.
        job.progress(progress);
      },
    });

    logger.info(
      `Fetch job ${job.id} complete: ingested ${documents.length}/${count}`
    );

    return {
      success: true,
      category,
      requested: count,
      ingested: documents.length,
      documents: documents.map((d) => ({
        documentId: d.documentId,
        source: d.source,
        title: d.sourceMetadata?.title,
        url: d.originalUrl,
        license: d.sourceMetadata?.license,
        sizeMB: d.sizeMB,
      })),
    };
  } catch (error) {
    logger.error(`Fetch job ${job.id} failed:`, error);
    throw error;
  }
});

// Event handlers
processDocumentQueue.on("completed", (job, result) => {
  logger.info(`Job ${job.id} completed for document ${result.documentId}`);
});

processDocumentQueue.on("failed", (job, error) => {
  logger.error(`Job ${job.id} failed:`, error);
});

processDocumentQueue.on("stalled", (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

export default processDocumentQueue;
