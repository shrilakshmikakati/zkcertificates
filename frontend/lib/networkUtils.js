import networks from './networks';

// Get network configuration from chain ID
export function getNetworkConfig(chainId) {
  if (chainId === 1337 || chainId === '0x539') {
    return networks.ganache;
  }
  if (chainId === 300 || chainId === '0x12c') {
    return networks.zksyncSepholia;
  }
  return null;
}

// Get contract ABI imports (you'll need to copy these from your build artifacts)
export const CONTRACT_ABIS = {
  CertificateRegistry: require('../artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json').abi,
  ZKCertificateSystem: require('../artifacts/contracts/ZKCertificateSystem.sol/ZKCertificateSystem.json').abi,
  PlaceholderVerifier: require('../artifacts/contracts/PlaceholderVerifier.sol/PlaceholderVerifier.json').abi,
  CertificateVerifier: require('../artifacts/contracts/CertificateVerifier.sol/Groth16Verifier.json').abi,
};

// Switch network in MetaMask
export async function switchNetwork(chainId) {
  if (!window.ethereum) {
    alert('MetaMask not installed');
    return false;
  }

  try {
    const hexChainId = '0x' + chainId.toString(16);
    const networkConfig = getNetworkConfig(chainId);

    if (networkConfig.chainId === 300) {
      // zkSync Sepolia
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      }).catch(async (error) => {
        if (error.code === 4902) {
          // Network not found, add it
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hexChainId,
              chainName: networkConfig.name,
              rpcUrls: [networkConfig.rpcUrl],
              blockExplorerUrls: [networkConfig.blockExplorer],
              nativeCurrency: {
                name: 'ETH',
                symbol: 'ETH',
                decimals: 18,
              },
            }],
          });
        }
      });
    }
    return true;
  } catch (error) {
    console.error('Failed to switch network:', error);
    return false;
  }
}

export default {
  getNetworkConfig,
  switchNetwork,
  CONTRACT_ABIS,
};
