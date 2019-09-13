import EthScan, { HttpProvider } from '@mycrypto/eth-scan';
import partition from 'lodash/partition';
import { bigNumberify, BigNumber } from 'ethers/utils';

import { ETHSCAN_NETWORKS } from 'v2/config';
import { TAddress, StoreAccount, StoreAsset, Asset, NodeConfig } from 'v2/types';
import { ProviderHandler } from 'v2/services/EthService';

export interface BalanceMap {
  [key: string]: BigNumber | bigint;
}

const getAssetAddresses = (assets: Asset[] = []): (string | undefined)[] => {
  return assets.map(a => a.contractAddress).filter(a => a);
};

const getScanner = (node: NodeConfig) => {
  return new EthScan(new HttpProvider(node.url));
};

const addBalancesToAccount = (account: StoreAccount) => ([baseBalance, tokenBalances]: [
  BalanceMap,
  BalanceMap
]) => ({
  ...account,
  assets: account.assets
    .map(asset => {
      switch (asset.type) {
        case 'base': {
          const balance = baseBalance[account.address];
          return {
            ...asset,
            balance: balance ? balance.toString() : asset.balance
          };
        }
        case 'erc20': {
          const balance = tokenBalances[asset.contractAddress!];
          return {
            ...asset,
            balance: balance ? balance.toString() : asset.balance
          };
        }
        default:
          return asset;
      }
    })
    .map(asset => ({ ...asset, balance: bigNumberify(asset.balance) }))
});

const getAccountAssetsBalancesWithEthScan = async (
  account: StoreAccount
): Promise<StoreAccount> => {
  const list = getAssetAddresses(account.assets) as string[];
  const scanner = getScanner(account.network.nodes[0]);

  return Promise.all([
    scanner.getEtherBalances([account.address]),
    scanner.getTokensBalance(account.address, list)
  ]).then(addBalancesToAccount(account));
};

// Return an object containing the balance of the different tokens
// e.g { TOKEN_CONTRACT_ADDRESS: <balance> }
const getTokenBalances = (
  provider: ProviderHandler,
  address: TAddress,
  tokens: StoreAsset[]
): BalanceMap => {
  return tokens.reduce(async (balances, token) => {
    return {
      ...balances,
      [token.contractAddress as TAddress]: await provider.getRawTokenBalance(address, token)
    };
  }, {});
};

const getAccountAssetsBalancesWithJsonRPC = async (
  account: StoreAccount
): Promise<StoreAccount> => {
  const { address, assets, network } = account;
  const provider = new ProviderHandler(network);
  const tokens = assets.filter((a: StoreAsset) => a.type === 'erc20');

  return Promise.all([
    provider.getRawBalance(account.address).then(balance => ({ [address]: balance })),
    getTokenBalances(provider, address as TAddress, tokens)
  ]).then(addBalancesToAccount(account));
};

export const getAccountsAssetsBalances = async (accounts: StoreAccount[]) => {
  // for the moment EthScan is only deployed on Ethereum, so we use JSON_RPC to get the
  // balance for the accounts on the other networks.
  const [ethScanCompatibleAccounts, jsonRPCAccounts] = partition(accounts, ({ network }) =>
    ETHSCAN_NETWORKS.some(supportedNetwork => network.id === supportedNetwork)
  );

  const accountBalances = await Promise.all(
    [
      ...ethScanCompatibleAccounts.map(getAccountAssetsBalancesWithEthScan),
      ...jsonRPCAccounts.map(getAccountAssetsBalancesWithJsonRPC)
    ].map(p => p.catch(e => console.debug(e))) // convert Promise.all ie. into allSettled https://dev.to/vitalets/what-s-wrong-with-promise-allsettled-and-promise-any-5e6o
  );

  return accountBalances;
};

export const getAllTokensBalancesOfAccount = async (account: StoreAccount, assets: Asset[]) => {
  const scanner = getScanner(account.network.nodes[0]);
  const assetAddresses = getAssetAddresses(assets) as string[];

  try {
    return scanner.getTokensBalance(account.address, assetAddresses);
  } catch (err) {
    throw new Error(err);
  }
};
