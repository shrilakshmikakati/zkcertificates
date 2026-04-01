// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./CertificateRegistry.sol";
import "./IVerifier.sol";

/**
 * @dev ZK proof components (Groth16)
 */
struct ZKProof {
    uint[2] a;
    uint[2][2] b;
    uint[2] c;
}

/**
 * @title ZKCertificateSystem
 * @dev Main contract: certificate registry + ZK proof verification.
 *      Deploys on top of CertificateRegistry and calls the IVerifier
 *      contract (PlaceholderVerifier in dev, Groth16Verifier in prod).
 *
 *      FIX: verifyProof calls updated from uint[1] to uint[4] pubSignals
 *      to match nPublic=4 from certificate_simple.circom:
 *        pubSignals[0] = isValid
 *        pubSignals[1] = commitment
 *        pubSignals[2] = minPassingGrade
 *        pubSignals[3] = requireAllPassed
 */
contract ZKCertificateSystem is CertificateRegistry {

    IVerifier public immutable verifier;

    event ZKProofVerified(
        address indexed student,
        uint256 indexed batchId,
        uint256 minPassingGrade,
        bool    allSubjectsPassed
    );

    constructor(address _verifier) CertificateRegistry() {
        require(_verifier != address(0), "Invalid verifier address");
        verifier = IVerifier(_verifier);
    }

    /**
     * @dev Verify academic achievement using a real ZK proof.
     *      The proof must have been generated against certificate_simple.circom.
     *
     * @param proof          Groth16 proof (a, b, c points)
     * @param batchId        On-chain batch the student belongs to
     * @param commitment     Poseidon hash of (studentId, salt, grades) — pubSignals[1]
     * @param minPassingGrade Minimum grade threshold used in the proof — pubSignals[2]
     * @param requiresAllSubjectsPassed Whether all subjects must pass — pubSignals[3]
     */
    function verifyAcademicAchievement(
        ZKProof memory proof,
        uint256 batchId,
        uint256 commitment,
        uint256 minPassingGrade,
        bool    requiresAllSubjectsPassed
    ) external returns (bool) {
        require(batches[batchId].isValid, "Batch is not valid");
        require(minPassingGrade > 0 && minPassingGrade <= 100, "Invalid passing grade");

        // pubSignals layout matches certificate_simple.circom (nPublic = 4):
        //   [0] isValid          — must be 1 for a passing proof
        //   [1] commitment       — Poseidon hash linking proof to student data
        //   [2] minPassingGrade  — publicly committed threshold
        //   [3] requireAllPassed — 0 or 1
        uint[4] memory pubSignals = [
            uint256(1),                              // isValid = 1 (we require passing)
            commitment,
            minPassingGrade,
            requiresAllSubjectsPassed ? 1 : 0
        ];

        bool isValid = verifier.verifyProof(
            proof.a,
            proof.b,
            proof.c,
            pubSignals
        );

        if (isValid) {
            emit ZKProofVerified(
                msg.sender,
                batchId,
                minPassingGrade,
                requiresAllSubjectsPassed
            );
        }

        return isValid;
    }

    /**
     * @dev Verify basic certificate existence (no grade check).
     *      Uses commitment as the only meaningful public signal.
     *
     * @param proof      Groth16 proof
     * @param batchId    On-chain batch the student belongs to
     * @param commitment Poseidon hash of student data
     */
    function verifyBasicCertificate(
        ZKProof memory proof,
        uint256 batchId,
        uint256 commitment
    ) external returns (bool) {
        require(batches[batchId].isValid, "Batch is not valid");

        // For a basic check we pass minPassingGrade=0, requireAllPassed=0
        // isValid=1 means the proof itself is valid
        uint[4] memory pubSignals = [
            uint256(1),  // isValid
            commitment,
            uint256(0),  // minPassingGrade (not checked)
            uint256(0)   // requireAllPassed (not checked)
        ];

        bool isValid = verifier.verifyProof(
            proof.a,
            proof.b,
            proof.c,
            pubSignals
        );

        if (isValid) {
            emit ZKProofVerified(msg.sender, batchId, 0, false);
        }

        return isValid;
    }

    /**
     * @dev Returns total students in a batch (proxy for verification count).
     */
    function getBatchVerificationCount(uint256 batchId)
        external
        view
        returns (uint256)
    {
        require(batches[batchId].merkleRoot != bytes32(0), "Batch does not exist");
        return batches[batchId].totalStudents;
    }
}