// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title CertificateRegistry
 * @dev Smart contract for managing privacy-preserving bulk certificate issuance
 * Only stores Merkle roots on-chain, preserving student privacy
 */
contract CertificateRegistry is Ownable, ReentrancyGuard {
    
    struct BatchInfo {
        bytes32 merkleRoot;
        string institutionName;
        string courseName;
        uint256 graduationYear;
        uint256 totalStudents;
        uint256 timestamp;
        bool isValid;
    }
    
    // Mapping from batch ID to batch information
    mapping(uint256 => BatchInfo) public batches;
    
    // Mapping from institution address to authorized status
    mapping(address => bool) public authorizedInstitutions;
    
    // Counter for batch IDs
    uint256 public nextBatchId;
    
    // Events
    event BatchIssued(
        uint256 indexed batchId,
        bytes32 indexed merkleRoot,
        string institutionName,
        string courseName,
        uint256 graduationYear,
        uint256 totalStudents
    );
    
    event InstitutionAuthorized(address indexed institution, bool authorized);
    event BatchRevoked(uint256 indexed batchId);
    
    // Modifiers
    modifier onlyAuthorized() {
        require(authorizedInstitutions[msg.sender] || msg.sender == owner(), 
                "Not authorized to issue certificates");
        _;
    }
    
    constructor() {
        nextBatchId = 1;
        // Owner is automatically authorized
        authorizedInstitutions[msg.sender] = true;
    }
    
    /**
     * @dev Authorize or revoke institution access
     * @param institution Address of the institution
     * @param authorized Whether the institution is authorized
     */
    function setInstitutionAuthorization(address institution, bool authorized) 
        external 
        onlyOwner 
    {
        authorizedInstitutions[institution] = authorized;
        emit InstitutionAuthorized(institution, authorized);
    }
    
    /**
     * @dev Issue a new batch of certificates
     * @param merkleRoot The Merkle root of all certificates in this batch
     * @param institutionName Name of the issuing institution
     * @param courseName Name of the course/program
     * @param graduationYear Year of graduation
     * @param totalStudents Total number of students in this batch
     */
    function issueBatch(
        bytes32 merkleRoot,
        string memory institutionName,
        string memory courseName,
        uint256 graduationYear,
        uint256 totalStudents
    ) external onlyAuthorized nonReentrant returns (uint256) {
        require(merkleRoot != bytes32(0), "Invalid Merkle root");
        require(bytes(institutionName).length > 0, "Institution name required");
        require(bytes(courseName).length > 0, "Course name required");
        require(graduationYear > 1900 && graduationYear <= 2100, "Invalid graduation year");
        require(totalStudents > 0, "Total students must be greater than 0");
        
        uint256 batchId = nextBatchId++;
        
        batches[batchId] = BatchInfo({
            merkleRoot: merkleRoot,
            institutionName: institutionName,
            courseName: courseName,
            graduationYear: graduationYear,
            totalStudents: totalStudents,
            timestamp: block.timestamp,
            isValid: true
        });
        
        emit BatchIssued(
            batchId,
            merkleRoot,
            institutionName,
            courseName,
            graduationYear,
            totalStudents
        );
        
        return batchId;
    }
    
    /**
     * @dev Verify a certificate using Merkle proof
     * @param batchId The batch ID containing the certificate
     * @param certificateHash Hash of the certificate data
     * @param merkleProof Merkle proof for the certificate
     */
    function verifyCertificate(
        uint256 batchId,
        bytes32 certificateHash,
        bytes32[] memory merkleProof
    ) external view returns (bool) {
        require(batches[batchId].isValid, "Batch is not valid");
        
        return MerkleProof.verify(
            merkleProof,
            batches[batchId].merkleRoot,
            certificateHash
        );
    }
    
    /**
     * @dev Revoke a batch of certificates (emergency use only)
     * @param batchId The batch ID to revoke
     */
    function revokeBatch(uint256 batchId) external onlyAuthorized {
        require(batches[batchId].merkleRoot != bytes32(0), "Batch does not exist");
        batches[batchId].isValid = false;
        emit BatchRevoked(batchId);
    }
    
    /**
     * @dev Get batch information
     * @param batchId The batch ID to query
     */
    function getBatchInfo(uint256 batchId) external view returns (
        bytes32 merkleRoot,
        string memory institutionName,
        string memory courseName,
        uint256 graduationYear,
        uint256 totalStudents,
        uint256 timestamp,
        bool isValid
    ) {
        BatchInfo memory batch = batches[batchId];
        return (
            batch.merkleRoot,
            batch.institutionName,
            batch.courseName,
            batch.graduationYear,
            batch.totalStudents,
            batch.timestamp,
            batch.isValid
        );
    }
    
    /**
     * @dev Get total number of batches issued
     */
    function getTotalBatches() external view returns (uint256) {
        return nextBatchId - 1;
    }
}