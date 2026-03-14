import mongoose from 'mongoose';

/**
 * Connect to MongoDB Atlas.
 * Exits the process on connection failure so the container orchestrator can restart.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
