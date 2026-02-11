const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const Joi = require('joi');
const XLSX = require('xlsx');

class DynamicCertificateService {
    /**
     * Dynamically analyze CSV/Excel structure and suggest field mappings
     * @param {string} filePath - Path to uploaded file
     * @returns {Object} - File analysis with suggested mappings
     */
    static async analyzeFileStructure(filePath) {
        try {
            let data = [];
            const fileExtension = filePath.split('.').pop().toLowerCase();

            if (fileExtension === 'csv') {
                // Parse CSV
                const fs = require('fs');
                const csv = require('csv-parser');

                await new Promise((resolve, reject) => {
                    fs.createReadStream(filePath)
                        .pipe(csv())
                        .on('data', (row) => data.push(row))
                        .on('end', resolve)
                        .on('error', reject);
                });
            } else if (['xlsx', 'xls'].includes(fileExtension)) {
                // Parse Excel
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                data = XLSX.utils.sheet_to_json(worksheet);
            }

            if (data.length === 0) {
                throw new Error('No data found in file');
            }

            // Analyze columns and suggest mappings
            const columns = Object.keys(data[0]);
            const suggestedMappings = this.suggestFieldMappings(columns);

            // Analyze data types and patterns
            const dataAnalysis = this.analyzeDataPatterns(data);

            return {
                success: true,
                totalRows: data.length,
                columns: columns,
                sampleData: data.slice(0, 3), // First 3 rows as sample
                suggestedMappings: suggestedMappings,
                dataAnalysis: dataAnalysis,
                detectedPatterns: this.detectDataPatterns(data)
            };

        } catch (error) {
            throw new Error(`File analysis failed: ${error.message}`);
        }
    }

    /**
     * Suggest field mappings based on column names
     * @param {Array} columns - Column names from the file
     * @returns {Object} - Suggested field mappings
     */
    static suggestFieldMappings(columns) {
        const mappings = {
            name: null,
            email: null,
            course: null,
            institution: null,
            graduation_date: null,
            grade: null,
            percentage: null,
            student_id: null
        };

        const patterns = {
            name: /name|student|full.*name|first.*name|last.*name/i,
            email: /email|e-mail|mail/i,
            course: /course|program|subject|major|degree/i,
            institution: /institution|university|college|school/i,
            graduation_date: /graduation|date|completed|finish/i,
            grade: /grade|result|class|division|merit/i,
            percentage: /percentage|percent|score|marks|cgpa|gpa/i,
            student_id: /id|student.*id|roll|registration|reg/i
        };

        columns.forEach(column => {
            for (const [field, pattern] of Object.entries(patterns)) {
                if (pattern.test(column) && !mappings[field]) {
                    mappings[field] = column;
                    break;
                }
            }
        });

        return mappings;
    }

    /**
     * Analyze data patterns in the file
     * @param {Array} data - Parsed data from file
     * @returns {Object} - Data analysis results
     */
    static analyzeDataPatterns(data) {
        const analysis = {
            totalRecords: data.length,
            emptyFields: {},
            dataTypes: {},
            uniqueValues: {},
            recommendations: []
        };

        if (data.length === 0) return analysis;

        const columns = Object.keys(data[0]);

        columns.forEach(column => {
            const values = data.map(row => row[column]).filter(val => val !== null && val !== undefined && val !== '');
            const emptyCount = data.length - values.length;

            analysis.emptyFields[column] = emptyCount;
            analysis.uniqueValues[column] = new Set(values).size;

            // Detect data type
            if (values.length > 0) {
                const firstValue = values[0];
                if (!isNaN(firstValue) && !isNaN(parseFloat(firstValue))) {
                    analysis.dataTypes[column] = 'number';
                } else if (this.isValidEmail(firstValue)) {
                    analysis.dataTypes[column] = 'email';
                } else if (this.isValidDate(firstValue)) {
                    analysis.dataTypes[column] = 'date';
                } else {
                    analysis.dataTypes[column] = 'text';
                }
            }
        });

        // Generate recommendations
        if (analysis.totalRecords < 10) {
            analysis.recommendations.push('Consider adding more sample data for better validation');
        }

        Object.entries(analysis.emptyFields).forEach(([column, emptyCount]) => {
            const percentage = (emptyCount / data.length) * 100;
            if (percentage > 50) {
                analysis.recommendations.push(`Column '${column}' has ${percentage.toFixed(1)}% empty values`);
            }
        });

        return analysis;
    }

    /**
     * Process dynamic data with user-defined field mappings
     * @param {Array} rawData - Raw data from CSV/Excel
     * @param {Object} fieldMappings - User-defined field mappings
     * @param {Object} options - Processing options
     * @returns {Array} - Processed student data
     */
    static processStudentData(rawData, fieldMappings, options = {}) {
        const processedData = [];
        const errors = [];

        rawData.forEach((row, index) => {
            try {
                const student = {
                    id: index + 1,
                    raw: row // Keep original data for reference
                };

                // Map fields dynamically
                Object.entries(fieldMappings).forEach(([targetField, sourceColumn]) => {
                    if (sourceColumn && row[sourceColumn] !== undefined) {
                        student[targetField] = this.cleanAndValidateField(
                            row[sourceColumn],
                            targetField,
                            options
                        );
                    }
                });

                // Generate additional fields
                student.processedAt = new Date().toISOString();
                student.certificateId = this.generateCertificateId(student);

                // Validate required fields
                const validation = this.validateStudentRecord(student, options.requiredFields || []);
                if (!validation.isValid) {
                    errors.push({
                        row: index + 1,
                        errors: validation.errors
                    });
                    return;
                }

                processedData.push(student);

            } catch (error) {
                errors.push({
                    row: index + 1,
                    error: error.message
                });
            }
        });

        return {
            success: true,
            processedData,
            errors,
            summary: {
                totalRows: rawData.length,
                successfulRows: processedData.length,
                errorRows: errors.length
            }
        };
    }

    /**
     * Clean and validate individual field data
     * @param {any} value - Field value
     * @param {string} fieldType - Type of field
     * @param {Object} options - Validation options
     * @returns {any} - Cleaned value
     */
    static cleanAndValidateField(value, fieldType, options) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const stringVal = String(value).trim();

        switch (fieldType) {
            case 'name':
                return this.cleanName(stringVal);
            case 'email':
                return this.cleanEmail(stringVal);
            case 'percentage':
                return this.cleanPercentage(stringVal);
            case 'grade':
                return this.cleanGrade(stringVal);
            case 'graduation_date':
                return this.cleanDate(stringVal);
            default:
                return stringVal;
        }
    }

    /**
     * Generate dynamic PDF certificate with configurable template
     * @param {Object} studentData - Student information
     * @param {Object} template - Certificate template configuration
     * @returns {Buffer} - PDF buffer
     */
    static async generateDynamicPDFCertificate(studentData, template) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: template.pageSize || 'A4',
                    margins: template.margins || { top: 50, bottom: 50, left: 50, right: 50 }
                });

                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    resolve(pdfBuffer);
                });

                // Apply template styling
                await this.applyDynamicTemplate(doc, studentData, template);

                doc.end();

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Apply dynamic template to PDF document
     * @param {PDFDocument} doc - PDF document
     * @param {Object} studentData - Student data
     * @param {Object} template - Template configuration
     */
    static async applyDynamicTemplate(doc, studentData, template) {
        const config = {
            title: template.title || 'CERTIFICATE OF COMPLETION',
            colors: template.colors || {
                primary: '#2c3e50',
                secondary: '#3498db',
                accent: '#e74c3c',
                text: '#34495e'
            },
            fonts: template.fonts || {
                title: { size: 24, family: 'Helvetica-Bold' },
                heading: { size: 18, family: 'Helvetica' },
                body: { size: 14, family: 'Helvetica' },
                small: { size: 10, family: 'Helvetica' }
            },
            layout: template.layout || 'standard'
        };

        // Header
        doc.fontSize(config.fonts.title.size)
            .fillColor(config.colors.primary)
            .text(config.title, { align: 'center' })
            .moveDown(2);

        // Institution name (if available)
        if (studentData.institution) {
            doc.fontSize(config.fonts.heading.size)
                .fillColor(config.colors.secondary)
                .text(studentData.institution, { align: 'center' })
                .moveDown(1);
        }

        // Main content
        doc.fontSize(config.fonts.body.size)
            .fillColor(config.colors.text)
            .text('This is to certify that', { align: 'center' })
            .moveDown(1);

        // Student name
        doc.fontSize(config.fonts.title.size)
            .fillColor(config.colors.accent)
            .text(studentData.name || 'Student Name', {
                align: 'center',
                underline: true
            })
            .moveDown(1.5);

        // Course completion text
        if (studentData.course) {
            doc.fontSize(config.fonts.body.size)
                .fillColor(config.colors.text)
                .text('has successfully completed the course of study in', { align: 'center' })
                .moveDown(0.5);

            doc.fontSize(config.fonts.heading.size)
                .fillColor(config.colors.secondary)
                .text(studentData.course, { align: 'center' })
                .moveDown(1);
        }

        // Grade information
        if (studentData.grade || studentData.percentage) {
            const gradeText = [];
            if (studentData.grade) gradeText.push(`Grade: ${studentData.grade}`);
            if (studentData.percentage) gradeText.push(`Score: ${studentData.percentage}`);

            doc.fontSize(config.fonts.body.size)
                .fillColor(config.colors.accent)
                .text(gradeText.join(' | '), { align: 'center' })
                .moveDown(1);
        }

        // Date
        if (studentData.graduation_date) {
            doc.fontSize(config.fonts.body.size)
                .fillColor(config.colors.text)
                .text(`Date: ${studentData.graduation_date}`, { align: 'center' })
                .moveDown(2);
        }

        // QR Code for verification
        if (studentData.certificateId) {
            const qrData = JSON.stringify({
                type: 'certificate_verification',
                certificateId: studentData.certificateId,
                studentName: studentData.name,
                issueDate: new Date().toISOString()
            });

            const qrCodeDataURL = await QRCode.toDataURL(qrData);
            const qrCodeBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');

            doc.image(qrCodeBuffer, doc.page.width - 150, doc.page.height - 150, {
                width: 80,
                height: 80
            });
        }

        // Certificate ID
        if (studentData.certificateId) {
            doc.fontSize(config.fonts.small.size)
                .fillColor(config.colors.text)
                .text(`Certificate ID: ${studentData.certificateId}`, 50, doc.page.height - 50);
        }
    }

    /**
     * Utility functions
     */
    static cleanName(name) {
        return name.replace(/[^\w\s.-]/g, '').trim();
    }

    static cleanEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email) ? email.toLowerCase() : null;
    }

    static cleanPercentage(percentage) {
        const num = parseFloat(percentage.toString().replace('%', ''));
        return !isNaN(num) && num >= 0 && num <= 100 ? num : null;
    }

    static cleanGrade(grade) {
        return grade.toString().trim();
    }

    static cleanDate(dateStr) {
        const date = new Date(dateStr);
        return !isNaN(date.getTime()) ? date.toISOString().split('T')[0] : dateStr;
    }

    static generateCertificateId(student) {
        const timestamp = Date.now();
        const hash = crypto.createHash('md5')
            .update(`${student.name}_${student.email}_${timestamp}`)
            .digest('hex');
        return `CERT-${hash.substring(0, 8).toUpperCase()}`;
    }

    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    static isValidDate(dateStr) {
        return !isNaN(Date.parse(dateStr));
    }

    static validateStudentRecord(student, requiredFields) {
        const errors = [];
        const isValid = requiredFields.every(field => {
            if (!student[field] || student[field] === null) {
                errors.push(`Missing required field: ${field}`);
                return false;
            }
            return true;
        });

        return { isValid, errors };
    }

    static detectDataPatterns(data) {
        const patterns = {
            hasEmailColumn: false,
            hasNumericGrades: false,
            hasDateColumn: false,
            hasIdColumn: false,
            commonGradeFormat: null
        };

        if (data.length === 0) return patterns;

        const columns = Object.keys(data[0]);

        // Check for email patterns
        patterns.hasEmailColumn = columns.some(col =>
            data.some(row => this.isValidEmail(row[col]))
        );

        // Check for numeric patterns
        patterns.hasNumericGrades = columns.some(col =>
            data.some(row => !isNaN(row[col]) && row[col] > 0 && row[col] <= 100)
        );

        // Check for date patterns
        patterns.hasDateColumn = columns.some(col =>
            data.some(row => this.isValidDate(row[col]))
        );

        return patterns;
    }
}

module.exports = DynamicCertificateService;