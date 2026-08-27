import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import logger from "./logger.js";

export function sanitizeFilename(filename) {
  const safe = String(filename || "download").replace(/[^\w.-]+/g, "_");
  return safe.slice(0, 200) || "download";
}

// Object-key extensions are taken from client-supplied filenames, so bound them
// to a plain alphanumeric extension: `x.tar/../../secret` would otherwise put
// `../` into the key, which becomes real path traversal in any worker that maps
// the key onto a local temp path.
export function safeExtension(originalFilename) {
  const ext = String(originalFilename || "")
    .split(".")
    .pop()
    .toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

class S3Manager {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.bucketName = process.env.S3_BUCKET_NAME;
  }

  async checkConnection() {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.bucketName,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      logger.error("S3 connection check failed:", error);
      return false;
    }
  }

  async generatePresignedUrl(key, fileType, fileSize) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: fileType,
        ContentLength: fileSize,
        Metadata: {
          uploadedAt: new Date().toISOString(),
        },
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    } catch (error) {
      logger.error("Error generating presigned URL:", error);
      throw error;
    }
  }

  async generateDownloadUrl(key, filename, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        // originalFilename is user-supplied. An embedded quote would break out
        // of the quoted-string and inject extra Content-Disposition parameters
        // into the response S3 emits, so keep it to a safe character set.
        ResponseContentDisposition: `attachment; filename="${sanitizeFilename(
          filename
        )}"`,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      logger.error("Error generating download URL:", error);
      throw error;
    }
  }

  async generateViewUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getObjectMetadata(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const metadata = await this.s3Client.send(command);
      return metadata;
    } catch (error) {
      logger.error("Error fetching S3 object metadata:", error);
      throw error;
    }
  }

  // A missing object is an expected answer here, not an error, so this returns
  // a boolean instead of throwing the way getObjectMetadata does.
  async objectExists(key) {
    if (!key) return false;

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );
      return true;
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      // Anything else (permissions, network) is not proof of absence - assume
      // the object is there and let the worker report the real problem.
      logger.error(`Could not check S3 object ${key}:`, error);
      return true;
    }
  }

  async deleteObject(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      logger.info(`Successfully deleted S3 object: ${key}`);
    } catch (error) {
      logger.error("Error deleting S3 object:", error);
      throw error;
    }
  }

  async uploadObject(key, body, contentType) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      });

      const result = await this.s3Client.send(command);
      logger.info(`Successfully uploaded S3 object: ${key}`);
      return result;
    } catch (error) {
      logger.error("Error uploading S3 object:", error);
      throw error;
    }
  }

  async getObject(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const result = await this.s3Client.send(command);
      return result;
    } catch (error) {
      logger.error("Error getting S3 object:", error);
      throw error;
    }
  }

  async getObjectBuffer(key) {
    try {
      const data = await this.getObject(key);

      if (!data || !data.Body) {
        throw new Error("S3: No Body returned for key " + key);
      }

      if (Buffer.isBuffer(data.Body)) {
        return data.Body;
      }

      const chunks = [];
      for await (const chunk of data.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (error) {
      logger.error("Error in getObjectBuffer:", error);
      throw error;
    }
  }

  generateFileKey(userId, originalFilename, prefix = "uploads") {
    const extension = safeExtension(originalFilename);
    const timestamp = Date.now();
    const uniqueId = crypto.randomUUID();

    return `${prefix}/${userId}/${timestamp}-${uniqueId}.${extension}`;
  }

  // Validate file type
  isValidFileType(mimeType, originalFilename, type = "document") {
    let allowedTypes;

    if (type === "avatar") {
      allowedTypes = ["jpg", "jpeg", "png", "webp"];
    } else {
      allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(",") || [];
    }

    const extension = originalFilename.split(".").pop().toLowerCase();

    const typeMap = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };

    return (
      allowedTypes.includes(extension) &&
      (!mimeType || mimeType === typeMap[extension])
    );
  }

  // Validate file size
  isValidFileSize(sizeBytes) {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 104857600; // 100MB
    return sizeBytes <= maxSize;
  }
}

export default new S3Manager();
