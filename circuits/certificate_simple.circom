pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/gates.circom";

/**
 * Simple Certificate Verification Circuit
 * Proves academic achievements without revealing actual grades
 */
template CertificateVerifier(nSubjects) {
    signal input studentId;
    signal input subjects[nSubjects];
    signal input salt;
    signal input minPassingGrade;
    signal input requireAllPassed;

    signal output isValid;
    signal output commitment;

    component hasher = Poseidon(nSubjects + 2);
    hasher.inputs[0] <== studentId;
    hasher.inputs[1] <== salt;
    for (var i = 0; i < nSubjects; i++) {
        hasher.inputs[i + 2] <== subjects[i];
    }
    commitment <== hasher.out;

    component gradeChecks[nSubjects];
    component rangeChecks[nSubjects];
    signal allPassedProduct[nSubjects + 1];
    allPassedProduct[0] <== 1;

    for (var i = 0; i < nSubjects; i++) {
        gradeChecks[i] = GreaterEqThan(8);
        gradeChecks[i].in[0] <== subjects[i];
        gradeChecks[i].in[1] <== minPassingGrade;

        rangeChecks[i] = LessEqThan(8);
        rangeChecks[i].in[0] <== subjects[i];
        rangeChecks[i].in[1] <== 100;
        rangeChecks[i].out === 1;

        allPassedProduct[i + 1] <== allPassedProduct[i] * gradeChecks[i].out;
    }

    requireAllPassed * (requireAllPassed - 1) === 0;

    component minGradeRange = LessEqThan(8);
    minGradeRange.in[0] <== minPassingGrade;
    minGradeRange.in[1] <== 100;
    minGradeRange.out === 1;

    isValid <== (1 - requireAllPassed) + (requireAllPassed * allPassedProduct[nSubjects]);
}

// Main component with 5 subjects
component main {public [minPassingGrade, requireAllPassed]} = CertificateVerifier(5);