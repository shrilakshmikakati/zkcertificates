const crypto = require('crypto');
const { MerkleTree } = require('merkletreejs');

/**
 * Utility functions for certificate processing
 */
class CertificateUtils {
    /**
     * Generate secure random salt
     * @param {number} length - Salt length in bytes
     * @returns {string} - Hex encoded salt
     */
    static generateSalt(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    /**
     * Hash student data for commitment
     * @param {Object} studentData - Student information
     * @param {string} salt - Random salt
     * @returns {string} - Commitment hash
     */
    static hashStudentData(studentData, salt) {
        const dataString = [
            studentData.studentId,
            salt,
            ...studentData.subjects
        ].join('|');

        return crypto.createHash('sha256').update(dataString).digest('hex');
    }

    /**
     * Validate CSV row structure
     * @param {Object} row - CSV row data
     * @returns {boolean} - True if valid
     */
    static validateCSVRow(row) {
        const required = ['studentId', 'studentName', 'email', 'subject1', 'subject2', 'subject3', 'subject4', 'subject5'];
        return required.every(field => row.hasOwnProperty(field) && row[field] !== '');
    }

    /**
     * Calculate grade statistics
     * @param {Array} grades - Array of grade arrays
     * @returns {Object} - Statistics object
     */
    static calculateStatistics(grades) {
        const allScores = grades.flat();
        const total = allScores.length;
        const sum = allScores.reduce((a, b) => a + b, 0);
        const average = sum / total;
        const sorted = allScores.sort((a, b) => a - b);

        return {
            total,
            average: Math.round(average * 100) / 100,
            min: sorted[0],
            max: sorted[total - 1],
            median: total % 2 === 0
                ? (sorted[total / 2 - 1] + sorted[total / 2]) / 2
                : sorted[Math.floor(total / 2)],
            standardDeviation: Math.sqrt(
                allScores.reduce((sum, score) => sum + Math.pow(score - average, 2), 0) / total
            )
        };
    }

    /**
     * Generate batch ID from institution and timestamp
     * @param {string} institutionName - Institution name
     * @param {number} timestamp - Timestamp
     * @returns {string} - Batch ID
     */
    static generateBatchId(institutionName, timestamp = Date.now()) {
        const hash = crypto
            .createHash('sha256')
            .update(`${institutionName}-${timestamp}`)
            .digest('hex');
        return hash.substring(0, 16);
    }

    /**
     * Validate Ethereum address format
     * @param {string} address - Ethereum address
     * @returns {boolean} - True if valid
     */
    static isValidEthereumAddress(address) {
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    /**
     * Format proof for smart contract interaction
     * @param {Object} proof - Raw proof from snarkjs
     * @returns {Object} - Formatted proof
     */
    static formatProofForContract(proof) {
        return {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
            c: [proof.pi_c[0], proof.pi_c[1]]
        };
    }

    /**
     * Generate QR code data for certificate verification
     * @param {Object} certificateData - Certificate information
     * @returns {string} - QR code data
     */
    static generateQRCodeData(certificateData) {
        return JSON.stringify({
            type: 'zk_certificate',
            batchId: certificateData.batchId,
            merkleRoot: certificateData.merkleRoot,
            commitment: certificateData.commitment,
            verificationUrl: process.env.VERIFICATION_URL || 'http://localhost:3000/verify',
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Validate proof format
     * @param {Object} proof - Proof object
     * @returns {boolean} - True if valid format
     */
    static validateProofFormat(proof) {
        return (
            proof &&
            Array.isArray(proof.a) && proof.a.length === 2 &&
            Array.isArray(proof.b) && proof.b.length === 2 &&
            Array.isArray(proof.c) && proof.c.length === 2 &&
            Array.isArray(proof.b[0]) && proof.b[0].length === 2 &&
            Array.isArray(proof.b[1]) && proof.b[1].length === 2 &&
            proof.a.every(x => typeof x === 'string') &&
            proof.b.every(row => row.every(x => typeof x === 'string')) &&
            proof.c.every(x => typeof x === 'string')
        );
    }

    /**
     * Convert string to field element (for circuit inputs)
     * @param {string} str - Input string
     * @returns {string} - Field element as string
     */
    static stringToFieldElement(str) {
        const hash = crypto.createHash('sha256').update(str).digest('hex');
        // Convert to BN254 field modulus
        const fieldModulus = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
        const element = BigInt('0x' + hash) % fieldModulus;
        return element.toString();
    }

    /**
     * Estimate gas costs for batch operations
     * @param {number} batchSize - Number of certificates in batch
     * @returns {Object} - Gas estimates
     */
    static estimateGasCosts(batchSize) {
        // These are rough estimates based on contract operations
        const baseCost = 21000; // Base transaction cost
        const registryDeployment = 500000; // Deploy registry
        const batchIssuance = 80000 + (batchSize * 100); // Issue batch
        const verification = 25000; // Single verification

        return {
            registryDeployment,
            batchIssuance,
            verification,
            totalForBatch: baseCost + batchIssuance,
            savingsVsIndividual: (baseCost * batchSize) - (baseCost + batchIssuance)
        };
    }

    /**
     * Generate certificate template data
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

        const sampleRows = [
            ['STU001', 'Alice Johnson', 'alice.johnson@university.edu', '88', '92', '85', '90', '87'],
            ['STU002', 'Bob Smith', 'bob.smith@university.edu', '76', '84', '79', '82', '88'],
            ['STU003', 'Carol Davis', 'carol.davis@university.edu', '94', '89', '91', '95', '92'],
            ['STU004', 'David Wilson', 'david.wilson@university.edu', '82', '87', '84', '89', '86'],
            ['STU005', 'Emma Brown', 'emma.brown@university.edu', '91', '88', '93', '87', '90']
        ];

        let csvContent = headers.join(',') + '\n';
        sampleRows.forEach(row => {
            csvContent += row.join(',') + '\n';
        });

        return csvContent;
    }

    /**
     * Parse and validate uploaded CSV file
     * @param {string} csvContent - Raw CSV content
     * @returns {Array} - Parsed and validated student data
     */
    static parseCSVContent(csvContent) {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV must contain at least header and one data row');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const requiredHeaders = ['studentId', 'studentName', 'email', 'subject1', 'subject2', 'subject3', 'subject4', 'subject5'];

        // Validate headers
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        if (missingHeaders.length > 0) {
            throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
        }

        const students = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length !== headers.length) {
                throw new Error(`Row ${i} has ${values.length} values, expected ${headers.length}`);
            }

            const studentData = {};
            headers.forEach((header, index) => {
                studentData[header] = values[index];
            });

            // Validate and convert numeric fields
            ['subject1', 'subject2', 'subject3', 'subject4', 'subject5'].forEach(subject => {
                const grade = parseFloat(studentData[subject]);
                if (isNaN(grade) || grade < 0 || grade > 100) {
                    throw new Error(`Invalid grade for ${studentData.studentId} in ${subject}: ${studentData[subject]}`);
                }
                studentData[subject] = grade;
            });

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(studentData.email)) {
                throw new Error(`Invalid email format for student ${studentData.studentId}: ${studentData.email}`);
            }

            students.push(studentData);
        }

        return students;
    }
}

module.exports = CertificateUtils;