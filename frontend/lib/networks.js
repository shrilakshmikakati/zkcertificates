// Network configuration with deployed contract addresses
const networks = {
  ganache: {
    name: "Ganache (Local)",
    chainId: 1337,
    rpcUrl: "http://127.0.0.1:7545",
    blockExplorer: null,
    contracts: {
      certificateRegistry: "0xca8f41b1F518CC30F278d1c77F363F842B882dFF",
      certificateVerifier: "0x5438e2A6A06f031a552Eb7936dC9449B8a665528",
      zkCertificateSystem: "0xDb2D3362884D1c881eAb02e4c9492DB6d267f156"
    }
  },
  zksyncSepholia: {
    name: "zkSync Sepolia",
    chainId: 300,
    rpcUrl: "https://sepolia.era.zksync.dev",
    blockExplorer: "https://sepolia.explorer.zksync.io",
    contracts: {
      placeholderVerifier: "0x916EB2a08E26Dc010a316863C88A2ee096CfBDbb",
      certificateRegistry: "0x28890Fc0e6DABCd3237Af26B7041e9563b22C565",
      certificateVerifier: "0xB136cCD354DE5E3779DeD9dA58007e5407DdEF4Ce",
      zkCertificateSystem: "0xA4399F0AE1b3870EC8200A837E5660EeD52DB98E"
    }
  }
};

export default networks;
