const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const csv = require('csv-parser');
const XLSX = require('xlsx');

const DynamicCertificateService = require('../services/DynamicCertificateService');

const router = express.Router();

// Configure multer for file uploads with better organization
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/temp';
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
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit for larger Excel files
    },
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
 * @route POST /api/certificates/parse
 * @desc Analyze uploaded file and return structure information
 */
router.post('/parse', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'File is required',
                message: 'Please upload a CSV or Excel file'
            });
        }

        // Analyze file structure
        const analysis = await DynamicCertificateService.analyzeFileStructure(req.file.path);

        // Generate session ID for this upload
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store file info temporarily (in production, use Redis or database)
        global.uploadSessions = global.uploadSessions || {};
        global.uploadSessions[sessionId] = {
            filePath: req.file.path,
            originalName: req.file.originalname,
            analysis: analysis,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        };

        res.json({
            success: true,
            sessionId: sessionId,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            ...analysis
        });

    } catch (error) {
        // Clean up file on error
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
 * @route POST /api/certificates/generate
 * @desc Process data with user-defined mappings and generate certificates
 */
router.post('/generate', async (req, res) => {
    try {
        const schema = Joi.object({
            sessionId: Joi.string().required(),
            fieldMappings: Joi.object().required(),
            certificateTemplate: Joi.object({
                title: Joi.string(),
                institutionName: Joi.string(),
                pageSize: Joi.string().valid('A4', 'Letter'),
                colors: Joi.object(),
                fonts: Joi.object(),
                layout: Joi.string()
            }).optional(),
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

        const { sessionId, fieldMappings, certificateTemplate, processingOptions } = value;

        // Retrieve session data
        const session = global.uploadSessions?.[sessionId];
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found',
                message: 'File session expired or not found. Please upload the file again.'
            });
        }

        // Check if session expired
        if (new Date() > session.expiresAt) {
            delete global.uploadSessions[sessionId];
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }
            return res.status(410).json({
                success: false,
                error: 'Session expired',
                message: 'File session expired. Please upload the file again.'
            });
        }

        // Re-parse file with processing
        let rawData = [];
        const fileExtension = path.extname(session.filePath).toLowerCase();

        if (fileExtension === '.csv') {
            await new Promise((resolve, reject) => {
                fs.createReadStream(session.filePath)
                    .pipe(csv())
                    .on('data', (row) => rawData.push(row))
                    .on('end', resolve)
                    .on('error', reject);
            });
        } else if (['.xlsx', '.xls'].includes(fileExtension)) {
            const workbook = XLSX.readFile(session.filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            rawData = XLSX.utils.sheet_to_json(worksheet);
        }

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

        // Generate certificate metadata for each student
        const certificates = processingResult.processedData.map(student => ({
            ...student,
            certificateId: student.certificateId,
            issueDate: new Date().toISOString().split('T')[0],
            verificationCode: `VF${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
            template: certificateTemplate || {},
            status: 'ready'
        }));

        // Clean up file
        if (fs.existsSync(session.filePath)) {
            fs.unlinkSync(session.filePath);
        }
        delete global.uploadSessions[sessionId];

        res.json({
            success: true,
            message: `Successfully processed ${certificates.length} student records`,
            summary: processingResult.summary,
            errors: processingResult.errors,
            certificates: certificates
        });

    } catch (error) {
        console.error('Certificate generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Certificate Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/download-pdf
 * @desc Generate and download PDF certificate for a student
 */
router.post('/download-pdf', async (req, res) => {
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
            template || {}
        );

        const fileName = `${(studentData.name || 'certificate').replace(/[^a-zA-Z0-9]/g, '_')}_certificate.pdf`;

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF download error:', error);
        res.status(500).json({
            success: false,
            error: 'PDF Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/bulk-download
 * @desc Generate and download multiple PDF certificates as a ZIP
 */
router.post('/bulk-download', async (req, res) => {
    try {
        const schema = Joi.object({
            certificates: Joi.array().items(Joi.object()).required(),
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

        const { certificates, template } = value;

        if (certificates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No certificates provided'
            });
        }

        // For now, return individual download links
        // In production, implement ZIP creation
        const downloadLinks = certificates.map((cert, index) => ({
            certificateId: cert.certificateId,
            studentName: cert.name,
            downloadUrl: `/api/certificates/download-pdf`,
            downloadData: {
                studentData: cert,
                template: template || {}
            }
        }));

        res.json({
            success: true,
            message: `Prepared ${certificates.length} certificates for download`,
            downloads: downloadLinks,
            note: 'Use individual download endpoints for each certificate'
        });

    } catch (error) {
        console.error('Bulk download error:', error);
        res.status(500).json({
            success: false,
            error: 'Bulk Download Failed',
            message: error.message
        });
    }
});

/**
 * @route GET /api/certificates/templates
 * @desc Get available certificate templates
 */
router.get('/templates', (req, res) => {
    try {
        const templates = {
            standard: {
                title: 'CERTIFICATE OF COMPLETION',
                colors: {
                    primary: '#2c3e50',
                    secondary: '#3498db',
                    accent: '#e74c3c',
                    text: '#34495e'
                },
                fonts: {
                    title: { size: 24, family: 'Helvetica-Bold' },
                    heading: { size: 18, family: 'Helvetica' },
                    body: { size: 14, family: 'Helvetica' }
                }
            },
            academic: {
                title: 'ACADEMIC ACHIEVEMENT CERTIFICATE',
                colors: {
                    primary: '#1a365d',
                    secondary: '#2d3748',
                    accent: '#319795',
                    text: '#4a5568'
                },
                fonts: {
                    title: { size: 26, family: 'Helvetica-Bold' },
                    heading: { size: 20, family: 'Helvetica' },
                    body: { size: 16, family: 'Helvetica' }
                }
            },
            professional: {
                title: 'PROFESSIONAL CERTIFICATION',
                colors: {
                    primary: '#1a202c',
                    secondary: '#2d3748',
                    accent: '#805ad5',
                    text: '#4a5568'
                },
                fonts: {
                    title: { size: 22, family: 'Helvetica-Bold' },
                    heading: { size: 16, family: 'Helvetica' },
                    body: { size: 12, family: 'Helvetica' }
                }
            }
        };

        res.json({
            success: true,
            templates: templates
        });

    } catch (error) {
        console.error('Templates error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load templates'
        });
    }
});

/**
 * @route DELETE /api/certificates/cleanup/:sessionId
 * @desc Clean up temporary files and session data
 */
router.delete('/cleanup/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = global.uploadSessions?.[sessionId];

        if (session) {
            // Clean up file
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }

            // Remove session
            delete global.uploadSessions[sessionId];
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

// Cleanup expired sessions periodically
setInterval(() => {
    if (global.uploadSessions) {
        const now = new Date();
        Object.entries(global.uploadSessions).forEach(([sessionId, session]) => {
            if (now > session.expiresAt) {
                if (fs.existsSync(session.filePath)) {
                    fs.unlinkSync(session.filePath);
                }
                delete global.uploadSessions[sessionId];
            }
        });
    }
}, 10 * 60 * 1000); // Run every 10 minutes

module.exports = router;