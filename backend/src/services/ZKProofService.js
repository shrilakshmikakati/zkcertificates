const snarkjs = require('snarkjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ZKProofService {
    static CIRCUIT_PATH = path.join(__dirname, '../../circuits');
    static KEYS_PATH = path.join(__dirname, '../../keys');

    // Configurable batch size to avoid ERR_INSUFFICIENT_RESOURCES.
    // Increase if your server has more RAM/CPU. Keep <= 50 for typical servers.
    static BATCH_SIZE = parseInt(process.env.ZK_BATCH_SIZE || '25', 10);

    /**
     * Generate a real ZK proof for one certificate.
     * Requires compiled circuit files — see README for setup steps.
     *
     * @param {Object} input
     * @returns {{ proof, publicSignals, commitment }}
     */
    static async generateProof(input) {
        if (!this.hasCompiledCircuits()) {
            throw new Error(
                'ZK circuit files not found. Cannot generate proof.\n' +
                'Run these commands before using the system:\n' +
                '  npm run compile-circuits\n' +
                '  npm run setup-ptau\n' +
                '  npm run generate-keys\n' +
                `Expected:\n` +
                `  WASM : ${path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm')}\n` +
                `  ZKEY : ${path.join(this.KEYS_PATH, 'certificate_simple.zkey')}\n` +
                `  VKEY : ${path.join(this.KEYS_PATH, 'verification_key.json')}`
            );
        }

        const circuitInputs = this.prepareCircuitInputs(input);
        const wasmPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
        const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');

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
    }

    /**
     * Generate ZK proofs for a batch of certificates.
     * Processes in BATCH_SIZE chunks to avoid resource exhaustion.
     *
     * @param {Array<Object>} inputs
     * @returns {Array<{ studentId, status, zkProof?, error? }>}
     */
    static async generateBatchProofs(inputs) {
        if (!Array.isArray(inputs) || inputs.length === 0) return [];

        // Fail fast — no point iterating if circuits are missing
        if (!this.hasCompiledCircuits()) {
            const msg =
                'ZK circuit files are missing. Run: npm run compile-circuits && ' +
                'npm run setup-ptau && npm run generate-keys';
            return inputs.map(input => ({
                studentId: input.studentId,
                status: 'failed',
                error: msg
            }));
        }

        const results = [];
        const total = inputs.length;

        console.log(`\nStarting batch ZK proof generation for ${total} certificates (chunk size: ${this.BATCH_SIZE})`);

        for (let offset = 0; offset < total; offset += this.BATCH_SIZE) {
            const chunk = inputs.slice(offset, offset + this.BATCH_SIZE);
            const chunkNum = Math.floor(offset / this.BATCH_SIZE) + 1;
            const totalChunks = Math.ceil(total / this.BATCH_SIZE);

            console.log(`  Processing chunk ${chunkNum}/${totalChunks} (certs ${offset + 1}-${Math.min(offset + this.BATCH_SIZE, total)})`);

            // Sequential within each chunk — avoids opening too many concurrent snarkjs workers
            for (const input of chunk) {
                try {
                    const proofResult = await this.generateProof(input);
                    results.push({
                        studentId: input.studentId,
                        status: 'success',
                        zkProof: proofResult
                    });
                } catch (err) {
                    console.error(`  Proof failed for studentId ${input.studentId}: ${err.message}`);
                    results.push({
                        studentId: input.studentId,
                        status: 'failed',
                        error: err.message
                    });
                }
            }

            // Brief pause between chunks so the GC can reclaim memory
            if (offset + this.BATCH_SIZE < total) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        const succeeded = results.filter(r => r.status === 'success').length;
        const failed    = results.filter(r => r.status === 'failed').length;
        console.log(`Batch complete: ${succeeded} succeeded, ${failed} failed out of ${total}\n`);

        return results;
    }

    /**
     * Verify a ZK proof against the stored verification key.
     */
    static async verifyProof(proof, publicSignals) {
        const verificationKeyPath = path.join(this.KEYS_PATH, 'verification_key.json');
        if (!fs.existsSync(verificationKeyPath)) {
            throw new Error('Verification key not found. Run: npm run generate-keys');
        }
        const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, 'utf8'));
        const formattedProof  = this.formatProofFromSolidity(proof);
        return snarkjs.groth16.verify(verificationKey, publicSignals, formattedProof);
    }

    /**
     * Initialize the proving system (setup phase — run once before first use).
     */
    static async initializeProvingSystem() {
        const circuitPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.r1cs');
        const ptauPath    = path.join(this.KEYS_PATH, 'powersoftau14_final.ptau');
        const zkeyPath    = path.join(this.KEYS_PATH, 'certificate_simple.zkey');

        if (!fs.existsSync(this.KEYS_PATH)) {
            fs.mkdirSync(this.KEYS_PATH, { recursive: true });
        }

        if (!fs.existsSync(circuitPath)) {
            throw new Error(`Circuit R1CS not found at ${circuitPath}. Run: npm run compile-circuits`);
        }
        if (!fs.existsSync(ptauPath)) {
            throw new Error(`Powers-of-Tau file not found at ${ptauPath}. Run: npm run setup-ptau`);
        }

        console.log('ZK proving system setup initiated...');
        return {
            message: 'Setup process initiated',
            circuitPath,
            keysGenerated: fs.existsSync(zkeyPath)
        };
    }

    // ─── Circuit input helpers ───────────────────────────────────────────────

    static prepareCircuitInputs(rawInput) {
        return {
            studentId:        this.stringToFieldElement(rawInput.studentId),
            subjects:         rawInput.subjects,
            salt:             this.stringToFieldElement(rawInput.salt),
            minPassingGrade:  rawInput.minPassingGrade,
            requireAllPassed: rawInput.requireAllPassed ? 1 : 0
        };
    }

    static calculateCommitment(input) {
        const commitmentData = [input.studentId, input.salt, ...input.subjects].join('|');
        return crypto.createHash('sha256').update(commitmentData).digest('hex');
    }

    static stringToFieldElement(str) {
        const hash = crypto.createHash('sha256').update(str).digest('hex');
        const fieldElement = BigInt('0x' + hash) %
            BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
        return fieldElement.toString();
    }

    // ─── Proof format converters (snarkjs <-> Solidity) ─────────────────────

    static formatProofForSolidity(proof) {
        return {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ],
            c: [proof.pi_c[0], proof.pi_c[1]]
        };
    }

    static formatProofFromSolidity(solidityProof) {
        return {
            pi_a: [solidityProof.a[0], solidityProof.a[1], '1'],
            pi_b: [
                [solidityProof.b[0][1], solidityProof.b[0][0]],
                [solidityProof.b[1][1], solidityProof.b[1][0]],
                ['1', '0']
            ],
            pi_c: [solidityProof.c[0], solidityProof.c[1], '1'],
            protocol: 'groth16'
        };
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    /**
     * Returns true only when all three compiled circuit artifacts are present.
     */
    static hasCompiledCircuits() {
        const wasmPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
        const zkeyPath = path.join(this.KEYS_PATH, 'certificate_simple.zkey');
        const vkeyPath = path.join(this.KEYS_PATH, 'verification_key.json');
        return fs.existsSync(wasmPath) && fs.existsSync(zkeyPath) && fs.existsSync(vkeyPath);
    }

    static getCircuitInfo() {
        const circuitPath = path.join(this.CIRCUIT_PATH, 'certificate_simple.circom');
        const wasmPath    = path.join(this.CIRCUIT_PATH, 'certificate_simple.wasm');
        const zkeyPath    = path.join(this.KEYS_PATH, 'certificate_simple.zkey');
        return {
            circuitsReady:  this.hasCompiledCircuits(),
            circuitExists:  fs.existsSync(circuitPath),
            wasmExists:     fs.existsSync(wasmPath),
            zkeyExists:     fs.existsSync(zkeyPath),
            circuitPath,
            batchSize:      this.BATCH_SIZE,
            description:    'Certificate verification circuit with 5 subjects',
            constraints:    'Validates academic achievements without revealing grades'
        };
    }

    static getVerificationKey() {
        const verificationKeyPath = path.join(this.KEYS_PATH, 'verification_key.json');
        if (!fs.existsSync(verificationKeyPath)) {
            throw new Error('Verification key not found. Run: npm run generate-keys');
        }
        return JSON.parse(fs.readFileSync(verificationKeyPath, 'utf8'));
    }

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
        } catch {
            return false;
        }
    }

    static calculatePublicSignal(publicInputs) {
        const signalData = [
            publicInputs.minPassingGrade,
            publicInputs.requireAllPassed ? 1 : 0
        ].join('|');
        return crypto.createHash('sha256').update(signalData).digest('hex');
    }
}

module.exports = ZKProofService;