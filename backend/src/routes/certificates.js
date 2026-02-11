const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');

const CertificateService = require('../services/CertificateService');
const MerkleService = require('../services/MerkleService');

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
 * @route POST /api/certificates/process-csv
 * @desc Process CSV file and generate certificate batch data
 */
router.post('/process-csv', upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'CSV file is required'
            });
        }

        // Validate batch parameters
        const { error, value: batchData } = batchSchema.validate(req.body);
        if (error) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        const students = [];
        const csvPath = req.file.path;

        // Parse CSV file
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    try {
                        // Validate row structure
                        const studentData = CertificateService.validateStudentData(row);
                        students.push(studentData);
                    } catch (error) {
                        reject(new Error(`Invalid student data at row: ${error.message}`));
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Clean up uploaded file
        fs.unlinkSync(csvPath);

        if (students.length === 0) {
            return res.status(400).json({
                error: 'No valid student data found in CSV'
            });
        }

        // Generate certificate commitments
        const certificates = students.map(student =>
            CertificateService.generateCertificateCommitment(student)
        );

        // Build Merkle tree
        const merkleTree = MerkleService.buildMerkleTree(certificates);
        const merkleRoot = merkleTree.getHexRoot();

        // Prepare batch data for blockchain
        const batchInfo = {
            ...batchData,
            merkleRoot,
            totalStudents: students.length,
            certificates: certificates.map((cert, index) => ({
                ...cert,
                merkleProof: merkleTree.getHexProof(cert.commitment)
            }))
        };

        res.status(200).json({
            success: true,
            message: 'CSV processed successfully',
            data: {
                batchId: null, // Will be set after blockchain deployment
                merkleRoot,
                totalStudents: students.length,
                institutionName: batchData.institutionName,
                courseName: batchData.courseName,
                graduationYear: batchData.graduationYear,
                certificates: batchInfo.certificates
            }
        });

    } catch (error) {
        // Clean up file if error occurs
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('CSV processing error:', error);
        res.status(500).json({
            error: 'CSV Processing Failed',
            message: error.message
        });
    }
});

/**
 * @route GET /api/certificates/template
 * @desc Download CSV template for certificate data
 */
router.get('/template', (req, res) => {
    try {
        const templatePath = path.join(__dirname, '../templates/certificate_template.csv');

        // Generate template if it doesn't exist
        if (!fs.existsSync(templatePath)) {
            const templateData = CertificateService.generateCSVTemplate();
            fs.writeFileSync(templatePath, templateData);
        }

        res.download(templatePath, 'certificate_template.csv');
    } catch (error) {
        console.error('Template download error:', error);
        res.status(500).json({
            error: 'Template Download Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/verify
 * @desc Verify a certificate using Merkle proof
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
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
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
        res.status(500).json({
            error: 'Verification Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/parse
 * @desc Parse uploaded CSV/XLSX file and extract student data
 */
router.post('/parse', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'File is required'
            });
        }

        const csvPath = req.file.path;
        const students = [];

        // Parse CSV file
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                // Validate required fields
                if (row.name && row.email && row.course) {
                    students.push({
                        name: row.name.trim(),
                        email: row.email.trim(),
                        course: row.course.trim(),
                        institution: row.institution?.trim() || 'University of Technology',
                        graduationDate: row.graduation_date?.trim() || row.graduationDate?.trim() || '2024-05-15',
                        grade: row.grade?.trim() || 'Merit - First Class',
                        percentage: row.percentage?.trim() || '85.0%'
                    });
                }
            })
            .on('end', () => {
                // Clean up uploaded file
                fs.unlinkSync(csvPath);

                if (students.length === 0) {
                    return res.status(400).json({
                        error: 'No valid student data found in CSV'
                    });
                }

                res.json({
                    success: true,
                    message: `Successfully parsed ${students.length} student records`,
                    certificates: students
                });
            })
            .on('error', (error) => {
                // Clean up uploaded file on error
                if (fs.existsSync(csvPath)) {
                    fs.unlinkSync(csvPath);
                }
                console.error('CSV parsing error:', error);
                res.status(500).json({
                    error: 'CSV Parsing Failed',
                    message: error.message
                });
            });

    } catch (error) {
        console.error('File parsing error:', error);
        res.status(500).json({
            error: 'File Processing Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/generate
 * @desc Generate ZK proofs and Merkle tree for certificates
 */
router.post('/generate', async (req, res) => {
    try {
        const { certificates } = req.body;

        if (!certificates || !Array.isArray(certificates)) {
            return res.status(400).json({
                error: 'Certificates array is required'
            });
        }

        // Generate certificate commitments
        const certificateCommitments = certificates.map(cert =>
            CertificateService.generateCertificateCommitment(cert)
        );

        // Build Merkle tree
        const merkleTree = MerkleService.buildMerkleTree(certificateCommitments);
        const merkleRoot = merkleTree.getHexRoot();

        // Simulate ZK proof generation (in real implementation, this would use SnarkJS)
        const zkProofs = certificateCommitments.map((cert, index) => ({
            certificateId: `CERT_${Date.now()}_${index}`,
            proof: `0x${Math.random().toString(16).substr(2, 64)}`,
            publicSignals: [cert.hash]
        }));

        res.json({
            success: true,
            merkleRoot: merkleRoot,
            certificates: certificateCommitments,
            zkProofs: zkProofs,
            totalCertificates: certificates.length
        });

    } catch (error) {
        console.error('Certificate generation error:', error);
        res.status(500).json({
            error: 'Certificate Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/deploy
 * @desc Deploy certificates to blockchain
 */
router.post('/deploy', async (req, res) => {
    try {
        const { merkleRoot, certificates } = req.body;

        if (!merkleRoot) {
            return res.status(400).json({
                error: 'Merkle root is required'
            });
        }

        // Simulate blockchain deployment
        // In real implementation, this would use ethers.js to deploy to blockchain
        const transactionHash = `0x${Math.random().toString(16).substr(2, 64)}`;
        const blockNumber = Math.floor(Math.random() * 1000000) + 18500000;
        const gasUsed = Math.floor(Math.random() * 100000) + 21000;

        // Save deployment info (in real implementation, save to database)
        const deploymentInfo = {
            merkleRoot: merkleRoot,
            transactionHash: transactionHash,
            blockNumber: blockNumber,
            gasUsed: gasUsed,
            timestamp: new Date().toISOString(),
            certificateCount: certificates?.length || 0
        };

        console.log('Mock deployment successful:', deploymentInfo);

        res.json({
            success: true,
            message: 'Certificates deployed to blockchain successfully',
            transactionHash: transactionHash,
            blockNumber: blockNumber,
            gasUsed: gasUsed,
            merkleRoot: merkleRoot
        });

    } catch (error) {
        console.error('Blockchain deployment error:', error);
        res.status(500).json({
            error: 'Blockchain Deployment Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/certificates/pdf
 * @desc Generate PDF certificate
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
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        const pdfBuffer = await CertificateService.generatePDFCertificate(value);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${value.studentName}_certificate.pdf"`,
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({
            error: 'PDF Generation Failed',
            message: error.message
        });
    }
});

module.exports = router;