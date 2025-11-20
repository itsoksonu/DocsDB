import express from 'express';
import { body, validationResult } from 'express-validator';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import S3Manager from '../../shared/utils/s3.js';
import Document from '../../shared/models/Document.js';
import { processDocumentQueue } from '../../shared/queues/processQueue.js';

const router = express.Router();

// Generate presigned URL for direct S3 upload
router.post('/presign', 
  authMiddleware,
  rateLimitMiddleware('upload'),
  [
    body('fileName').notEmpty().trim().escape(),
    body('fileType').notEmpty(),
    body('fileSize').isInt({ min: 1, max: 104857600 }) // 100MB max
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { fileName, fileType, fileSize } = req.body;
      const userId = req.user.userId;

      if (!S3Manager.isValidFileType(fileType, fileName)) {
        return res.status(400).json({
          success: false,
          message: 'File type not allowed. Allowed types: PDF, DOCX, PPTX, XLSX, CSV'
        });
      }

      if (!S3Manager.isValidFileSize(fileSize)) {
        return res.status(400).json({
          success: false,
          message: 'File size exceeds maximum allowed size (100MB)'
        });
      }

      const s3Key = S3Manager.generateFileKey(userId, fileName);

      const presignedUrl = await S3Manager.generatePresignedUrl(s3Key, fileType, fileSize);

      const document = new Document({
        userId,
        originalFilename: fileName,
        s3Path: s3Key,
        fileType: fileName.split('.').pop().toLowerCase(),
        sizeBytes: fileSize,
        status: 'uploaded'
      });

      await document.save();

      res.json({
        success: true,
        data: {
          uploadUrl: presignedUrl,
          documentId: document._id,
          key: s3Key,
          expiresIn: 3600
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Complete upload and start processing
router.post('/complete',
  authMiddleware,
  [
    body('documentId').isMongoId(),
    body('key').notEmpty()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { documentId, key } = req.body;
      const userId = req.user.userId;

      const document = await Document.findOne({
        _id: documentId,
        userId
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found'
        });
      }

      if (document.s3Path !== key) {
        return res.status(400).json({
          success: false,
          message: 'Invalid document key'
        });
      }

      document.status = 'processing';
      await document.save();

      await processDocumentQueue.add('process-document', {
        documentId: document._id.toString(),
        s3Key: key
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      });

      res.json({
        success: true,
        message: 'Upload completed. Document is being processed.',
        data: {
          documentId: document._id,
          status: 'processing'
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get upload status
router.get('/status/:documentId',
  authMiddleware,
  async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.userId;

      const document = await Document.findOne({
        _id: documentId,
        userId
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found'
        });
      }

      res.json({
        success: true,
        data: {
          status: document.status,
          processingError: document.processingError,
          generatedTitle: document.generatedTitle,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

export default router;