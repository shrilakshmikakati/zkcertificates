const mongoose = require('mongoose');

let isConnected = false;

async function connectDatabase() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
        console.log('MongoDB disabled: MONGODB_URI is not set');
        return false;
    }

    if (isConnected && mongoose.connection.readyState === 1) {
        return true;
    }

    try {
        mongoose.set('strictQuery', true);
        mongoose.set('bufferCommands', false);

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000
        });

        isConnected = true;
        console.log('MongoDB connected successfully');
        return true;
    } catch (error) {
        isConnected = false;
        console.error('MongoDB connection failed:', error.message);
        return false;
    }
}

function isDatabaseConnected() {
    return isConnected && mongoose.connection.readyState === 1;
}

module.exports = {
    connectDatabase,
    isDatabaseConnected
};
