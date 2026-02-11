const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const certificateRoutes = require('./routes/certificates');
const dynamicCertificateRoutes = require('./routes/dynamicCertificates');
const certificateWorkflowRoutes = require('./routes/certificateWorkflow');
const zkProofRoutes = require('./routes/zkProofs');
const merkleRoutes = require('./routes/merkle');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

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
app.listen(PORT, () => {
    console.log(` ZK Certificate System running on port ${PORT}`);
    console.log(` Health check: http://localhost:${PORT}/health`);
    console.log(` Dynamic certificates: http://localhost:${PORT}/api/certificates`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(` Features: Dynamic CSV/Excel processing, Custom templates, Real-time API`);
});

module.exports = app;