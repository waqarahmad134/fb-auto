import mongoose from "mongoose";
import config from "../config.js";
import logger from "../utils/logger.js";

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri);
  logger.info({ uri: config.mongoUri }, "connected to MongoDB");
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
