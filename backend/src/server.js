const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { connectDatabase, isDatabaseConnected } = require('./config/database');

// Import routes
const certificateRoutes = require('./routes/certificates');
const dynamicCertificateRoutes = require('./routes/dynamicCertificates');
const certificateWorkflowRoutes = require('./routes/certificateWorkflow');
const zkProofRoutes = require('./routes/zkProofs');
const merkleRoutes = require('./routes/merkle');

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const NETWORK_RPC_ENV_MAP = {
    zksyncSepholia: 'ZKSYNC_SEPHOLIA_RPC_URL'
};

const LOCAL_NETWORKS = ['ganache', 'localhost', 'hardhat'];

function validateCriticalEnv() {
    const selectedNetwork = (process.env.BLOCKCHAIN_NETWORK || 'ganache').trim();
    const isL2Network = Boolean(NETWORK_RPC_ENV_MAP[selectedNetwork]);

    if (!isL2Network) {
        return;
    }

    const rpcEnvKey = NETWORK_RPC_ENV_MAP[selectedNetwork];
    const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    const rpcUrl = (process.env[rpcEnvKey] || '').trim();

    const missing = [];
    if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
    if (!rpcUrl) missing.push(rpcEnvKey);

    if (missing.length) {
        throw new Error(`Missing required environment variables for ${selectedNetwork}: ${missing.join(', ')}`);
    }
}

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
    max: isProduction
        ? (Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100)
        : (Number(process.env.RATE_LIMIT_MAX_REQUESTS_DEV) || 5000),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        if (isProduction) {
            return false;
        }

        const ip = req.ip || '';
        return (
            ip === '::1' ||
            ip === '127.0.0.1' ||
            ip === '::ffff:127.0.0.1'
        );
    },
    handler: (req, res) => {
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'Too many requests from this IP, please try again later.'
        });
    }
});
app.use('/api', limiter);

// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'ZK Certificate System',
        version: '2.0.0',
        features: {
            dynamicCertificates: true,
            excelSupport: true,
            realTimeProcessing: true,
            customTemplates: true,
            merkleTreeIntegration: true,
            workflowManagement: true
        }
    });
});

// API routes
app.use('/api/workflow', certificateWorkflowRoutes); // Main workflow endpoints
app.use('/api/certificates', dynamicCertificateRoutes); // Dynamic certificate service
app.use('/api/certificates/legacy', certificateRoutes); // Legacy routes
app.use('/api/zkproofs', zkProofRoutes);
app.use('/api/merkle', merkleRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            message: err.message,
            details: err.details
        });
    }

    if (err.name === 'MulterError') {
        return res.status(400).json({
            error: 'File Upload Error',
            message: err.message
        });
    }

    // Generic error
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production'
            ? 'Something went wrong'
            : err.message
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`
    });
});

// Start server
async function startServer() {
    validateCriticalEnv();
    await connectDatabase();

    app.listen(PORT, () => {
        console.log(` ZK Certificate System running on port ${PORT}`);
        console.log(` Health check: http://localhost:${PORT}/health`);
        console.log(` Dynamic certificates: http://localhost:${PORT}/api/certificates`);
        console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(` MongoDB: ${isDatabaseConnected() ? 'connected' : 'disabled/unavailable'}`);
        console.log(` Features: Dynamic CSV/Excel processing, Custom templates, Real-time API`);
    });
}

startServer();

module.exports = app;