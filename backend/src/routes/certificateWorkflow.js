const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const crypto = require('crypto');

const DynamicCertificateService = require('../services/DynamicCertificateService');
const MerkleService = require('../services/MerkleService');
const CertificateService = require('../services/CertificateService');

const router = express.Router();

// Configure storage for complete certificate workflow
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/certificates';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/csv'
        ];

        const allowedExtensions = ['.csv', '.xlsx', '.xls'];
        const fileExtension = path.extname(file.originalname).toLowerCase();

        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files are allowed'), false);
        }
    }
});

/**
 * @route POST /api/workflow/parse
 * @desc Step 1: Parse file and analyze structure
 */
router.post('/parse', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'File is required'
            });
        }

        // Analyze file structure with dynamic service
        const analysis = await DynamicCertificateService.analyzeFileStructure(req.file.path);

        // Generate session for workflow tracking
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store session data
        global.certificateWorkflowSessions = global.certificateWorkflowSessions || {};
        global.certificateWorkflowSessions[sessionId] = {
            filePath: req.file.path,
            originalName: req.file.originalname,
            analysis: analysis,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
            step: 'parsed'
        };

        res.json({
            success: true,
            sessionId: sessionId,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            ...analysis
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('File parsing error:', error);
        res.status(500).json({
            success: false,
            error: 'File Processing Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/process
 * @desc Step 2: Process data with field mappings and generate Merkle tree
 */
router.post('/process', async (req, res) => {
    try {
        const schema = Joi.object({
            sessionId: Joi.string().required(),
            fieldMappings: Joi.object().required(),
            processingOptions: Joi.object({
                requiredFields: Joi.array().items(Joi.string()),
                skipEmptyRows: Joi.boolean().default(true),
                validateEmails: Joi.boolean().default(true)
            }).optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { sessionId, fieldMappings, processingOptions } = value;

        // Retrieve session
        const session = global.certificateWorkflowSessions?.[sessionId];
        if (!session || new Date() > session.expiresAt) {
            return res.status(410).json({
                success: false,
                error: 'Session expired or not found'
            });
        }

        // Re-parse file for processing
        const analysis = await DynamicCertificateService.analyzeFileStructure(session.filePath);
        const rawData = analysis.sampleData; // In real implementation, get full data

        // Process data with user mappings
        const processingResult = DynamicCertificateService.processStudentData(
            rawData,
            fieldMappings,
            processingOptions || {}
        );

        if (!processingResult.success) {
            return res.status(400).json({
                success: false,
                error: 'Data Processing Failed',
                details: processingResult.errors
            });
        }

        // Generate certificate commitments for Merkle tree
        const certificatesWithCommitments = processingResult.processedData.map(student => {
            // Create commitment hash for each student
            const commitmentData = {
                name: student.name,
                email: student.email || '',
                course: student.course || '',
                grade: student.grade || '',
                studentId: student.student_id || student.id,
                timestamp: new Date().toISOString()
            };

            const commitment = crypto.createHash('sha256')
                .update(JSON.stringify(commitmentData))
                .digest('hex');

            return {
                ...student,
                commitment: commitment,
                commitmentData: commitmentData
            };
        });

        // Build Merkle tree
        let merkleTree, merkleRoot, certificatesWithProofs;

        try {
            merkleTree = MerkleService.buildMerkleTree(certificatesWithCommitments);
            merkleRoot = '0x' + merkleTree.getRoot().toString('hex');

            // Generate proofs for each certificate 
            certificatesWithProofs = certificatesWithCommitments.map(cert => {
                const proof = MerkleService.generateMerkleProof(merkleTree, cert.commitment);
                return {
                    ...cert,
                    merkleProof: proof
                };
            });

            // Get tree statistics
            const treeStats = MerkleService.getTreeStats(merkleTree);

            // Update session with processed data
            session.processedData = certificatesWithProofs;
            session.merkleRoot = merkleRoot;
            session.merkleTreeStats = treeStats;
            session.step = 'processed';

        } catch (merkleError) {
            console.error('Merkle tree generation error:', merkleError);
            return res.status(500).json({
                success: false,
                error: 'Merkle Tree Generation Failed',
                message: merkleError.message
            });
        }

        res.json({
            success: true,
            message: `Successfully processed ${certificatesWithProofs.length} certificates`,
            summary: processingResult.summary,
            certificates: certificatesWithProofs,
            merkleRoot: merkleRoot,
            merkleTreeStats: session.merkleTreeStats,
            errors: processingResult.errors
        });

    } catch (error) {
        console.error('Data processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Processing Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/generate-pdf
 * @desc Step 3: Generate PDF certificate for individual student
 */
router.post('/generate-pdf', async (req, res) => {
    try {
        const schema = Joi.object({
            studentData: Joi.object().required(),
            template: Joi.object().optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { studentData, template } = value;

        // Generate PDF using dynamic service
        const pdfBuffer = await DynamicCertificateService.generateDynamicPDFCertificate(
            studentData,
            template || {
                title: 'CERTIFICATE OF COMPLETION',
                colors: {
                    primary: '#2c3e50',
                    secondary: '#3498db',
                    accent: '#e74c3c'
                }
            }
        );

        const fileName = `${(studentData.name || 'certificate').replace(/[^a-zA-Z0-9]/g, '_')}_certificate.pdf`;

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({
            success: false,
            error: 'PDF Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/deploy
 * @desc Step 4: Deploy certificates to blockchain (simulated)
 */
router.post('/deploy', async (req, res) => {
    try {
        const schema = Joi.object({
            sessionId: Joi.string().optional(),
            merkleRoot: Joi.string().required(),
            certificates: Joi.array().optional(),
            totalCertificates: Joi.number().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { sessionId, merkleRoot, certificates, totalCertificates } = value;

        // Simulate blockchain deployment
        const transactionHash = `0x${crypto.randomBytes(32).toString('hex')}`;
        const blockNumber = Math.floor(Math.random() * 1000000) + 18500000;
        const gasUsed = Math.floor(Math.random() * 200000) + 21000;

        // If session provided, mark as deployed
        if (sessionId && global.certificateWorkflowSessions?.[sessionId]) {
            global.certificateWorkflowSessions[sessionId].step = 'deployed';
            global.certificateWorkflowSessions[sessionId].deploymentData = {
                transactionHash,
                blockNumber,
                gasUsed,
                deployedAt: new Date().toISOString()
            };
        }

        res.json({
            success: true,
            message: 'Certificates deployed to blockchain successfully',
            transactionHash: transactionHash,
            blockNumber: blockNumber,
            gasUsed: gasUsed,
            merkleRoot: merkleRoot,
            totalCertificates: totalCertificates,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Deployment error:', error);
        res.status(500).json({
            success: false,
            error: 'Deployment Failed',
            message: error.message
        });
    }
});

/**
 * @route GET /api/workflow/session/:sessionId
 * @desc Get session status and data
 */
router.get('/session/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = global.certificateWorkflowSessions?.[sessionId];

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        if (new Date() > session.expiresAt) {
            delete global.certificateWorkflowSessions[sessionId];
            return res.status(410).json({
                success: false,
                error: 'Session expired'
            });
        }

        res.json({
            success: true,
            session: {
                sessionId: sessionId,
                fileName: session.originalName,
                step: session.step,
                processedCount: session.processedData?.length || 0,
                merkleRoot: session.merkleRoot,
                merkleTreeStats: session.merkleTreeStats,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt
            }
        });

    } catch (error) {
        console.error('Session retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Session retrieval failed'
        });
    }
});

/**
 * @route DELETE /api/workflow/cleanup/:sessionId
 * @desc Clean up session and temporary files
 */
router.delete('/cleanup/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = global.certificateWorkflowSessions?.[sessionId];

        if (session) {
            // Clean up file
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }

            // Remove session
            delete global.certificateWorkflowSessions[sessionId];
        }

        res.json({
            success: true,
            message: 'Session cleaned up successfully'
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'Cleanup failed'
        });
    }
});

// Periodic cleanup of expired sessions
setInterval(() => {
    if (global.certificateWorkflowSessions) {
        const now = new Date();
        Object.entries(global.certificateWorkflowSessions).forEach(([sessionId, session]) => {
            if (now > session.expiresAt) {
                if (fs.existsSync(session.filePath)) {
                    fs.unlinkSync(session.filePath);
                }
                delete global.certificateWorkflowSessions[sessionId];
            }
        });
    }
}, 30 * 60 * 1000); // Run every 30 minutes

module.exports = router;