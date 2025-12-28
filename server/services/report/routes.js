import express from "express";
import { body, param, validationResult } from "express-validator";
import { authMiddleware } from "../middleware/auth.js";
import Report from "../../shared/models/Report.js";
import Document from "../../shared/models/Document.js";
import logger from "../../shared/utils/logger.js";

const router = express.Router();

/**
 * @route   POST /api/v1/report
 * @desc    Create a new report
 * @access  Private
 */
router.post(
  "/",
  authMiddleware,
  [
    body("documentId")
      .optional()
      .isMongoId()
      .withMessage("Invalid document ID"),
    body("reason")
      .trim()
      .notEmpty()
      .withMessage("Reason is required")
      .isLength({ max: 1000 })
      .withMessage("Reason must be less than 1000 characters"),
    body("type")
      .isIn([
        "copyright",
        "spam",
        "inappropriate",
        "harassment",
        "fraud",
        "bug",
        "other",
      ])
      .withMessage("Invalid report type"),
    body("category")
      .optional()
      .isIn(["upload", "user", "content", "dmca", "system"]),
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

      const { documentId, reason, type, category } = req.body;
      const reporterId = req.user.userId;

      // Validate: If not system category, documentId is likely required?
      // Or if documentId is provided, verify it.

      let targetUserId = null;

      if (documentId) {
        // Verify document exists
        const document = await Document.findById(documentId);
        if (!document) {
          return res.status(404).json({
            success: false,
            message: "Document not found",
          });
        }
        targetUserId = document.userId;

        // Check if user already reported this document recently
        const existingReport = await Report.findOne({
          reporterId,
          documentId,
          status: { $in: ["pending", "under_review", "escalated"] },
        });

        if (existingReport) {
          return res.status(409).json({
            success: false,
            message:
              "You have already reported this document. Your report is currently being reviewed.",
          });
        }
      }

      const report = new Report({
        reporterId,
        documentId: documentId || undefined,
        targetUserId: targetUserId || undefined,
        type, // 'other' for bugs
        category: category || (documentId ? "content" : "system"),
        reason,
        status: "pending",
        reporterIp: req.ip,
        reporterUserAgent: req.get("User-Agent"),
      });

      await report.save();

      logger.info(
        `New report created: ${report._id} by user ${reporterId} ${
          documentId ? `for document ${documentId}` : "type: system"
        }`
      );

      res.status(201).json({
        success: true,
        message: "Report submitted successfully. We will review it shortly.",
        data: {
          reportId: report._id,
        },
      });
    } catch (error) {
      logger.error("Error creating report:", error);
      next(error);
    }
  }
);

/**
 * @route   GET /api/v1/report/check/:documentId
 * @desc    Check if user has an active report for a document
 * @access  Private
 */
router.get(
  "/check/:documentId",
  authMiddleware,
  [param("documentId").isMongoId().withMessage("Invalid document ID")],
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

      const { documentId } = req.params;
      const reporterId = req.user.userId;

      const existingReport = await Report.findOne({
        reporterId,
        documentId,
        status: { $in: ["pending", "under_review", "escalated"] },
      });

      res.json({
        success: true,
        data: {
          hasActiveReport: !!existingReport,
          report: existingReport
            ? {
                status: existingReport.status,
                createdAt: existingReport.createdAt,
                type: existingReport.type,
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
