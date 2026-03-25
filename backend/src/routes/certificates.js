const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');

const CertificateService = require('../services/CertificateService');
const MerkleService = require('../services/MerkleService');
const ZKProofService = require('../services/ZKProofService');

// ── ADD: models + DB needed for /retrieve ────────────────────────────────────
const Certificate      = require('../models/Certificate');
const DeploymentRecord = require('../models/DeploymentRecord');
const { connectDatabase, isDatabaseConnected } = require('../config/database');
// ─────────────────────────────────────────────────────────────────────────────

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and XLSX files are allowed'), false);
        }
    }
});

// Validation schemas
const batchSchema = Joi.object({
    institutionName: Joi.string().required().min(2).max(100),
    courseName: Joi.string().required().min(2).max(100),
    graduationYear: Joi.number().required().min(1900).max(2100),
    passingGrade: Joi.number().required().min(0).max(100),
    requireAllSubjectsPassed: Joi.boolean().default(false)
});

/**
 * @route POST /api/certificates/legacy/process-csv
 */
router.post('/process-csv', upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'CSV file is required' });
        }

        const { error, value: batchData } = batchSchema.validate(req.body);
        if (error) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Validation Error', details: error.details });
        }

        const students = [];
        const csvPath = req.file.path;

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    try {
                        const studentData = CertificateService.validateStudentData(row);
                        students.push(studentData);
                    } catch (error) {
                        reject(new Error(`Invalid student data at row: ${error.message}`));
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        fs.unlinkSync(csvPath);

        if (students.length === 0) {
            return res.status(400).json({ error: 'No valid student data found in CSV' });
        }

        const certificates = students.map(student =>
            CertificateService.generateCertificateCommitment(student)
        );

        const merkleTree = MerkleService.buildMerkleTree(certificates);
        const merkleRoot = merkleTree.getHexRoot();

        const batchInfo = {
            ...batchData,
            merkleRoot,
            totalStudents: students.length,
            certificates: certificates.map((cert) => ({
                ...cert,
                merkleProof: merkleTree.getHexProof(cert.commitment)
            }))
        };

        res.status(200).json({
            success: true,
            message: 'CSV processed successfully',
            data: {
                batchId: null,
                merkleRoot,
                totalStudents: students.length,
                institutionName: batchData.institutionName,
                courseName: batchData.courseName,
                graduationYear: batchData.graduationYear,
                certificates: batchInfo.certificates
            }
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('CSV processing error:', error);
        res.status(500).json({ error: 'CSV Processing Failed', message: error.message });
    }
});

/**
 * @route GET /api/certificates/legacy/template
 */
router.get('/template', (req, res) => {
    try {
        const templatePath = path.join(__dirname, '../templates/certificate_template.csv');

        if (!fs.existsSync(templatePath)) {
            const templateData = CertificateService.generateCSVTemplate();
            fs.writeFileSync(templatePath, templateData);
        }

        res.download(templatePath, 'certificate_template.csv');
    } catch (error) {
        console.error('Template download error:', error);
        res.status(500).json({ error: 'Template Download Failed', message: error.message });
    }
});

/**
 * @route POST /api/certificates/legacy/verify
 */
router.post('/verify', async (req, res) => {
    try {
        const verificationSchema = Joi.object({
            certificateHash: Joi.string().required(),
            merkleRoot: Joi.string().required(),
            merkleProof: Joi.array().items(Joi.string()).required()
        });

        const { error, value } = verificationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: 'Validation Error', details: error.details });
        }

        const isValid = MerkleService.verifyProof(
            value.certificateHash,
            value.merkleProof,
            value.merkleRoot
        );

        res.status(200).json({
            success: true,
            valid: isValid,
            message: isValid ? 'Certificate is valid' : 'Certificate verification failed'
        });

    } catch (error) {
        console.error('Certificate verification error:', error);
        res.status(500).json({ error: 'Verification Failed', message: error.message });
    }
});

/**
 * @route POST /api/certificates/legacy/parse
 */
router.post('/parse', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'File is required' });
        }

        const csvPath = req.file.path;
        const students = [];

        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                if (row.name) {
                    students.push(row);
                }
            })
            .on('end', () => {
                fs.unlinkSync(csvPath);
                res.status(200).json({
                    success: true,
                    data: students
                });
            })
            .on('error', (err) => {
                res.status(500).json({ error: 'Parse Failed', message: err.message });
            });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Parse error:', error);
        res.status(500).json({ error: 'Parse Failed', message: error.message });
    }
});

/**
 * @route POST /api/certificates/legacy/pdf
 */
router.post('/pdf', async (req, res) => {
    try {
        const pdfSchema = Joi.object({
            studentName: Joi.string().required(),
            institutionName: Joi.string().required(),
            courseName: Joi.string().required(),
            graduationYear: Joi.number().required(),
            certificateHash: Joi.string().required(),
            qrCodeData: Joi.string().required()
        });

        const { error, value } = pdfSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: 'Validation Error', details: error.details });
        }

        const pdfBuffer = await CertificateService.generatePDFCertificate(value);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${value.studentName}_certificate.pdf"`,
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({ error: 'PDF Generation Failed', message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/certificates/legacy/retrieve?query=S2026001&type=studentId
//
// NOTE: This is mounted at /api/certificates/legacy in server.js.
// The frontend calls /api/certificates/retrieve — so server.js also needs
// a SECOND mount. See the server.js fix below.
// ─────────────────────────────────────────────────────────────────────────────

const RETRIEVE_LABELS = {
    studentId:        'Student ID',
    certId:           'Certificate ID',
    blockHash:        'Block Hash',
    txHash:           'Transaction Hash',
    merkleRoot:       'Merkle Root',
    email:            'Email',
    verificationCode: 'Verification Code',
};

router.get('/retrieve', async (req, res) => {
    const { query, type = 'studentId' } = req.query;
    const q = (query || '').trim();

    if (!q) {
        return res.status(400).json({ success: false, message: 'query parameter is required' });
    }

    const connected = await connectDatabase();
    if (!connected || !isDatabaseConnected()) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected. Check MONGODB_URI in your backend .env file.',
        });
    }

    try {
        let certificates = [];

        switch (type) {

            case 'studentId':
                certificates = await Certificate.find({
                    $or: [
                        { studentId:           { $regex: q, $options: 'i' } },
                        { 'content.studentId': { $regex: q, $options: 'i' } },
                    ],
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'certId':
                certificates = await Certificate.find({
                    certificateId: { $regex: q, $options: 'i' },
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'blockHash': {
                const deps = await DeploymentRecord.find({
                    blockHash: { $regex: q, $options: 'i' },
                }).lean();
                if (deps.length) {
                    certificates = await Certificate.find({
                        deploymentId: { $in: deps.map(d => d._id) },
                    }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                }
                break;
            }

            case 'txHash':
                certificates = await Certificate.find({
                    transactionHash: { $regex: q, $options: 'i' },
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();

                if (!certificates.length) {
                    const deps = await DeploymentRecord.find({
                        transactionHash: { $regex: q, $options: 'i' },
                    }).lean();
                    if (deps.length) {
                        certificates = await Certificate.find({
                            deploymentId: { $in: deps.map(d => d._id) },
                        }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                    }
                }
                break;

            case 'merkleRoot':
                certificates = await Certificate.find({
                    merkleRoot: { $regex: q, $options: 'i' },
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();

                if (!certificates.length) {
                    const deps = await DeploymentRecord.find({
                        merkleRoot: { $regex: q, $options: 'i' },
                    }).lean();
                    if (deps.length) {
                        certificates = await Certificate.find({
                            deploymentId: { $in: deps.map(d => d._id) },
                        }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                    }
                }
                break;

            case 'email':
                certificates = await Certificate.find({
                    $or: [
                        { email:                  { $regex: q, $options: 'i' } },
                        { 'content.studentEmail': { $regex: q, $options: 'i' } },
                    ],
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'verificationCode':
                certificates = await Certificate.find({
                    verificationCode: { $regex: q, $options: 'i' },
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
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
            networkSelection:  dep.networkSelection,
            networkDisplay:    dep.networkDisplay,
            networkName:       dep.networkName,
            chainId:           dep.chainId,
            layerType:         dep.layerType,
            isLayer2:          dep.isLayer2,
            rpcUrl:            dep.rpcUrl,
            contractAddress:   dep.contractAddress  || certificates[0]?.contractAddress,
            transactionHash:   dep.transactionHash  || certificates[0]?.transactionHash,
            blockNumber:       dep.blockNumber      || certificates[0]?.blockNumber,
            blockHash:         dep.blockHash,
            gasUsed:           dep.gasUsed,
            merkleRoot:        dep.merkleRoot       || certificates[0]?.merkleRoot,
            totalCertificates: dep.totalCertificates,
            deployedAt:        dep.deployedAt,
            metadata:          dep.metadata,
        };

        const shapedCerts = certificates.map(c => ({
            certificateId:    c.certificateId,
            name:             c.name,
            email:            c.email,
            studentId:        c.studentId || c.content?.studentId,
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
        return res.status(500).json({
            success: false,
            message: `Server error: ${err.message}`,
        });
    }
});

module.exports = router;