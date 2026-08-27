// Automated Document Fetcher — admin API.
// Mounted under /api/v1/admin (see server.js), so the effective paths are:
//   POST /api/v1/admin/fetch-docs
//   GET  /api/v1/admin/fetch-docs/:jobId
import express from "express";
import { body, param, validationResult } from "express-validator";
import crypto from "crypto";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Document from "../../shared/models/Document.js";
import {
  processDocumentQueue,
  FETCH_JOB_OPTIONS,
} from "../../shared/queues/processQueue.js";
import logger from "../../shared/utils/logger.js";

const router = express.Router();

// Valid category values, sourced directly from the Document schema enum so the
// two never drift apart.
const VALID_CATEGORIES = Document.schema.path("category").enumValues;

// POST /fetch-docs — queue a fetch job.
router.post(
  "/fetch-docs",
  authMiddleware,
  requireRole(["admin"]),
  [
    body("category")
      .isString()
      .custom((v) => VALID_CATEGORIES.includes(v))
      .withMessage("Invalid category"),
    body("count").isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { category, count } = req.body;
      const jobId = crypto.randomUUID();

      await processDocumentQueue.add(
        "fetch-documents",
        { category, count, requestedBy: req.user.userId },
        { ...FETCH_JOB_OPTIONS, jobId }
      );

      logger.info(
        `Fetch job queued: id=${jobId} category="${category}" count=${count} by=${req.user.userId}`
      );

      res.json({
        success: true,
        jobId,
        message: "Fetch job queued",
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /fetch-docs/:jobId — poll job status/progress/result.
router.get(
  "/fetch-docs/:jobId",
  authMiddleware,
  requireRole(["admin"]),
  [param("jobId").isString().notEmpty()],
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const job = await processDocumentQueue.getJob(jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Job not found",
        });
      }

      const status = await job.getState();

      res.json({
        success: true,
        jobId,
        status,
        progress: job.progress() || null,
        result: job.returnvalue || null,
        failReason: job.failedReason || null,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
