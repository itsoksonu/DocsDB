import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand 
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger.js';

class S3Manager {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    this.bucketName = process.env.S3_BUCKET_NAME;
  }

  async generatePresignedUrl(key, fileType, fileSize) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: fileType,
        ContentLength: fileSize,
        Metadata: {
          uploadedAt: new Date().toISOString()
        }
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    } catch (error) {
      logger.error('Error generating presigned URL:', error);
      throw error;
    }
  }

  async generateDownloadUrl(key, filename, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      logger.error('Error generating download URL:', error);
      throw error;
    }
  }

  async generateViewUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });
    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getObjectMetadata(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      const metadata = await this.s3Client.send(command);
      return metadata;
    } catch (error) {
      logger.error('Error fetching S3 object metadata:', error);
      throw error;
    }
  }

  async deleteObject(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      await this.s3Client.send(command);
      logger.info(`Successfully deleted S3 object: ${key}`);
    } catch (error) {
      logger.error('Error deleting S3 object:', error);
      throw error;
    }
  }

  async uploadObject(key, body, contentType) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType
      });

      const result = await this.s3Client.send(command);
      logger.info(`Successfully uploaded S3 object: ${key}`);
      return result;
    } catch (error) {
      logger.error('Error uploading S3 object:', error);
      throw error;
    }
  }

  async getObject(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      const result = await this.s3Client.send(command);
      return result;
    } catch (error) {
      logger.error('Error getting S3 object:', error);
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

  generateFileKey(userId, originalFilename) {
    const extension = originalFilename.split('.').pop();
    const timestamp = Date.now();
    const uniqueId = uuidv4();

    return `uploads/${userId}/${timestamp}-${uniqueId}.${extension}`;
  }

  // Validate file type
  isValidFileType(mimeType, originalFilename) {
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [];
    const extension = originalFilename.split('.').pop().toLowerCase();

    const typeMap = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'csv': 'text/csv'
    };

    return allowedTypes.includes(extension) && 
           (!mimeType || mimeType === typeMap[extension]);
  }

  // Validate file size
  isValidFileSize(sizeBytes) {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 104857600; // 100MB
    return sizeBytes <= maxSize;
  }
}

export default new S3Manager();