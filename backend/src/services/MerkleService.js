const { MerkleTree } = require('merkletreejs');
const crypto = require('crypto');

class MerkleService {
    /**
     * Build Merkle tree from certificate commitments
     * @param {Array} certificates - Array of certificate objects with commitments
     * @returns {MerkleTree} - Constructed Merkle tree
     */
    static buildMerkleTree(certificates) {
        if (!certificates || certificates.length === 0) {
            throw new Error('Cannot build Merkle tree from empty certificates array');
        }

        // Extract commitment hashes as leaves
        const leaves = certificates.map(cert => {
            if (!cert.commitment) {
                throw new Error('Certificate missing commitment hash');
            }
            return Buffer.from(cert.commitment, 'hex');
        });

        // Create Merkle tree using SHA-256
        const merkleTree = new MerkleTree(leaves, crypto.createHash, {
            hashLeaves: false, // Leaves are already hashed
            sortPairs: true,   // Sort pairs for consistent tree structure
            duplicateOdd: true // Duplicate odd nodes to balance tree
        });

        return merkleTree;
    }

    /**
     * Generate Merkle proof for a specific certificate
     * @param {MerkleTree} merkleTree - The Merkle tree
     * @param {string} commitmentHash - The certificate commitment hash
     * @returns {Array} - Array of proof hashes
     */
    static generateMerkleProof(merkleTree, commitmentHash) {
        const leaf = Buffer.from(commitmentHash, 'hex');
        const proof = merkleTree.getProof(leaf);

        return proof.map(element => ({
            data: element.data.toString('hex'),
            position: element.position
        }));
    }

    /**
     * Verify Merkle proof
     * @param {string} commitmentHash - The certificate commitment hash
     * @param {Array} proof - Array of proof elements
     * @param {string} merkleRoot - The Merkle root to verify against
     * @returns {boolean} - True if proof is valid
     */
    static verifyProof(commitmentHash, proof, merkleRoot) {
        try {
            const leaf = Buffer.from(commitmentHash, 'hex');
            const root = Buffer.from(merkleRoot.replace('0x', ''), 'hex');

            // Convert proof format
            const proofElements = proof.map(element => ({
                data: Buffer.from(element.replace('0x', ''), 'hex'),
                position: 'left' // This would need position info in real implementation
            }));

            return MerkleTree.verify(proofElements, leaf, root, crypto.createHash);
        } catch (error) {
            console.error('Merkle proof verification error:', error);
            return false;
        }
    }

    /**
     * Get Merkle tree statistics
     * @param {MerkleTree} merkleTree - The Merkle tree
     * @returns {Object} - Tree statistics
     */
    static getTreeStats(merkleTree) {
        const leaves = merkleTree.getLeaves();
        const layers = merkleTree.getLayers();

        return {
            totalLeaves: leaves.length,
            treeDepth: layers.length - 1, // Exclude leaf layer
            merkleRoot: merkleTree.getRoot().toString('hex'),
            totalNodes: layers.reduce((sum, layer) => sum + layer.length, 0)
        };
    }

    /**
     * Rebuild tree with additional certificates
     * @param {MerkleTree} existingTree - Existing Merkle tree
     * @param {Array} newCertificates - New certificates to add
     * @returns {MerkleTree} - New Merkle tree with all certificates
     */
    static addCertificatesToTree(existingTree, newCertificates) {
        const existingLeaves = existingTree.getLeaves();
        const newLeaves = newCertificates.map(cert =>
            Buffer.from(cert.commitment, 'hex')
        );

        const allLeaves = [...existingLeaves, ...newLeaves];

        return new MerkleTree(allLeaves, crypto.createHash, {
            hashLeaves: false,
            sortPairs: true,
            duplicateOdd: true
        });
    }

    /**
     * Generate batch summary from Merkle tree
     * @param {MerkleTree} merkleTree - The Merkle tree
     * @param {Array} certificates - Original certificate data
     * @returns {Object} - Batch summary
     */
    static generateBatchSummary(merkleTree, certificates) {
        const stats = this.getTreeStats(merkleTree);

        // Calculate grade statistics
        const allGrades = certificates.flatMap(cert => cert.subjects);
        const averageGrade = allGrades.reduce((sum, grade) => sum + grade, 0) / allGrades.length;

        const passedStudents = certificates.filter(cert => {
            const studentAverage = cert.subjects.reduce((sum, grade) => sum + grade, 0) / cert.subjects.length;
            return studentAverage >= 40; // Assuming 40% is passing
        }).length;

        return {
            merkleRoot: stats.merkleRoot,
            totalStudents: certificates.length,
            treeDepth: stats.treeDepth,
            totalNodes: stats.totalNodes,
            averageGrade: Math.round(averageGrade * 100) / 100,
            passedStudents,
            passRate: Math.round((passedStudents / certificates.length) * 100),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Export tree data for backup/storage
     * @param {MerkleTree} merkleTree - The Merkle tree
     * @param {Array} certificates - Certificate data
     * @returns {Object} - Exportable tree data
     */
    static exportTreeData(merkleTree, certificates) {
        return {
            merkleRoot: merkleTree.getRoot().toString('hex'),
            leaves: merkleTree.getLeaves().map(leaf => leaf.toString('hex')),
            certificates: certificates.map(cert => ({
                studentId: cert.studentId,
                commitment: cert.commitment,
                proof: this.generateMerkleProof(merkleTree, cert.commitment)
            })),
            metadata: {
                totalCertificates: certificates.length,
                createdAt: new Date().toISOString(),
                version: '1.0.0'
            }
        };
    }

    /**
     * Import and reconstruct tree from exported data
     * @param {Object} treeData - Exported tree data
     * @returns {MerkleTree} - Reconstructed Merkle tree
     */
    static importTreeData(treeData) {
        if (!treeData.leaves || !Array.isArray(treeData.leaves)) {
            throw new Error('Invalid tree data: missing or invalid leaves');
        }

        const leaves = treeData.leaves.map(leafHex => Buffer.from(leafHex, 'hex'));

        const reconstructedTree = new MerkleTree(leaves, crypto.createHash, {
            hashLeaves: false,
            sortPairs: true,
            duplicateOdd: true
        });

        // Verify reconstructed tree matches original root
        const reconstructedRoot = reconstructedTree.getRoot().toString('hex');
        if (reconstructedRoot !== treeData.merkleRoot) {
            throw new Error('Tree reconstruction failed: root mismatch');
        }

        return reconstructedTree;
    }
}

module.exports = MerkleService;