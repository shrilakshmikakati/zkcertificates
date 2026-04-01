// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IVerifier.sol";

/**
 * @title PlaceholderVerifier
 * @dev Stand-in verifier for development/testnet.
 *      Safe to deploy on zkSync Sepolia (chainId 300), Ganache (1337),
 *      or Hardhat (31337). Always returns true for non-zero proofs.
 *
 *      Replace with the snarkjs-generated Groth16Verifier once circuits
 *      are finalised for production.
 *
 *      FIX: signature updated from uint[1] to uint[4] to match IVerifier
 *      and the actual nPublic=4 from certificate_simple.circom.
 */
contract PlaceholderVerifier is IVerifier {
    constructor() {
        require(
            block.chainid == 1337 ||
            block.chainid == 31337 ||
            block.chainid == 300,
            "PlaceholderVerifier: unsupported network"
        );
    }

    /**
     * @dev Placeholder — accepts any structurally non-zero proof.
     *      pubSignals layout (matches certificate_simple.circom nPublic=4):
     *        [0] isValid
     *        [1] commitment
     *        [2] minPassingGrade
     *        [3] requireAllPassed
     */
     function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals
    ) external pure override returns (bool) {
        require(_pA[0] != 0 || _pA[1] != 0, "Invalid proof point A");
        require(
            _pB[0][0] != 0 || _pB[0][1] != 0 ||
            _pB[1][0] != 0 || _pB[1][1] != 0,
            "Invalid proof point B"
        );
        require(_pC[0] != 0 || _pC[1] != 0, "Invalid proof point C");

        // isValid signal (pubSignals[0]) must be 1
        require(_pubSignals[0] == 1, "ZK proof: isValid signal is 0");

        return true;
    }
    function getVersion() external pure returns (string memory) {
        return "PlaceholderVerifier v1.1.0 - replace with Groth16Verifier for production";
    }
}
