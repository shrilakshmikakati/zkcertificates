// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./CertificateRegistry.sol";
import "./IVerifier.sol";

/**
 * @title ZKCertificateSystem
 * @dev Main contract that combines certificate registry with ZK proof verification
 * Allows privacy-preserving verification of academic achievements
 */
contract ZKCertificateSystem is CertificateRegistry {
    
    // ZK proof verifier contract
    IVerifier public immutable verifier;
    
    struct ZKVerificationRequest {
        uint256 batchId;
        uint256 minPassingGrade;
        bool requiresAllSubjectsPassed;
    }
    
    // Events for ZK verification
    event ZKProofVerified(
        address indexed student,
        uint256 indexed batchId,
        uint256 minPassingGrade,
        bool allSubjectsPassed
    );
    
    constructor(address _verifier) {
        require(_verifier != address(0), "Invalid verifier address");
        verifier = IVerifier(_verifier);
    }
    
    /**
     * @dev Verify academic achievement using ZK proof
     * @param proof The ZK proof components
     * @param batchId The batch ID containing the student's certificate
     * @param minPassingGrade Minimum grade required for verification
     * @param requiresAllSubjectsPassed Whether all subjects must be passed
     */
    function verifyAcademicAchievement(
        ZKProof memory proof,
        uint256 batchId,
        uint256 minPassingGrade,
        bool requiresAllSubjectsPassed
    ) external returns (bool) {
        require(batches[batchId].isValid, "Batch is not valid");
        require(minPassingGrade > 0 && minPassingGrade <= 100, "Invalid passing grade");
        
        // The public signal will be the hash of the verification criteria
        uint256 publicSignal = uint256(keccak256(abi.encodePacked(
            batchId,
            minPassingGrade,
            requiresAllSubjectsPassed
        ))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617; // BN254 field size
        
        uint[1] memory publicSignals = [publicSignal];
        
        bool isValid = verifier.verifyProof(
            proof.a,
            proof.b,
            proof.c,
            publicSignals
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
     * @dev Verify certificate existence and basic criteria without revealing grades
     * @param proof The ZK proof components
     * @param batchId The batch ID containing the certificate
     */
    function verifyBasicCertificate(
        ZKProof memory proof,
        uint256 batchId
    ) external returns (bool) {
        require(batches[batchId].isValid, "Batch is not valid");
        
        // Public signal is just the batch ID
        uint[1] memory publicSignals = [batchId];
        
        bool isValid = verifier.verifyProof(
            proof.a,
            proof.b,
            proof.c,
            publicSignals
        );
        
        if (isValid) {
            emit ZKProofVerified(msg.sender, batchId, 0, false);
        }
        
        return isValid;
    }
    
    /**
     * @dev Get verification statistics for a batch
     * @param batchId The batch ID to query
     */
    function getBatchVerificationCount(uint256 batchId) external view returns (uint256) {
        // This would require additional state tracking in a production system
        // For now, returning batch info
        require(batches[batchId].merkleRoot != bytes32(0), "Batch does not exist");
        return batches[batchId].totalStudents;
    }
}

/**
 * @dev Structure for ZK proof components
 */
struct ZKProof {
    uint[2] a;
    uint[2][2] b;
    uint[2] c;
}