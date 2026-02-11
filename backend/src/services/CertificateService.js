const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const Joi = require('joi');

class CertificateService {
    /**
     * Validate student data from CSV row
     * @param {Object} row - CSV row data
     * @returns {Object} - Validated student data
     */
    static validateStudentData(row) {
        const schema = Joi.object({
            studentId: Joi.string().required().min(1).max(50),
            studentName: Joi.string().required().min(2).max(100),
            email: Joi.string().email().required(),
            subject1: Joi.number().min(0).max(100).required(),
            subject2: Joi.number().min(0).max(100).required(),
            subject3: Joi.number().min(0).max(100).required(),
            subject4: Joi.number().min(0).max(100).required(),
            subject5: Joi.number().min(0).max(100).required()
        });

        const { error, value } = schema.validate(row);
        if (error) {
            throw new Error(`Invalid student data: ${error.details[0].message}`);
        }

        // Convert numeric strings to numbers if needed
        value.subject1 = parseFloat(value.subject1);
        value.subject2 = parseFloat(value.subject2);
        value.subject3 = parseFloat(value.subject3);
        value.subject4 = parseFloat(value.subject4);
        value.subject5 = parseFloat(value.subject5);

        return value;
    }

    /**
     * Generate certificate commitment hash
     * @param {Object} studentData - Student data
     * @returns {Object} - Certificate with commitment hash
     */
    static generateCertificateCommitment(studentData) {
        // Generate random salt for privacy
        const salt = crypto.randomBytes(32).toString('hex');

        // Create commitment string
        const commitmentData = [
            studentData.studentId,
            salt,
            studentData.subject1,
            studentData.subject2,
            studentData.subject3,
            studentData.subject4,
            studentData.subject5
        ].join('|');

        // Generate commitment hash using SHA-256
        const commitment = crypto
            .createHash('sha256')
            .update(commitmentData)
            .digest('hex');

        return {
            studentId: studentData.studentId,
            studentName: studentData.studentName,
            email: studentData.email,
            subjects: [
                studentData.subject1,
                studentData.subject2,
                studentData.subject3,
                studentData.subject4,
                studentData.subject5
            ],
            salt,
            commitment,
            commitmentData
        };
    }

    /**
     * Verify certificate commitment
     * @param {Object} certificate - Certificate data
     * @param {string} providedCommitment - Commitment to verify
     * @returns {boolean} - True if valid
     */
    static verifyCertificateCommitment(certificate, providedCommitment) {
        const computedCommitment = crypto
            .createHash('sha256')
            .update(certificate.commitmentData)
            .digest('hex');

        return computedCommitment === providedCommitment;
    }

    /**
     * Calculate academic metrics
     * @param {Array} subjects - Array of subject grades
     * @param {number} passingGrade - Minimum passing grade
     * @returns {Object} - Academic metrics
     */
    static calculateAcademicMetrics(subjects, passingGrade = 40) {
        const totalMarks = subjects.reduce((sum, grade) => sum + grade, 0);
        const averageGrade = totalMarks / subjects.length;
        const passedSubjects = subjects.filter(grade => grade >= passingGrade).length;
        const allSubjectsPassed = passedSubjects === subjects.length;

        return {
            totalMarks,
            averageGrade: Math.round(averageGrade * 100) / 100,
            passedSubjects,
            totalSubjects: subjects.length,
            allSubjectsPassed,
            passPercentage: Math.round((passedSubjects / subjects.length) * 100)
        };
    }

    /**
     * Generate CSV template
     * @returns {string} - CSV template content
     */
    static generateCSVTemplate() {
        const headers = [
            'studentId',
            'studentName',
            'email',
            'subject1',
            'subject2',
            'subject3',
            'subject4',
            'subject5'
        ];

      
        let csvContent = headers.join(',') + '\n';
        sampleData.forEach(row => {
            csvContent += row.join(',') + '\n';
        });

        return csvContent;
    }

    /**
     * Generate PDF certificate
     * @param {Object} certificateData - Certificate information
     * @returns {Buffer} - PDF buffer
     */
    static async generatePDFCertificate(certificateData) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: { top: 50, bottom: 50, left: 50, right: 50 }
                });

                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    resolve(pdfBuffer);
                });

                // Generate QR code
                const qrCodeDataURL = await QRCode.toDataURL(certificateData.qrCodeData);
                const qrCodeBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');

                // Certificate design
                doc.fontSize(24).fillColor('#2c3e50').text('CERTIFICATE OF COMPLETION', { align: 'center' });
                doc.moveDown(2);

                doc.fontSize(18).fillColor('#34495e').text('This is to certify that', { align: 'center' });
                doc.moveDown(1);

                doc.fontSize(26).fillColor('#e74c3c').text(certificateData.studentName, {
                    align: 'center',
                    underline: true
                });
                doc.moveDown(1.5);

                doc.fontSize(16).fillColor('#34495e').text(`has successfully completed the course`, { align: 'center' });
                doc.moveDown(0.5);

                doc.fontSize(20).fillColor('#2980b9').text(certificateData.courseName, { align: 'center' });
                doc.moveDown(0.5);

                doc.fontSize(16).fillColor('#34495e').text(`at`, { align: 'center' });
                doc.moveDown(0.5);

                doc.fontSize(18).fillColor('#27ae60').text(certificateData.institutionName, { align: 'center' });
                doc.moveDown(1);

                doc.fontSize(14).fillColor('#7f8c8d').text(`Year of Graduation: ${certificateData.graduationYear}`, { align: 'center' });
                doc.moveDown(2);

                // Certificate hash
                doc.fontSize(10).fillColor('#95a5a6').text(`Certificate Hash: ${certificateData.certificateHash}`, {
                    align: 'center',
                    width: 400
                });
                doc.moveDown(1);

                // QR Code
                doc.image(qrCodeBuffer, doc.page.width - 150, doc.page.height - 150, {
                    width: 100,
                    height: 100
                });

                doc.fontSize(8).fillColor('#bdc3c7').text('Scan QR code to verify', doc.page.width - 150, doc.page.height - 40, {
                    width: 100,
                    align: 'center'
                });

                // Footer
                doc.fontSize(10).fillColor('#95a5a6').text(
                    'This certificate is secured using Zero-Knowledge Proofs and Blockchain Technology',
                    50,
                    doc.page.height - 30,
                    { align: 'center', width: doc.page.width - 200 }
                );

                doc.end();

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Generate verification QR code data
     * @param {Object} verificationData - Data for QR code
     * @returns {string} - JSON string for QR code
     */
    static generateQRCodeData(verificationData) {
        return JSON.stringify({
            type: 'zk_certificate_verification',
            certificateHash: verificationData.certificateHash,
            merkleRoot: verificationData.merkleRoot,
            batchId: verificationData.batchId,
            verificationUrl: `${process.env.FRONTEND_URL}/verify`,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = CertificateService;