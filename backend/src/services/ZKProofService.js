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
            // Prepare circuit inputs
            const circuitInputs = this.prepareCircuitInputs(input);

            // Paths to circuit files
            const wasmPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
            const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');

            // Check if required files exist
            if (!fs.existsSync(wasmPath)) {
                throw new Error('Circuit WASM file not found. Please compile the circuit first.');
            }

            if (!fs.existsSync(zkeyPath)) {
                throw new Error('Circuit proving key not found. Please setup the proving system first.');
            }

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
            throw new Error(`Failed to generate ZK proof: ${error.message}`);
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
}

module.exports = ZKProofService;