import { Server } from "socket.io";
import logger from "./logger.js";

let io = null;

export const initSocket = (httpServer, corsOptions) => {
  io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
  });

  io.on("connection", (socket) => {
    logger.info(`🔌 Socket connected: ${socket.id}`);

    // Allow client to join a specific document room
    socket.on("join-document", (documentId) => {
      socket.join(`document_${documentId}`);
      logger.info(`👤 Socket ${socket.id} joined room: document_${documentId}`);
    });

    socket.on("leave-document", (documentId) => {
      socket.leave(`document_${documentId}`);
      logger.info(`👋 Socket ${socket.id} left room: document_${documentId}`);
    });

    socket.on("disconnect", () => {
      logger.info(`❌ Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getSocketIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

// Shutdown needs to close this without caring whether it was ever initialised,
// and without the throw above. Open websockets otherwise keep httpServer.close()
// from ever calling back.
export const closeSocket = async () => {
  if (!io) return;
  await new Promise((resolve) => io.close(resolve));
  io = null;
};
