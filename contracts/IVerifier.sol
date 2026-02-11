// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/**
 * @title Interface for ZK proof verifier
 * @dev This interface will be implemented by the generated verifier contract
 */
interface IVerifier {
    function verifyProof(
        uint[2] memory _pA,
        uint[2][2] memory _pB,
        uint[2] memory _pC,
        uint[1] memory _publicSignals
    ) external view returns (bool);
}