import mongoose from "mongoose";
import { createClient } from "redis";
import logger from "../utils/logger.js";

class DatabaseManager {
  constructor() {
    this.mongoConnection = null;
    this.redisClient = null;
  }

  async connectMongo() {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      this.mongoConnection = conn;
      logger.info(`MongoDB Connected: ${conn.connection.host}`);

      return conn;
    } catch (error) {
      logger.error("MongoDB connection error:", error);
      process.exit(1);
    }
  }

  async connectRedis() {
    try {
      this.redisClient = createClient({
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
      });

      this.redisClient.on("error", (err) => {
        logger.error("Redis Client Error:", err);
      });

      await this.redisClient.connect();
      logger.info("Redis Connected successfully");

      return this.redisClient;
    } catch (error) {
      logger.error("Redis connection error:", error);
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      if (this.mongoConnection) {
        await mongoose.disconnect();
      }
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      logger.info("Database connections closed");
    } catch (error) {
      logger.error("Error disconnecting databases:", error);
    }
  }

  getMongoConnection() {
    return this.mongoConnection;
  }

  getRedisClient() {
    return this.redisClient;
  }
}

export default new DatabaseManager();
