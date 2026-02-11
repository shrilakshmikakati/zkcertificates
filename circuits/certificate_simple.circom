pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/gates.circom";
include "circomlib/circuits/merkletree.circom";

/**
 * Simple Certificate Verification Circuit
 * Proves academic achievements without revealing actual grades
 */
template CertificateVerifier(nSubjects) {
    // Private inputs
    signal private input studentId;
    signal private input subjects[nSubjects];    // Subject grades (0-100)
    signal private input salt;                   // Random salt
    
    // Public inputs
    signal input minPassingGrade;               // Minimum grade required
    signal input requireAllPassed;             // 1 if all subjects must pass
    
    // Output
    signal output isValid;
    signal output commitment;
    
    // Generate commitment hash
    component hasher = Poseidon(nSubjects + 2);
    hasher.inputs[0] <== studentId;
    hasher.inputs[1] <== salt;
    for (var i = 0; i < nSubjects; i++) {
        hasher.inputs[i + 2] <== subjects[i];
    }
    commitment <== hasher.out;
    
    // Check each subject grade
    component gradeChecks[nSubjects];
    for (var i = 0; i < nSubjects; i++) {
        gradeChecks[i] = GreaterEqThan(8); // 8 bits for 0-255 range
        gradeChecks[i].in[0] <== subjects[i];
        gradeChecks[i].in[1] <== minPassingGrade;
        
        // Ensure grades are in valid range (0-100)
        component rangeCheck = LessEqThan(8);
        rangeCheck.in[0] <== subjects[i];
        rangeCheck.in[1] <== 100;
        rangeCheck.out === 1;
    }
    
    // Calculate if all subjects passed
    var allPassedSignal = 1;
    component andGates[nSubjects-1];
    
    if (nSubjects == 1) {
        allPassedSignal = gradeChecks[0].out;
    } else {
        andGates[0] = AND();
        andGates[0].a <== gradeChecks[0].out;
        andGates[0].b <== gradeChecks[1].out;
        
        for (var i = 1; i < nSubjects-1; i++) {
            andGates[i] = AND();
            andGates[i].a <== andGates[i-1].out;
            andGates[i].b <== gradeChecks[i+1].out;
        }
        allPassedSignal = andGates[nSubjects-2].out;
    }
    
    // Final validation
    component finalCheck = OR();
    component notRequired = NOT();
    component requiredAndPassed = AND();
    
    notRequired.in <== requireAllPassed;
    requiredAndPassed.a <== requireAllPassed;
    requiredAndPassed.b <== allPassedSignal;
    
    finalCheck.a <== notRequired.out;
    finalCheck.b <== requiredAndPassed.out;
    
    isValid <== finalCheck.out;
}

// Main component with 5 subjects
component main = CertificateVerifier(5);