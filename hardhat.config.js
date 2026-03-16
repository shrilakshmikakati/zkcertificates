require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const l2Accounts = deployerPrivateKey ? [deployerPrivateKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk"
      }
    },
    ganache: {
      url: "http://127.0.0.1:7545",
      chainId: 1337,
      accounts: [
        "0xa1110fee0b5977d0a2743226c4219a1a7f9e5b6d9e19ac0c3c4ad20c0352405b"
      ]
    },
    hardhat: {
      hardfork: "istanbul",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk"
      }
    },
    ...(process.env.OPTIMISM_SEPOLIA_RPC_URL ? {
      optimismSepolia: {
        url: process.env.OPTIMISM_SEPOLIA_RPC_URL,
        chainId: 11155420,
        accounts: l2Accounts
      }
    } : {}),
    ...(process.env.ARBITRUM_SEPOLIA_RPC_URL ? {
      arbitrumSepolia: {
        url: process.env.ARBITRUM_SEPOLIA_RPC_URL,
        chainId: 421614,
        accounts: l2Accounts
      }
    } : {}),
    ...(process.env.BASE_SEPOLIA_RPC_URL ? {
      baseSepolia: {
        url: process.env.BASE_SEPOLIA_RPC_URL,
        chainId: 84532,
        accounts: l2Accounts
      }
    } : {}),
    ...(process.env.POLYGON_ZKEVM_CARDONA_RPC_URL ? {
      polygonZkEvmCardona: {
        url: process.env.POLYGON_ZKEVM_CARDONA_RPC_URL,
        chainId: 2442,
        accounts: l2Accounts
      }
    } : {})
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 21
  }
};