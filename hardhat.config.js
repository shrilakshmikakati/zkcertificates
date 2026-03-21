require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

// Use appropriate private key based on network
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const ganachePrivateKey = process.env.GANACHE_DEPLOYER_PRIVATE_KEY;
const l2Accounts = deployerPrivateKey ? [deployerPrivateKey] : [];
const ganacheAccounts = ganachePrivateKey ? [ganachePrivateKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    libraries: "./lib"
  },
  networks: {
    ganache: {
      url: "http://127.0.0.1:7545",
      chainId: 1337,
      accounts: ganacheAccounts,
      timeout: 40000
    },
    zksyncSepholia: {
      url: process.env.ZKSYNC_SEPHOLIA_RPC_URL || "https://sepolia.era.zksync.dev",
      chainId: 300,
      accounts: l2Accounts,
      timeout: 40000
    }
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 21
  }
};