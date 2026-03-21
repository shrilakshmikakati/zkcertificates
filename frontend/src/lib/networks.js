/**
 * Network Configuration
 * Contains RPC endpoints and contract addresses for different networks
 */

export const NETWORKS = {
  ganache: {
    chainId: 1337,
    name: 'Ganache Local',
    rpcUrl: 'http://127.0.0.1:7545',
    blockExplorerUrl: 'http://127.0.0.1:7545',
    isTestnet: true,
    isLocal: true,
    contracts: {
      PlaceholderVerifier: '0x42633D6709Ba541Ba3A4a86A4A2A20DbbF43aE97',
      CertificateRegistry: '0xca8f41b1F518CC30F278d1c77F363F842B882dFF',
      CertificateVerifier: '0x9668d8d69B03935E3E4BD20835FEe5539a3336c2',
      Verifier: '0x9668d8d69B03935E3E4BD20835FEe5539a3336c2',
      ZKCertificateSystem: '0xDb2D3362884D1c881eAb02e4c9492DB6d267f156'
    }
  },
  
  localhost: {
    chainId: 31337,
    name: 'Hardhat Local',
    rpcUrl: 'http://127.0.0.1:8545',
    blockExplorerUrl: 'http://127.0.0.1:8545',
    isTestnet: true,
    isLocal: true,
    contracts: {
      PlaceholderVerifier: '0x...',
      CertificateRegistry: '0x...',
      CertificateVerifier: '0x...',
      ZKCertificateSystem: '0x...'
    }
  },

  zksyncSepholia: {
    chainId: 300,
    name: 'zkSync Sepolia',
    rpcUrl: 'https://sepolia.era.zksync.dev',
    blockExplorerUrl: 'https://sepolia.explorer.zksync.io',
    isTestnet: true,
    isLocal: false,
    isLayer2: true,
    contracts: {
      PlaceholderVerifier: '0x916EB2a08E26Dc010a316863C88A2ee096CfBDbb',
      CertificateRegistry: '0x28890Fc0e6DABCd3237Af26B7041e9563b22C565',
      CertificateVerifier: '0xB136cCD354DE5E3779DeD9dA58007e5407DdEF4Ce',
      ZKCertificateSystem: '0xA4399F0AE1b3870EC8200A837E5660EeD52DB98E'
    }
  },

  zksyncMainnet: {
    chainId: 324,
    name: 'zkSync Mainnet',
    rpcUrl: 'https://mainnet.era.zksync.io',
    blockExplorerUrl: 'https://explorer.zksync.io',
    isTestnet: false,
    isLocal: false,
    isLayer2: true,
    contracts: {
      PlaceholderVerifier: '0x...', // Update with mainnet addresses
      CertificateRegistry: '0x...',
      CertificateVerifier: '0x...',
      ZKCertificateSystem: '0x...'
    }
  },

  abstract: {
    chainId: 2741,
    name: 'Abstract',
    rpcUrl: process.env.NEXT_PUBLIC_ABSTRACT_RPC_URL || '',
    blockExplorerUrl: 'https://explorer.testnet.abs.xyz',
    isTestnet: true,
    isLocal: false,
    isLayer2: true,
    contracts: {
      PlaceholderVerifier: '0x...',
      CertificateRegistry: '0x...',
      CertificateVerifier: '0x...',
      ZKCertificateSystem: '0x...'
    }
  },

  immutableZkEVM: {
    chainId: 13371,
    name: 'Immutable zkEVM',
    rpcUrl: process.env.NEXT_PUBLIC_IMMUTABLE_ZKEVM_RPC_URL || '',
    blockExplorerUrl: 'https://explorer.testnet.immutable.com',
    isTestnet: true,
    isLocal: false,
    isLayer2: true,
    contracts: {
      PlaceholderVerifier: '0x...',
      CertificateRegistry: '0x...',
      CertificateVerifier: '0x...',
      ZKCertificateSystem: '0x...'
    }
  },

  astarZKyoto: {
    chainId: 6038361,
    name: 'Astar zKyoto',
    rpcUrl: process.env.NEXT_PUBLIC_ASTAR_ZKYOTO_RPC_URL || '',
    blockExplorerUrl: 'https://blockscout.testnet.astar.network',
    isTestnet: true,
    isLocal: false,
    isLayer2: true,
    contracts: {
      PlaceholderVerifier: '0x...',
      CertificateRegistry: '0x...',
      CertificateVerifier: '0x...',
      ZKCertificateSystem: '0x...'
    }
  }
};

/**
 * Get network configuration by network key
 * @param {string} networkKey - The network key (ganache, localhost, zksyncSepholia, etc.)
 * @returns {object} Network configuration object
 */
export function getNetworkConfig(networkKey) {
  return NETWORKS[networkKey] || NETWORKS.ganache;
}

/**
 * Get a specific contract address for a network
 * @param {string} networkKey - The network key
 * @param {string} contractName - The contract name (PlaceholderVerifier, CertificateRegistry, etc.)
 * @returns {string} Contract address
 */
export function getContractAddress(networkKey, contractName) {
  const network = getNetworkConfig(networkKey);
  return network.contracts[contractName] || '';
}

/**
 * Get RPC URL for a network
 * @param {string} networkKey - The network key
 * @returns {string} RPC URL
 */
export function getRpcUrl(networkKey) {
  const network = getNetworkConfig(networkKey);
  return network.rpcUrl;
}

/**
 * Get block explorer URL for a network
 * @param {string} networkKey - The network key
 * @returns {string} Block explorer URL
 */
export function getBlockExplorerUrl(networkKey) {
  const network = getNetworkConfig(networkKey);
  return network.blockExplorerUrl;
}

/**
 * Check if network is testnet
 * @param {string} networkKey - The network key
 * @returns {boolean} True if testnet
 */
export function isTestnet(networkKey) {
  const network = getNetworkConfig(networkKey);
  return network.isTestnet;
}

/**
 * Check if network is Layer 2
 * @param {string} networkKey - The network key
 * @returns {boolean} True if Layer 2
 */
export function isLayer2(networkKey) {
  const network = getNetworkConfig(networkKey);
  return network.isLayer2 || false;
}

/**
 * Get all networks
 * @returns {object} All networks configuration
 */
export function getAllNetworks() {
  return NETWORKS;
}

/**
 * Get network name display
 * @param {string} networkKey - The network key
 * @returns {string} Network display name
 */
export function getNetworkName(networkKey) {
  const network = getNetworkConfig(networkKey);
  return network.name;
}

export default NETWORKS;
