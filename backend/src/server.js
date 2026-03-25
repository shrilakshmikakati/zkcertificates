const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
require('dotenv').config();
const { connectDatabase, isDatabaseConnected } = require('./config/database');

// Import routes
const certificateRoutes         = require('./routes/certificates');
const dynamicCertificateRoutes  = require('./routes/dynamicCertificates');
const certificateWorkflowRoutes = require('./routes/certificateWorkflow');
const zkProofRoutes             = require('./routes/zkProofs');
const merkleRoutes              = require('./routes/merkle');

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const NETWORK_RPC_ENV_MAP = { zksyncSepholia: 'ZKSYNC_SEPHOLIA_RPC_URL' };

function validateCriticalEnv() {
    const selectedNetwork = (process.env.BLOCKCHAIN_NETWORK || 'ganache').trim();
    const isL2Network = Boolean(NETWORK_RPC_ENV_MAP[selectedNetwork]);
    if (!isL2Network) return;
    const rpcEnvKey = NETWORK_RPC_ENV_MAP[selectedNetwork];
    const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    const rpcUrl     = (process.env[rpcEnvKey] || '').trim();
    const missing    = [];
    if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
    if (!rpcUrl)     missing.push(rpcEnvKey);
    if (missing.length) throw new Error(`Missing env vars for ${selectedNetwork}: ${missing.join(', ')}`);
}

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));

const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
    max: isProduction
        ? (Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100)
        : (Number(process.env.RATE_LIMIT_MAX_REQUESTS_DEV) || 5000),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        if (isProduction) return false;
        const ip = req.ip || '';
        return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
    },
    handler: (req, res) => res.status(429).json({ error: 'Too Many Requests' })
});
app.use('/api', limiter);

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined'));

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK', timestamp: new Date().toISOString(),
        service: 'ZK Certificate System', version: '2.0.0',
        mongodb: isDatabaseConnected() ? 'connected' : 'disconnected'
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/certificates/retrieve
//
// Registered as a direct app.get() BEFORE any router middleware so it cannot
// be intercepted by dynamicCertificateRoutes or any other router.
//
// KEY FIX: studentId search now includes metadata.student_id — this is where
// the real student ID (e.g. S2026001) is stored because certificateWorkflow.js
// spreads the full cert object into metadata (line: metadata: { ...cert })
// while the top-level studentId field stores the ZK index (STU0, STU1 etc.)
// ─────────────────────────────────────────────────────────────────────────────

function getCertModel() {
    if (mongoose.models.Certificate) return mongoose.models.Certificate;
    const s = new mongoose.Schema({
        certificateId:    { type: String, index: true },
        name:             String,
        email:            String,
        studentId:        { type: String, index: true },
        issueDate:        String,
        verificationCode: String,
        deploymentId:     { type: mongoose.Schema.Types.ObjectId, ref: 'DeploymentRecord' },
        transactionHash:  String,
        blockNumber:      Number,
        contractAddress:  String,
        merkleRoot:       String,
        merkleProof:      [{ data: String, position: String }],
        leafHash:         String,
        content: {
            institutionName: String, courseName: String, completionDate: String,
            certificateProgram: String, studentName: String, studentEmail: String,
            studentId: String, graduationYear: Number,
        },
        zkProof: {
            pA: [String], pB: [[String], [String]], pC: [String],
            publicSignals: [String], verified: Boolean,
        },
        zkProofVerified: { type: Boolean, default: false },
        status:          { type: String, default: 'pending' },
        metadata:        { type: mongoose.Schema.Types.Mixed, default: {} },
        deployedAt:      Date,
        verifiedAt:      Date,
    }, { timestamps: true });
    return mongoose.model('Certificate', s);
}

function getDepModel() {
    if (mongoose.models.DeploymentRecord) return mongoose.models.DeploymentRecord;
    const s = new mongoose.Schema({
        networkSelection: String, networkDisplay: String, networkName: String,
        chainId: Number, layerType: String, isLayer2: Boolean, rpcUrl: String,
        contractAddress: String, transactionHash: String, blockNumber: Number,
        blockHash: String, gasUsed: String, merkleRoot: String,
        totalCertificates: Number,
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        deployedAt: Date,
    }, { timestamps: true });
    return mongoose.model('DeploymentRecord', s);
}

const RETRIEVE_LABELS = {
    studentId: 'Student ID', certId: 'Certificate ID', blockHash: 'Block Hash',
    txHash: 'Transaction Hash', merkleRoot: 'Merkle Root',
    email: 'Email', verificationCode: 'Verification Code',
};

app.get('/api/certificates/retrieve', async (req, res) => {
    const { query, type = 'studentId' } = req.query;
    const q = (query || '').trim();

    if (!q) return res.status(400).json({ success: false, message: 'query parameter is required' });

    const connected = await connectDatabase();
    if (!connected || !isDatabaseConnected()) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected. Check MONGODB_URI in your .env file.',
        });
    }

    const Certificate      = getCertModel();
    const DeploymentRecord = getDepModel();

    try {
        let certificates = [];

        switch (type) {

            case 'studentId':
                // Search ALL places the real student ID could be stored:
                // 1. top-level studentId (may be STU0 index)
                // 2. content.studentId
                // 3. metadata.student_id  ← THE FIX: real ID like S2026001 lives here
                // 4. metadata.studentId
                // 5. metadata.preCommitmentData.student_id
                certificates = await Certificate.find({
                    $or: [
                        { studentId:                              { $regex: q, $options: 'i' } },
                        { 'content.studentId':                    { $regex: q, $options: 'i' } },
                        { 'metadata.student_id':                  { $regex: q, $options: 'i' } },
                        { 'metadata.studentId':                   { $regex: q, $options: 'i' } },
                        { 'metadata.preCommitmentData.student_id':{ $regex: q, $options: 'i' } },
                    ],
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'certId':
                certificates = await Certificate.find({
                    certificateId: { $regex: q, $options: 'i' },
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'blockHash': {
                const deps = await DeploymentRecord.find({ blockHash: { $regex: q, $options: 'i' } }).lean();
                if (deps.length) {
                    certificates = await Certificate.find({ deploymentId: { $in: deps.map(d => d._id) } })
                        .populate('deploymentId').sort({ createdAt: -1 }).lean();
                }
                break;
            }

            case 'txHash':
                certificates = await Certificate.find({ transactionHash: { $regex: q, $options: 'i' } })
                    .populate('deploymentId').sort({ createdAt: -1 }).lean();
                if (!certificates.length) {
                    const deps = await DeploymentRecord.find({ transactionHash: { $regex: q, $options: 'i' } }).lean();
                    if (deps.length) {
                        certificates = await Certificate.find({ deploymentId: { $in: deps.map(d => d._id) } })
                            .populate('deploymentId').sort({ createdAt: -1 }).lean();
                    }
                }
                break;

            case 'merkleRoot':
                certificates = await Certificate.find({ merkleRoot: { $regex: q, $options: 'i' } })
                    .populate('deploymentId').sort({ createdAt: -1 }).lean();
                if (!certificates.length) {
                    const deps = await DeploymentRecord.find({ merkleRoot: { $regex: q, $options: 'i' } }).lean();
                    if (deps.length) {
                        certificates = await Certificate.find({ deploymentId: { $in: deps.map(d => d._id) } })
                            .populate('deploymentId').sort({ createdAt: -1 }).lean();
                    }
                }
                break;

            case 'email':
                certificates = await Certificate.find({
                    $or: [
                        { email:                  { $regex: q, $options: 'i' } },
                        { 'content.studentEmail': { $regex: q, $options: 'i' } },
                        { 'metadata.email':       { $regex: q, $options: 'i' } },
                    ],
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'verificationCode':
                certificates = await Certificate.find({ verificationCode: { $regex: q, $options: 'i' } })
                    .populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            default:
                return res.status(400).json({ success: false, message: `Unknown type: ${type}` });
        }

        if (!certificates.length) {
            return res.status(404).json({
                success: false,
                message: `No certificates found for ${RETRIEVE_LABELS[type] || type}: "${q}"`,
            });
        }

        const dep = certificates[0]?.deploymentId || {};
        const deploymentInfo = {
            networkSelection: dep.networkSelection, networkDisplay: dep.networkDisplay,
            networkName: dep.networkName, chainId: dep.chainId, layerType: dep.layerType,
            isLayer2: dep.isLayer2, rpcUrl: dep.rpcUrl,
            contractAddress:   dep.contractAddress   || certificates[0]?.contractAddress,
            transactionHash:   dep.transactionHash   || certificates[0]?.transactionHash,
            blockNumber:       dep.blockNumber        || certificates[0]?.blockNumber,
            blockHash:         dep.blockHash,
            gasUsed:           dep.gasUsed,
            merkleRoot:        dep.merkleRoot         || certificates[0]?.merkleRoot,
            totalCertificates: dep.totalCertificates,
            deployedAt:        dep.deployedAt,
            metadata:          dep.metadata,
        };

        const shapedCerts = certificates.map(c => ({
            certificateId:    c.certificateId,
            name:             c.name,
            email:            c.email,
            // Show the real student ID from metadata if the stored one is just an index
            studentId:        c.metadata?.student_id || c.metadata?.preCommitmentData?.student_id
                              || c.studentId || c.content?.studentId,
            issueDate:        c.issueDate,
            verificationCode: c.verificationCode,
            status:           c.status,
            transactionHash:  c.transactionHash,
            blockNumber:      c.blockNumber,
            contractAddress:  c.contractAddress,
            merkleRoot:       c.merkleRoot,
            merkleProof:      c.merkleProof,
            leafHash:         c.leafHash,
            zkProof:          c.zkProof,
            zkProofVerified:  c.zkProofVerified,
            content:          c.content,
            deployedAt:       c.deployedAt,
            createdAt:        c.createdAt,
        }));

        return res.status(200).json({
            success: true,
            data: {
                ...deploymentInfo,
                certificates:      shapedCerts,
                totalCertificates: certificates.length,
                queryType:         type,
                searchQuery:       q,
            },
        });

    } catch (err) {
        console.error('Certificate retrieve error:', err);
        return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
    }
});

// ── API routes (registered AFTER the inline /retrieve above) ─────────────────
app.use('/api/workflow',            certificateWorkflowRoutes);
app.use('/api/certificates',        dynamicCertificateRoutes);
app.use('/api/certificates/legacy', certificateRoutes);
app.use('/api/zkproofs',            zkProofRoutes);
app.use('/api/merkle',              merkleRoutes);
// ─────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    console.error('Error:', err);
    if (err.name === 'ValidationError')
        return res.status(400).json({ error: 'Validation Error', message: err.message });
    if (err.name === 'MulterError')
        return res.status(400).json({ error: 'File Upload Error', message: err.message });
    res.status(500).json({
        error: 'Internal Server Error',
        message: isProduction ? 'Something went wrong' : err.message
    });
});

app.use('*', (req, res) => {
    res.status(404).json({ error: 'Not Found', message: `Route ${req.originalUrl} not found` });
});

async function startServer() {
    validateCriticalEnv();
    await connectDatabase();
    app.listen(PORT, () => {
        console.log(`ZK Certificate System running on port ${PORT}`);
        console.log(` Retrieve endpoint: http://localhost:${PORT}/api/certificates/retrieve`);
        console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`  MongoDB: ${isDatabaseConnected() ? 'connected' : 'disabled/unavailable'}`);
    });
}

startServer();
module.exports = app;