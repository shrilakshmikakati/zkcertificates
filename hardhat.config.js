//require("@nomiclabs/hardhat-ethers");


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
        enabled: false,
        runs: 200,
      },
    },
  },

  networks: {
    ganache: {
      url: "http://127.0.0.1:7545",
      chainId: 1337,
      accounts: ganacheAccounts,
      timeout: 40000,
    },
    zksyncSepholia: {
      url: process.env.ZKSYNC_SEPHOLIA_RPC_URL || "https://sepolia.era.zksync.dev",
      // ethNetwork: "sepolia",   // required by hardhat-zksync-verify
      chainId: 300,
      // zksync: true,            // required: tells plugins this is a zkSync network
      // verifyURL: "https://explorer.sepolia.era.zksync.dev/contract_verification",
      accounts: l2Accounts,
      timeout: 40000,
    },
  },

  // zksolc: {
  //   version: "1.5.8",
  //   settings: {
  //     codegen: "evmla",
  //   },
  // },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    cacheZk: "./cache-zk",
    artifactsZk: "./artifacts-zk",
    libraries: "./lib",
  },

  gasReporter: {
    enabled: true,
    currency: "INR",
    gasPrice: 21,
  },
};