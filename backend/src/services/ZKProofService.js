const snarkjs = require('snarkjs');
const circomlib = require('circomlib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ZKProofService {
    static CIRCUIT_PATH = path.join(__dirname, '../../circuits');
    static KEYS_PATH = path.join(__dirname, '../../keys');

    /**
     * Generate ZK proof for certificate verification
     * @param {Object} input - Input data for proof generation
     * @returns {Object} - Generated proof and public signals
     */
    static async generateProof(input) {
        try {
            const isProduction = process.env.NODE_ENV === 'production';
            // Check if we're in development mode (circuits not compiled)
            const isDevelopmentMode = !this.hasCompiledCircuits();
            
            if (isDevelopmentMode) {
                if (isProduction) {
                    throw new Error('Compiled circuits and proving keys are required in production. Run compile-circuits, setup-ptau, and generate-keys.');
                }
                // Development mode: generate mock proof with real structure
                return this.generateDevelopmentProof(input);
            }

            // Production mode: use real circuits
            const circuitInputs = this.prepareCircuitInputs(input);

            // Paths to circuit files
            const wasmPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
            const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');

            // Generate witness
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                circuitInputs,
                wasmPath,
                zkeyPath
            );

            return {
                proof: this.formatProofForSolidity(proof),
                publicSignals,
                commitment: this.calculateCommitment(input)
            };

        } catch (error) {
            console.error('ZK proof generation error:', error);
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }
            // Fallback to development proof for robustness
            return this.generateDevelopmentProof(input);
        }
    }

    /**
     * Verify ZK proof
     * @param {Object} proof - The proof to verify
     * @param {Array} publicSignals - Public signals
     * @returns {boolean} - True if proof is valid
     */
    static async verifyProof(proof, publicSignals) {
        try {
            const verificationKeyPath = path.join(this.KEYS_PATH, 'verification_key.json');

            if (!fs.existsSync(verificationKeyPath)) {
                throw new Error('Verification key not found');
            }

            const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, 'utf8'));

            // Convert proof format if needed
            const formattedProof = this.formatProofFromSolidity(proof);

            const isValid = await snarkjs.groth16.verify(
                verificationKey,
                publicSignals,
                formattedProof
            );

            return isValid;

        } catch (error) {
            console.error('ZK proof verification error:', error);
            return false;
        }
    }

    /**
     * Initialize the proving system (setup phase)
     * @returns {Object} - Setup result
     */
    static async initializeProvingSystem() {
        try {
            // This is a simplified setup for development
            // In production, you would use a proper ceremony

            const circuitPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.r1cs');
            const ptauPath = path.join(this.KEYS_PATH, 'powersoftau14_final.ptau');
            const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');
            const vkeyPath = path.join(this.KEYS_PATH, 'verification_key.json');

            // Ensure directories exist
            if (!fs.existsSync(this.KEYS_PATH)) {
                fs.mkdirSync(this.KEYS_PATH, { recursive: true });
            }

            // This would typically involve:
            // 1. Powers of tau ceremony
            // 2. Circuit-specific setup
            // 3. Key generation

            console.log('ZK proving system setup initiated...');

            return {
                message: 'Setup process initiated',
                circuitPath,
                keysGenerated: fs.existsSync(zkeyPath)
            };

        } catch (error) {
            throw new Error(`Failed to initialize proving system: ${error.message}`);
        }
    }

    /**
     * Prepare inputs for the circuit
     * @param {Object} rawInput - Raw input data
     * @returns {Object} - Formatted circuit inputs
     */
    static prepareCircuitInputs(rawInput) {
        // Calculate commitment
        const commitment = this.calculateCommitment(rawInput);

        return {
            studentId: this.stringToFieldElement(rawInput.studentId),
            subjects: rawInput.subjects,
            salt: this.stringToFieldElement(rawInput.salt),
            minPassingGrade: rawInput.minPassingGrade,
            requireAllPassed: rawInput.requireAllPassed ? 1 : 0
        };
    }

    /**
     * Calculate commitment from input data
     * @param {Object} input - Input data
     * @returns {string} - Commitment hash
     */
    static calculateCommitment(input) {
        const commitmentData = [
            input.studentId,
            input.salt,
            ...input.subjects
        ].join('|');

        return crypto.createHash('sha256').update(commitmentData).digest('hex');
    }

    /**
     * Convert string to field element for circuit
     * @param {string} str - Input string
     * @returns {string} - Field element
     */
    static stringToFieldElement(str) {
        const hash = crypto.createHash('sha256').update(str).digest('hex');
        // Convert to BN254 field element (modulo p)
        const fieldElement = BigInt('0x' + hash) % BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
        return fieldElement.toString();
    }

    /**
     * Format proof for Solidity contract
     * @param {Object} proof - Raw proof from snarkjs
     * @returns {Object} - Solidity-formatted proof
     */
    static formatProofForSolidity(proof) {
        return {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
            c: [proof.pi_c[0], proof.pi_c[1]]
        };
    }

    /**
     * Format proof from Solidity format to snarkjs format
     * @param {Object} solidityProof - Proof in Solidity format
     * @returns {Object} - snarkjs formatted proof
     */
    static formatProofFromSolidity(solidityProof) {
        return {
            pi_a: [solidityProof.a[0], solidityProof.a[1], "1"],
            pi_b: [[solidityProof.b[0][1], solidityProof.b[0][0]], [solidityProof.b[1][1], solidityProof.b[1][0]], ["1", "0"]],
            pi_c: [solidityProof.c[0], solidityProof.c[1], "1"],
            protocol: "groth16"
        };
    }

    /**
     * Get circuit information
     * @returns {Object} - Circuit information
     */
    static getCircuitInfo() {
        const circuitPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.circom');
        const wasmPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
        const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');

        return {
            circuitExists: fs.existsSync(circuitPath),
            wasmExists: fs.existsSync(wasmPath),
            zkeyExists: fs.existsSync(zkeyPath),
            circuitPath,
            description: 'Certificate verification circuit with 5 subjects',
            constraints: 'Validates academic achievements without revealing grades'
        };
    }

    /**
     * Get verification key for deployment
     * @returns {Object} - Verification key
     */
    static getVerificationKey() {
        const verificationKeyPath = path.join(this.KEYS_PATH, 'verification_key.json');

        if (!fs.existsSync(verificationKeyPath)) {
            throw new Error('Verification key not found. Please setup the proving system first.');
        }

        return JSON.parse(fs.readFileSync(verificationKeyPath, 'utf8'));
    }

    /**
     * Validate proof format
     * @param {Object} proof - Proof to validate
     * @returns {boolean} - True if format is valid
     */
    static validateProofFormat(proof) {
        try {
            return (
                proof &&
                Array.isArray(proof.a) && proof.a.length === 2 &&
                Array.isArray(proof.b) && proof.b.length === 2 &&
                Array.isArray(proof.c) && proof.c.length === 2 &&
                Array.isArray(proof.b[0]) && proof.b[0].length === 2 &&
                Array.isArray(proof.b[1]) && proof.b[1].length === 2
            );
        } catch (error) {
            return false;
        }
    }

    /**
     * Calculate public signal hash for verification
     * @param {Object} publicInputs - Public inputs
     * @returns {string} - Public signal hash
     */
    static calculatePublicSignal(publicInputs) {
        const signalData = [
            publicInputs.minPassingGrade,
            publicInputs.requireAllPassed ? 1 : 0
        ].join('|');

        return crypto.createHash('sha256').update(signalData).digest('hex');
    }

    /**
     * Check if compiled circuits are available
     * @returns {boolean} - True if circuits are compiled and ready
     */
    static hasCompiledCircuits() {
        const wasmPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
        const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');
        const vkeyPath = path.join(this.KEYS_PATH, 'verification_key.json');
        
        return fs.existsSync(wasmPath) && fs.existsSync(zkeyPath) && fs.existsSync(vkeyPath);
    }

    /**
     * Generate development proof for testing without compiled circuits
     * @param {Object} input - Input data
     * @returns {Object} - Mock proof with real structure
     */
    static generateDevelopmentProof(input) {
        console.log('🔧 Development Mode: Generating mock ZK proof with real structure');
        
        // Create realistic-looking proof components
        const mockProof = {
            pi_a: [
                "0x" + crypto.randomBytes(32).toString('hex'),
                "0x" + crypto.randomBytes(32).toString('hex'),
                "0x0000000000000000000000000000000000000000000000000000000000000001"
            ],
            pi_b: [
                [
                    "0x" + crypto.randomBytes(32).toString('hex'),
                    "0x" + crypto.randomBytes(32).toString('hex')
                ],
                [
                    "0x" + crypto.randomBytes(32).toString('hex'),
                    "0x" + crypto.randomBytes(32).toString('hex')
                ],
                [
                    "0x0000000000000000000000000000000000000000000000000000000000000001",
                    "0x0000000000000000000000000000000000000000000000000000000000000000"
                ]
            ],
            pi_c: [
                "0x" + crypto.randomBytes(32).toString('hex'),
                "0x" + crypto.randomBytes(32).toString('hex'),
                "0x0000000000000000000000000000000000000000000000000000000000000001"
            ],
            protocol: "groth16",
            curve: "bn128"
        };

        // Calculate commitment
        const commitment = this.calculateCommitment(input);
        
        // Create public signals based on the commitment
        const publicSignals = [commitment];

        return {
            proof: mockProof,
            publicSignals: publicSignals,
            commitment: commitment,
            isDevelopmentMode: true
        };
    }
}

module.exports = ZKProofService;