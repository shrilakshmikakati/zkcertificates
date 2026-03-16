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
                sampleData: data.slice(0, 3), // First 3 rows for preview
                allData: data, // Complete dataset for verification
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
        // Essential certificate fields only - streamlined approach
        const mappings = {
            name: null,
            student_id: null,
            email: null,
            course: null,
            grade: null,
            percentage: null
        };

        const patterns = {
            name: /name|student|full.*name|first.*name|last.*name/i,
            student_id: /id|student.*id|roll|registration|reg|student.*number/i,
            email: /email|e-mail|mail/i,
            course: /course|program|subject|major|degree|department|dept/i,
            grade: /grade|result|class|division|merit|rank/i,
            percentage: /percentage|percent|score|marks|cgpa|gpa|total/i
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
                // Create horizontal landscape certificate - fix extra page issue
                const doc = new PDFDocument({
                    size: 'A4',
                    layout: 'landscape', // Horizontal orientation
                    margins: { top: 30, bottom: 30, left: 40, right: 40 },
                    autoFirstPage: true
                });

                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    resolve(pdfBuffer);
                });

                // Apply elegant template styling
                await this.applyElegantHorizontalTemplate(doc, studentData, template);

                doc.end();

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Apply elegant horizontal template with golden borders
     * @param {PDFDocument} doc - PDF document
     * @param {Object} studentData - Student data
     * @param {Object} template - Template configuration
     */
    static async applyElegantHorizontalTemplate(doc, studentData, template) {
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const margin = 40;
        
        // Elegant color scheme with gold accents
        const colors = {
            gold: '#D4AF37',
            darkGold: '#B8860B',
            navy: '#1B2951',
            darkBlue: '#0F1A2E',
            cream: '#FFF8DC',
            white: '#FFFFFF',
            black: '#000000',
            lightGray: '#F5F5F5'
        };

        // Create elegant border design
        this.drawElegantBorder(doc, colors, pageWidth, pageHeight, margin);
        
        // Add decorative corner elements
        this.drawCornerDecorations(doc, colors, pageWidth, pageHeight, margin);
        
        // Main content area
        const contentWidth = pageWidth - (margin * 4);
        const startX = margin * 2;
        const startY = margin + 60;
        
        // Certificate title with elegant styling
        doc.fontSize(36)
           .fillColor(colors.gold)
           .font('Helvetica-Bold')
           .text('CERTIFICATE OF COMPLETION', startX, startY, {
               width: contentWidth,
               align: 'center'
           });
        
        // Decorative line under title
        const titleY = startY + 50;
        doc.strokeColor(colors.gold)
           .lineWidth(3)
           .moveTo(startX + contentWidth/3, titleY)
           .lineTo(startX + (2 * contentWidth/3), titleY)
           .stroke();
        
        // Institution name with elegant styling - BOLD
        doc.fontSize(20)
           .fillColor(colors.navy)
           .font('Helvetica-Bold')
           .text('National Institute of Technology, Warangal', startX, titleY + 30, {
               width: contentWidth,
               align: 'center'
           });
        
        // Main certificate text
        const mainTextY = titleY + 80;
        doc.fontSize(16)
           .fillColor(colors.black)
           .font('Helvetica')
           .text('This is to certify that', startX, mainTextY, {
               width: contentWidth,
               align: 'center'
           });
        
        // Student name with gold accent and elegant styling
        const nameY = mainTextY + 40;
        doc.fontSize(32)
           .fillColor(colors.darkGold)
           .font('Helvetica-Bold')
           .text(studentData.name || 'Student Name', startX, nameY, {
               width: contentWidth,
               align: 'center'
           });
        
        // Underline for name
        const nameUnderlineY = nameY + 45;
        doc.strokeColor(colors.gold)
           .lineWidth(2)
           .moveTo(startX + contentWidth/4, nameUnderlineY)
           .lineTo(startX + (3 * contentWidth/4), nameUnderlineY)
           .stroke();
        
        // Course information
        if (studentData.course) {
            const courseTextY = nameUnderlineY + 30;
            doc.fontSize(16)
               .fillColor(colors.black)
               .font('Helvetica')
               .text('has successfully completed the course of study in', startX, courseTextY, {
                   width: contentWidth,
                   align: 'center'
               });
            
            doc.fontSize(22)
               .fillColor(colors.navy)
               .font('Helvetica-Bold')
               .text(studentData.course, startX, courseTextY + 30, {
                   width: contentWidth,
                   align: 'center'
               });
        }
        
        // Performance section with elegant boxes
        const performanceY = nameUnderlineY + 120;
        if (studentData.grade || studentData.percentage) {
            // Create elegant performance boxes
            const boxWidth = 140;
            const boxHeight = 50;
            const boxSpacing = 40;
            const totalBoxesWidth = (studentData.grade && studentData.percentage) ? 
                (2 * boxWidth + boxSpacing) : boxWidth;
            const boxStartX = startX + (contentWidth - totalBoxesWidth) / 2;
            
            let currentX = boxStartX;
            
            if (studentData.grade) {
                this.drawPerformanceBox(doc, colors, currentX, performanceY, boxWidth, boxHeight, 
                    'GRADE', studentData.grade);
                currentX += boxWidth + boxSpacing;
            }
            
            if (studentData.percentage) {
                this.drawPerformanceBox(doc, colors, currentX, performanceY, boxWidth, boxHeight, 
                    'SCORE', studentData.percentage);
            }
        }
        
        // Issue date at bottom
        const dateY = pageHeight - margin - 60;
        doc.fontSize(14)
           .fillColor(colors.navy)
           .font('Helvetica')
           .text(`Issued: ${new Date().toLocaleDateString('en-US', {
               year: 'numeric',
               month: 'long',
               day: 'numeric'
           })}`, startX, dateY, {
               width: contentWidth,
               align: 'center'
           });
        
        // Generate certificate hash for QR code
        const certificateHash = studentData.certificateHash || 
            crypto.createHash('sha256')
                .update(JSON.stringify({
                    name: studentData.name,
                    certificateId: studentData.certificateId,
                    course: studentData.course,
                    grade: studentData.grade,
                    percentage: studentData.percentage,
                    issueDate: new Date().toISOString()
                }))
                .digest('hex');

        // Add QR code with certificate hash
        try {
            const qrCodeDataURL = await QRCode.toDataURL(certificateHash, {
                width: 100,
                margin: 1,
                color: {
                    dark: colors.navy,
                    light: '#FFFFFF'
                }
            });
            
            // Convert data URL to buffer for PDFKit
            const qrBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');
            
            // Add QR code to bottom right corner
            doc.image(qrBuffer, pageWidth - margin - 110, pageHeight - margin - 110, {
                width: 100,
                height: 100
            });
            
            // Add QR code label
            doc.fontSize(8)
               .fillColor(colors.navy)
               .font('Helvetica')
               .text('Certificate Hash', pageWidth - margin - 110, pageHeight - margin - 5, {
                   width: 100,
                   align: 'center'
               });
        } catch (qrError) {
            console.warn('Failed to generate QR code:', qrError);
        }

        // Add certificate ID watermark
        if (studentData.certificateId) {
            doc.fontSize(10)
               .fillColor(colors.lightGray)
               .font('Helvetica')
               .text(`Certificate ID: ${studentData.certificateId}`, margin, pageHeight - 25, {
                   align: 'left'
               });
        }
    }
    
    /**
     * Draw elegant golden border
     */
    static drawElegantBorder(doc, colors, pageWidth, pageHeight, margin) {
        // Outer gold border
        doc.lineWidth(4)
           .strokeColor(colors.gold)
           .rect(margin, margin, pageWidth - 2*margin, pageHeight - 2*margin)
           .stroke();
        
        // Inner navy border
        doc.lineWidth(2)
           .strokeColor(colors.navy)
           .rect(margin + 8, margin + 8, pageWidth - 2*margin - 16, pageHeight - 2*margin - 16)
           .stroke();
        
        // Decorative gold inner line
        doc.lineWidth(1)
           .strokeColor(colors.darkGold)
           .rect(margin + 15, margin + 15, pageWidth - 2*margin - 30, pageHeight - 2*margin - 30)
           .stroke();
    }
    
    /**
     * Draw corner decorations
     */
    static drawCornerDecorations(doc, colors, pageWidth, pageHeight, margin) {
        const cornerSize = 25;
        const offset = margin + 20;
        
        // Top-left corner
        doc.fillColor(colors.gold)
           .circle(offset, offset, 3).fill()
           .circle(offset + 10, offset, 2).fill()
           .circle(offset, offset + 10, 2).fill();
        
        // Top-right corner
        doc.circle(pageWidth - offset, offset, 3).fill()
           .circle(pageWidth - offset - 10, offset, 2).fill()
           .circle(pageWidth - offset, offset + 10, 2).fill();
        
        // Bottom-left corner
        doc.circle(offset, pageHeight - offset, 3).fill()
           .circle(offset + 10, pageHeight - offset, 2).fill()
           .circle(offset, pageHeight - offset - 10, 2).fill();
        
        // Bottom-right corner
        doc.circle(pageWidth - offset, pageHeight - offset, 3).fill()
           .circle(pageWidth - offset - 10, pageHeight - offset, 2).fill()
           .circle(pageWidth - offset, pageHeight - offset - 10, 2).fill();
    }
    
    /**
     * Draw performance information boxes
     */
    static drawPerformanceBox(doc, colors, x, y, width, height, label, value) {
        // Box background
        doc.fillColor(colors.cream)
           .rect(x, y, width, height)
           .fill();
        
        // Box border
        doc.strokeColor(colors.gold)
           .lineWidth(2)
           .rect(x, y, width, height)
           .stroke();
        
        // Label
        doc.fontSize(12)
           .fillColor(colors.navy)
           .font('Helvetica-Bold')
           .text(label, x, y + 8, {
               width: width,
               align: 'center'
           });
        
        // Value
        doc.fontSize(16)
           .fillColor(colors.darkGold)
           .font('Helvetica-Bold')
           .text(value, x, y + 25, {
               width: width,
               align: 'center'
           });
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