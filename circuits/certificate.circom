pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/gates.circom";

/**
 * Certificate Verification Circuit
 * Proves that:
 * 1. Student has a valid certificate in the Merkle tree
 * 2. Academic criteria are met without revealing actual grades
 */
template CertificateVerification(nLevels, nSubjects) {
    // Private inputs (kept secret)
    signal private input studentId;
    signal private input subjects[nSubjects];        // Subject grades (0-100)
    signal private input salt;                       // Random salt for commitment
    signal private input merkleProofSiblings[nLevels]; // Merkle proof siblings
    signal private input merkleProofPathIndices[nLevels]; // Path indices (0 or 1)
    
    // Public inputs (revealed on-chain)
    signal input merkleRoot;                         // Merkle root from blockchain
    signal input minPassingGrade;                   // Minimum grade for passing (0-100)
    signal input requireAllPassed;                  // 1 if all subjects must pass, 0 otherwise
    
    // Outputs
    signal output isValid;                          // 1 if verification passes, 0 otherwise
    
    // Component declarations
    component merkleVerifier = GetMerkleRoot(nLevels);
    component studentHash = Poseidon(nSubjects + 2); // subjects + studentId + salt
    component gradeChecks[nSubjects];
    component allPassedCheck;
    component finalValidation;
    
    // Generate individual grade comparison circuits
    for (var i = 0; i < nSubjects; i++) {
        gradeChecks[i] = GreaterEqThan(8); // 8 bits for grades 0-100
        gradeChecks[i].in[0] <== subjects[i];
        gradeChecks[i].in[1] <== minPassingGrade;
    }
    
    // Check if all subjects passed (if required)
    allPassedCheck = AllPassedGates(nSubjects);
    for (var i = 0; i < nSubjects; i++) {
        allPassedCheck.in[i] <== gradeChecks[i].out;
    }
    
    // Generate student commitment hash
    studentHash.inputs[0] <== studentId;
    studentHash.inputs[1] <== salt;
    for (var i = 0; i < nSubjects; i++) {
        studentHash.inputs[i + 2] <== subjects[i];
    }
    
    // Verify Merkle proof
    merkleVerifier.leaf <== studentHash.out;
    for (var i = 0; i < nLevels; i++) {
        merkleVerifier.pathElements[i] <== merkleProof[i];
    }
    merkleVerifier.pathIndices <== merkleIndex;
    
    // Verify merkle root matches
    component rootCheck = IsEqual();
    rootCheck.in[0] <== merkleVerifier.out;
    rootCheck.in[1] <== merkleRoot;
    
    // Final validation logic
    finalValidation = FinalValidation();
    finalValidation.merkleValid <== rootCheck.out;
    finalValidation.allPassed <== allPassedCheck.out;
    finalValidation.requireAllPassed <== requireAllPassed;
    
    // Set outputs
    isValid <== finalValidation.out;
    publicCommitment <== studentHash.out;
    
    // Constraints to prevent cheating
    // Ensure grades are in valid range (0-100)
    for (var i = 0; i < nSubjects; i++) {
        component gradeRange = LessEqThan(8);
        gradeRange.in[0] <== subjects[i];
        gradeRange.in[1] <== 100;
        gradeRange.out === 1;
    }
    
    // Ensure minimum passing grade is valid
    component minGradeRange = LessEqThan(8);
    minGradeRange.in[0] <== minPassingGrade;
    minGradeRange.in[1] <== 100;
    minGradeRange.out === 1;
}

/**
 * Helper template to check if all subjects passed
 */
template AllPassedGates(n) {
    signal input in[n];
    signal output out;
    
    if (n == 1) {
        out <== in[0];
    } else {
        component and_gate = AND();
        component sub_check = AllPassedGates(n - 1);
        
        for (var i = 0; i < n - 1; i++) {
            sub_check.in[i] <== in[i];
        }
        
        and_gate.a <== sub_check.out;
        and_gate.b <== in[n - 1];
        out <== and_gate.out;
    }
}

/**
 * Final validation logic template
 */
template FinalValidation() {
    signal input merkleValid;
    signal input allPassed;
    signal input requireAllPassed;
    signal output out;
    
    // If requireAllPassed is 1, then allPassed must be 1
    // If requireAllPassed is 0, then we don't care about allPassed
    component validator = OR();
    component notRequireAll = NOT();
    component andGate = AND();
    
    notRequireAll.in <== requireAllPassed;
    andGate.a <== requireAllPassed;
    andGate.b <== allPassed;
    
    validator.a <== notRequireAll.out;
    validator.b <== andGate.out;
    
    // Final output requires both merkle proof valid and grade criteria met
    component finalAnd = AND();
    finalAnd.a <== merkleValid;
    finalAnd.b <== validator.out;
    
    out <== finalAnd.out;
}

/**
 * Main component instantiation
 * Configuration: 10 levels for Merkle tree, 5 subjects
 */
component main = CertificateVerification(10, 5);