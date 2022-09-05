import { ETH, IToken } from '../../../common/tokens';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { ethers, providers, utils } from 'ethers';

import { Account } from '../../account/Account';
import App from '../../App';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CurveRouterABI from '../../../abis/CurveRouter.json';
import { ERC20Token } from '../../../models/ERC20';
import { INetwork } from '../../../common/Networks';
import { IRouteStep } from '@curvefi/api/lib/interfaces';
import MessageKeys from '../../../common/MessageKeys';
import { NativeToken } from '../../../models/NativeToken';
import Networks from '../../Networks';
import { ReadableInfo } from '../../../models/Transaction';
import { SupportedChains } from './CurveSupportedChains';
import TxHub from '../../hubs/TxHub';
import curve from '@curvefi/api';
import { getRPCUrls } from '../../../common/RPC';

const Keys = {
  userSelectedNetwork: 'exchange-userSelectedNetwork',
  userSelectedAccount: 'exchange-userSelectedAccount',
  userCustomizedTokens: (chainId: number) => `${chainId}-exchange-userTokens`,
  userSelectedFromToken: (chainId: number) => `${chainId}-exchange-from`,
  userSelectedToToken: (chainId: number) => `${chainId}-exchange-to`,
  userSlippage: (chainId: number) => `${chainId}-exchange-slippage`,
};

export class CurveExchange {
  private calcExchangeRateTimer?: NodeJS.Timer;
  private watchPendingTxTimer?: NodeJS.Timer;
  private swapRoute?: IRouteStep[];

  networks = Object.getOwnPropertyNames(SupportedChains).map((id) => Networks.find(id)!);
  userSelectedNetwork = Networks.Ethereum;
  account = App.currentAccount!;

  tokens: (NativeToken | ERC20Token)[] = [];
  swapFrom: (NativeToken | ERC20Token) | null = null;
  swapTo: (NativeToken | ERC20Token) | null = null;
  swapFromAmount = '';
  swapToAmount: string | null = null;
  calculating = false;
  checkingApproval = false;
  exchangeRate = 0;
  needApproval = true;
  slippage = 0.5;

  pendingTxs: string[] = [];

  protected get chain() {
    return SupportedChains[this.userSelectedNetwork.chainId];
  }

  get isValidFromAmount() {
    try {
      return utils.parseUnits(this.swapFromAmount, this.swapFrom?.decimals || 18).gt(0);
    } catch (error) {
      return false;
    }
  }

  get isValidOutputAmount() {
    try {
      return utils.parseUnits(this.swapToAmount || '0', this.swapTo?.decimals).gt(0);
    } catch (error) {
      return false;
    }
  }

  constructor() {
    makeObservable(this, {
      userSelectedNetwork: observable,
      networks: observable,
      tokens: observable,
      swapFrom: observable,
      swapTo: observable,
      account: observable,
      swapFromAmount: observable,
      swapToAmount: observable,
      exchangeRate: observable,
      calculating: observable,
      checkingApproval: observable,
      needApproval: observable,
      slippage: observable,
      pendingTxs: observable,

      switchNetwork: action,
      switchAccount: action,
      switchSwapFrom: action,
      switchSwapTo: action,
      setSwapAmount: action,
      setSlippage: action,
      enqueueTx: action,
    });
  }

  async init() {
    const chainId = Number((await AsyncStorage.getItem(Keys.userSelectedNetwork)) || 1);
    const slippage = Number((await AsyncStorage.getItem(Keys.userSlippage(chainId))) || 0.5);
    const defaultAccount =
      App.findAccount((await AsyncStorage.getItem(Keys.userSelectedAccount)) as string) || App.currentAccount;

    runInAction(() => {
      this.switchNetwork(Networks.find(chainId)!);
      this.switchAccount(defaultAccount!);
      this.slippage = slippage;
    });
  }

  async switchAccount(account: Account | string) {
    this.account =
      typeof account === 'string' ? (App.findAccount(account) as Account) : (account as Account) || App.currentAccount;

    AsyncStorage.setItem(Keys.userSelectedAccount, this.account.address);
    this.tokens.forEach((t) => t.setOwner(this.account.address));
  }

  async switchNetwork(network: INetwork) {
    this.userSelectedNetwork = network;

    AsyncStorage.setItem(Keys.userSelectedNetwork, `${network.chainId}`);
    curve.init('JsonRpc', { url: getRPCUrls(network.chainId)[0] }, { chainId: network.chainId });

    const saved: IToken[] = JSON.parse((await AsyncStorage.getItem(Keys.userCustomizedTokens(network.chainId))) || '[]');
    const nativeToken = new NativeToken({ owner: this.account.address, chainId: network.chainId, symbol: network.symbol });
    const userTokens = (saved.length > 0 ? saved : this.chain.defaultTokens).map(
      (t) =>
        new ERC20Token({
          owner: this.account.address,
          contract: t.address,
          symbol: t.symbol,
          chainId: network.chainId,
          decimals: t.decimals,
        })
    );

    const tokens = network.chainId === 1 ? [nativeToken, ...userTokens] : userTokens;

    const swapFromAddress = await AsyncStorage.getItem(Keys.userSelectedFromToken(network.chainId));
    const swapToAddress = await AsyncStorage.getItem(Keys.userSelectedToToken(network.chainId));

    runInAction(() => {
      this.tokens = tokens;

      this.switchSwapFrom(tokens.find((t) => t.address === swapFromAddress) || tokens[0], false);
      this.switchSwapTo(tokens.find((t) => t.address === swapToAddress) || tokens[1], false);

      this.swapFrom?.getBalance();
    });
  }

  switchSwapFrom(token: ERC20Token | NativeToken, checkToken = true) {
    if (!token) return;
    if (checkToken && token.address === this.swapTo?.address) {
      this.switchSwapTo(this.swapFrom!, false);
    }

    this.swapFrom = token;
    this.swapFrom.getBalance();
    this.exchangeRate = 0;
    this.checkingApproval = true;

    if (token.address) {
      this.checkApproval(true);
    } else {
      this.checkingApproval = false;
      this.needApproval = false;
    }

    this.setSwapAmount(this.swapFromAmount);
    AsyncStorage.setItem(Keys.userSelectedFromToken(this.userSelectedNetwork.chainId), token.address);
  }

  switchSwapTo(token: ERC20Token | NativeToken, checkToken = true) {
    if (!token) return;
    if (checkToken && token.address === this.swapFrom?.address) {
      this.switchSwapFrom(this.swapTo!, false);
    }

    this.swapTo = token;
    this.exchangeRate = 0;

    this.setSwapAmount(this.swapFromAmount);
    AsyncStorage.setItem(Keys.userSelectedToToken(this.userSelectedNetwork.chainId), token.address);
  }

  setSwapAmount(amount: string) {
    if (!Number(amount)) {
      this.swapFromAmount = '';
      this.swapToAmount = '';
      this.exchangeRate = 0;
      return;
    }

    if (Number(amount) === Number(this.swapFromAmount)) return;

    this.swapFromAmount = amount;
    this.exchangeRate = 0;
    clearTimeout(this.calcExchangeRateTimer);

    if (!amount) {
      this.swapToAmount = '';
      return;
    }

    this.calculating = true;
    this.swapRoute = undefined;
    this.calcExchangeRateTimer = setTimeout(() => this.calcExchangeRate(), 500);
  }

  setSlippage(amount: number) {
    amount = Math.min(Math.max(0, amount), 99) || 0.5;
    this.slippage = amount;

    AsyncStorage.setItem(Keys.userSlippage(this.userSelectedNetwork.chainId), `${amount}`);
  }

  async calcExchangeRate() {
    runInAction(() => (this.calculating = true));

    this.checkApproval();

    try {
      const { route, output } = await curve.router.getBestRouteAndOutput(
        this.swapFrom!.address || ETH.address,
        this.swapTo!.address || ETH.address,
        this.swapFromAmount
      );

      this.swapRoute = route;

      runInAction(() => {
        this.swapToAmount = output;
        this.exchangeRate = Number(output) / Number(this.swapFromAmount);
      });
    } catch (e) {
      runInAction(() => {
        this.swapToAmount = '';
        this.exchangeRate = 0;
      });
    }

    runInAction(() => (this.calculating = false));
  }

  private async checkApproval(force = false) {
    const approved = await (this.swapFrom as ERC20Token)?.allowance?.(this.account.address, this.chain.router, force);
    if (!approved) return;

    runInAction(() => {
      this.needApproval = approved.lt(utils.parseUnits(this.swapFromAmount || '0', this.swapFrom?.decimals));
      this.checkingApproval = false;
    });
  }

  approve() {
    let data = '0x';

    try {
      data = (this.swapFrom as ERC20Token).encodeApproveData(
        this.chain.router,
        utils.parseUnits(this.swapFromAmount, this.swapFrom!.decimals)
      );
    } catch (error) {
      return;
    }

    const approve = async (opts: { pin: string; tx: providers.TransactionRequest; readableInfo: ReadableInfo }) => {
      const { txHash } = await App.sendTxFromAccount(this.account.address, opts);

      if (txHash) {
        runInAction(() => {
          this.enqueueTx(txHash);
        });
      }

      return txHash ? true : false;
    };

    const reject = () => {};

    PubSub.publish(MessageKeys.openInpageDAppSendTransaction, {
      approve,
      reject,
      param: { from: this.account.address, to: this.swapFrom!.address, data },
      chainId: this.userSelectedNetwork.chainId,
      account: this.account.address,
      app: { name: 'Wallet 3 Swap', icon: 'https://wallet3.io/favicon.ico', verified: true },
    });
  }

  swap() {
    if (!this.swapRoute || this.swapRoute.length === 0 || !this.isValidFromAmount) return;

    let route = [this.swapFrom!.address || ETH.address];
    let swapParams: any[] = [];
    let factorySwapAddrs: string[] = [];

    for (let routeStep of this.swapRoute) {
      route.push(routeStep.poolAddress, routeStep.outputCoinAddress);
      swapParams.push([routeStep.i, routeStep.j, routeStep.swapType]);
      factorySwapAddrs.push(routeStep.swapAddress);
    }

    route = route.concat(new Array(9 - route.length).fill(ethers.constants.AddressZero));
    swapParams = swapParams.concat(new Array(4 - swapParams.length).fill([0, 0, 0]));
    factorySwapAddrs = factorySwapAddrs.concat(new Array(4 - factorySwapAddrs.length).fill(ethers.constants.AddressZero));

    if (route.length > 9) return;

    const curve = new ethers.Contract(this.chain.router, CurveRouterABI);
    const data = curve.interface.encodeFunctionData('exchange_multiple(address[9],uint256[3][4],uint256,uint256,address[4])', [
      route,
      swapParams,
      utils.parseUnits(this.swapFromAmount, this.swapFrom?.decimals),
      utils
        .parseUnits(this.swapToAmount!, this.swapTo?.decimals)
        .mul(Number.parseInt((10000 - Number(this.slippage.toFixed(2)) * 100) as any))
        .div(10000),
      factorySwapAddrs,
    ]);

    const approve = async (opts: { pin: string; tx: providers.TransactionRequest; readableInfo: ReadableInfo }) => {
      const { txHash } = await App.sendTxFromAccount(this.account.address, opts);
      const result = txHash ? true : false;

      if (result) {
        runInAction(() => {
          this.enqueueTx(txHash!);
          this.setSwapAmount('');
        });
      }

      return result;
    };

    const reject = () => {};

    PubSub.publish(MessageKeys.openInpageDAppSendTransaction, {
      approve,
      reject,
      param: {
        from: this.account.address,
        to: this.chain.router,
        data,
        value: this.swapFrom?.address ? '0x0' : utils.parseEther(this.swapFromAmount).toString(),
      },
      chainId: this.userSelectedNetwork.chainId,
      account: this.account.address,
      app: { name: 'Wallet 3 Swap', icon: 'https://wallet3.io/favicon.ico', verified: true },
    });
  }

  enqueueTx(hash: string) {
    this.pendingTxs.push(hash);
    clearTimeout(this.watchPendingTxTimer);
    this.watchPendingTxTimer = setTimeout(() => this.watchPendingTxs(), 1000);
  }

  watchPendingTxs() {
    const pendingTxs = this.pendingTxs.filter((tx) => TxHub.pendingTxs.find((t) => t.hash === tx));

    if (pendingTxs.length < this.pendingTxs.length) {
      this.checkApproval(true);
    }

    runInAction(() => (this.pendingTxs = pendingTxs));

    if (pendingTxs.length === 0) return;
    this.watchPendingTxTimer = setTimeout(() => this.watchPendingTxs(), 1000);
  }
}

export default new CurveExchange();
