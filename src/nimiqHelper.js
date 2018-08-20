import Nimiq from '@nimiq/core';

import reddit from './redditHelper';
import { default as discord, logMessageToHistoryChannel } from './discordHelper';
import MnemonicPhrase from './phrase.js';
import * as dynamo from './utils/dynamo';
let $ = {};

const {
  NIMIQ_NETWORK,
  NIMIQ_TRANSACTION_FEE,
  TRANSACTIONS_POLL_TIME,
  TRANSACTIONS_MAX_ITEMS
} = process.env;

export default {
  async connect() {
    $.established = false;
    Nimiq.GenesisConfig[NIMIQ_NETWORK].call(this);

    console.log('Connecting to Nimiq network', NIMIQ_NETWORK);
    $.consensus = await Nimiq.Consensus.nano();

    $.blockchain = $.consensus.blockchain;
    $.mempool = $.consensus.mempool;
    $.network = $.consensus.network;

    $.consensus.on('established', () => this._onConsensusEstablished($));
    $.consensus.on('lost', () => {
      $.established = false;
      console.error('Consensus lost');
    });
    // $.blockchain.on('head-changed', () => this._onHeadChanged($));
    // $.network.on('peers-changed', () => this._onPeersChanged($));

    $.network.connect();

    $.isEstablished = this.isEstablished.bind(this);
    $.getBalance = this._getBalance.bind(this);
    $.sendTransaction = this._sendTransaction.bind(this);
    $.getHeight = this._getHeight.bind(this);

    return $;
  },

  _onConsensusEstablished() {
    console.log('Consensus established.');
    $.established = true;
    console.log('height:', $.blockchain.height);
  },

  _getHeight($) {
    return $.blockchain.height;
  },

  isEstablished() {
    return $.established;
  },

  _onBalanceChanged(account) {
    account = account || Nimiq.BasicAccount.INITIAL;
    const balance = Nimiq.Policy.satoshisToCoins(account.balance).toFixed(2);
    console.log(`New balance of ${$.wallet.address.toUserFriendlyAddress()} is ${balance}.`);
    console.log('balance:', balance);
  },

  _onHeadChanged() {
    const height = $.blockchain.height;
    console.log(`Now at height ${height}.`);
  },

  _onPeersChanged() {
    console.log(`Now connected to ${$.network.peerCount} peers.`);
    // document.getElementById('peers').innerText = $.network.peerCount;
  },

  async _getBalance(address, convertToCoins = true) {
    const walletAddress = this.getWalletFromUserFriendlyAddress(address);
    try {
      const account = await $.consensus.getAccount(walletAddress);
      const balance = account ? Nimiq.Policy.satoshisToCoins(account.balance) : 0;
      console.log(`Address balance of ${address}: ${balance}`);
      return balance;
    } catch (e) {
      console.error('Failed _getBalance', e);
      return 0;
    }
  },

  async _getBalances(addresses) {
    await Promise.all(addresses.map(address => this._getBalance(address)));
  },

  async generateAddress() {
    const wallet = await Nimiq.Wallet.generate();
    const privateKey = wallet.keyPair.privateKey.toHex();
    const phrases = MnemonicPhrase.keyToMnemonic(privateKey);
    const publicAddress = wallet.address.toUserFriendlyAddress();
    // console.log(privateKey);
    // console.log(phrases);
    console.log('New address created', publicAddress);
    return {
      privateKey,
      phrases,
      publicAddress
    };
  },

  getWalletSeed(privateKey) {
    const key = new Nimiq.PrivateKey(Buffer.from(privateKey, 'hex'));
    const keyPair = Nimiq.KeyPair.derive(key);
    return keyPair.toHex();
  },

  getWalletFromPrivateKey(privateKey) {
    const key = new Nimiq.PrivateKey(Buffer.from(privateKey, 'hex'));
    const keyPair = Nimiq.KeyPair.derive(key);
    return new Nimiq.Wallet(keyPair);
  },

  getWalletFromPhrases(phrases) {
    const privateKey = MnemonicPhrase.mnemonicToKey(phrases);
    return this.getWalletFromPrivateKey(privateKey);
  },

  // get a Nimiq wallet from a friendly address like 'NQ83 5CJY HF14 9N4N BLT6 QQ13 1NCJ 53LM YXNR'
  getWalletFromUserFriendlyAddress(address) {
    return Nimiq.Address.fromUserFriendlyAddress(address);
  },

  isValidFriendlyNimAddress(friendlyAddress) {
    return friendlyAddress.replace(/ /g, '').length === 36;
  },

  // transactions can be sent from:
  // Discord !withdraw
  // Discord !tip
  // Reddit withdraw from personal message
  // Reddit tip in comments
  async _sendTransaction(privateKey, destinationFriendlyAddress, coins, tip, fn, sourcePublicAddress) {
    if (!this.isEstablished()) {
      const updateAttributes = {
        status: {
          Action: 'PUT',
          Value: dynamo.TIPS_STATUS_NEW
        },
        heightAttempted: {
          Action: 'DELETE'
        }
      };
      await dynamo.updateTransaction(tip.commentId, updateAttributes);
      return console.log(`Can't send transactions when consensus not established`);
    }

    console.log('sendTransaction', destinationFriendlyAddress, coins);
    const destinationAddress = Nimiq.Address.fromUserFriendlyAddress(destinationFriendlyAddress);
    const satoshis = Nimiq.Policy.coinsToSatoshis(coins);
    // get the wallet of the author
    const wallet = this.getWalletFromPrivateKey(privateKey);

    // console.log('sendTransaction');
    // console.log(wallet);
    // console.log(destinationFriendlyAddress);
    // console.log(destinationAddress);
    // console.log(satoshis);
    // console.log($.consensus.blockchain.head.height);

    const isMempoolAvailable = ($) => $.mempool.getTransactions().length < Nimiq.Mempool.SIZE_MAX;
    // const canSendFreeTransaction = ($, senderAddress) => $.mempool.getPendingTransactions(senderAddress).length < Nimiq.Mempool.FREE_TRANSACTIONS_PER_SENDER_MAX;
    const senderPendingTransactions = ($, senderAddress) => $.mempool.getPendingTransactions(senderAddress).length;
    const senderAddress = wallet.address;
    if (isMempoolAvailable($) === false) {
      console.log(`Mempool transactions full or no free transactions left`);
      // free up for next round of polling
      const updateAttributes = {
        status: {
          Action: 'PUT',
          Value: dynamo.TIPS_STATUS_NEW
        },
        heightAttempted: {
          Action: 'DELETE'
        }
      };
      await dynamo.updateTransaction(tip.commentId, updateAttributes);
      return;
    }

    console.log('send tx, mempool number of tx', $.mempool.getTransactions().length);
    console.log('send tx, mempool pending number of tx for senderAddress', senderPendingTransactions($, senderAddress));
    const sourceTotalTxInMempool = senderPendingTransactions($, senderAddress);
    let fees = 0;
    if (sourceTotalTxInMempool >= 10) {
      console.log('>= 10 free reached, tx using fees total:', sourceTotalTxInMempool);
      fees = NIMIQ_TRANSACTION_FEE;
    };
    console.log('Using fee:', fees);

    // else proceed with the free transaction
    var transaction = wallet.createTransaction(
      destinationAddress, // who we are sending to
      satoshis, // amount in satoshi (no decimal format)
      parseInt(fees), // fee
      $.consensus.blockchain.head.height);
    // const result = await $.consensus.relayTransaction(transaction);
    // console.log('sendTransaction result', result);
    const id = $.mempool.on('transaction-mined', async tx2 => {
      if (transaction.equals(tx2)) {
        const logMessage = `Block height ${$.blockchain.height} transaction mined ${tx2.hash().toHex()}`;
        console.log(logMessage);
        const transactionHash = Array.isArray(tip.rainDestinations) ? $.getHeight($) : tx2.hash().toHex();
        if (fn) {
          await fn(`NIM successfully sent!`, transactionHash);
        }
        // console.log('deleteTransaction', tip, tip.commentId);
        // remove the record from dynamo
        await dynamo.deleteTransaction({ commentId: tip.commentId });
        await dynamo.archiveTransaction({ ...tip, transactionHash, heightCompleted: $.getHeight($) });
        $.mempool.off('transaction-mined', id);
        await logMessageToHistoryChannel(logMessage);
      } else {
        // if there was an issue its possible that the transaction never gets sent. E.g. insufficient funds
        // might have to do a current block height versus heightAttempted check, but means need to do a db read
      }
    });

    const results = await dynamo.getAllTransactions(1000);
    const recipientAddresses = results.reduce((acc, tip) => {
      // console.log(tip);
      const { destinationAddress, rainDestinations } = tip;
      // console.log(destinationAddress);
      if (Array.isArray(rainDestinations) && typeof destinationAddress === 'undefined') {
        return [
          ...acc,
          ...rainDestinations.map(destination => Nimiq.Address.fromUserFriendlyAddress(destination.destinationAddress))
        ];
      } else {
        return [
          ...acc,
          Nimiq.Address.fromUserFriendlyAddress(destinationAddress)
        ];
      }
    }, []);

    $.consensus.subscribeAccounts(recipientAddresses);

    try {
      await $.consensus.relayTransaction(transaction);
      // await $.consensus.mempool.pushTransaction(transaction);
      await logMessageToHistoryChannel(`relayTransaction, waiting to confirm, ${transaction.hash().toHex()}`);
      console.log('relayTransaction, waiting to confirm', transaction.hash().toHex());
    } catch (e) {
      console.error('Error encountered with relayTransaction', e);
      if (fn) {
        await fn(`Failed sending the transaction, try again later. ${e.message}`);
      }
      await dynamo.deleteTransaction({ commentId: tip.commentId });
      await logMessageToHistoryChannel(`Failed sending the transaction, try again later. ${e.message}`);
    }
  },

  async replyChannel(replyMetadata, replyMessage, transactionHash) {
    const { reddit: redditMetadata, discord: discordMetadata } = replyMetadata;
    const viewTransactionUrl = `https://nimiq.mopsus.com/tx/0x${transactionHash}`;
    const viewBlockUrl = `https://nimiq.mopsus.com/block/${transactionHash}`;
    const message =
      transactionHash && redditMetadata
        ? `${replyMessage} [View the transaction](${viewTransactionUrl})`
        : transactionHash && discordMetadata
          ? transactionHash.length === 64
            ? `${replyMessage} View the transaction: <${viewTransactionUrl}>`
            : `${replyMessage} View the block: <${viewBlockUrl}>`
          : replyMessage;
    // this is posting a personal message to a reddit user's inbox for withdrawals
    if (redditMetadata && redditMetadata.authorName && redditMetadata.subject) {
      const { authorName, subject } = redditMetadata;
      await reddit.postMessage(authorName, subject, message);
    }

    // this is editing a comment for normal tipping
    if (redditMetadata && redditMetadata.commentId) {
      await reddit.editComment(redditMetadata.commentId, message);
    }

    // transaction or withdrawal update for discord, updates the initial bot message reply
    if (discordMetadata && discordMetadata.channelId && discordMetadata.messageId) {
      const { channelId, messageId } = discordMetadata;
      await discord.editMessage(channelId, messageId, message);
    }
  },

  async pollTransactions($) {
    Nimiq.Log.instance.level = 1;
    const getNonPendingTips = (items) => items.filter(item => item.status === dynamo.TIPS_STATUS_NEW);
    //
    // scan tips table for non pending transactions
    const results = await dynamo.getTransactions(TRANSACTIONS_MAX_ITEMS);
    const unprocessedTips = getNonPendingTips(results);
    for (let i = 0; i < unprocessedTips.length; i++) {
      const tip = unprocessedTips[i];
      const {
        commentId,
        sourceAuthor,
        nimAmount,
        destinationAddress, // default address per single tx but undefined if its a !rain
        rainDestinations, // passed in if !rain from discord
        replyMetadata
      } = tip;
      console.log(commentId);

      // set it to pending to prevent it being picked up by future poll processes
      const updateAttributes = {
        status: {
          Action: 'PUT',
          Value: dynamo.TIPS_STATUS_PENDING
        },
        heightAttempted: {
          Action: 'ADD',
          Value: $.getHeight($)
        }
      };
      await dynamo.updateTransaction(commentId, updateAttributes);

      // start the transaction send process
      const { balance: userBalance, publicAddress, privateKey } = await dynamo.getUserPublicAddress(sourceAuthor, $);
      if (parseFloat(userBalance) < parseFloat(nimAmount)) {
        await this.replyChannel(replyMetadata, `Insufficient funds to make transaction.`);
        await dynamo.deleteTransaction({ commentId: tip.commentId });
        return;
      }

      const replyFn = ((replyMetadata) => {
        return (replyMessage, transactionHash) => {
          this.replyChannel(replyMetadata, replyMessage, transactionHash);
        };
      })(replyMetadata);
      if (Array.isArray(rainDestinations) && typeof destinationAddress === 'undefined') {
        const sendTransactions = rainDestinations.map(destinations => {
          return $.sendTransaction(privateKey, destinations.destinationAddress, nimAmount, tip, replyFn);
        });
        for (let j = 0; j < sendTransactions.length; j++) {
          await sendTransactions[j];
        }
        // await Promise.all(sendTransactions);
      } else {
        // single transaction
        await $.sendTransaction(privateKey, destinationAddress, nimAmount, tip, replyFn);
      }
    };
  },

  startPollTransactions(nimiqClient) {
    setInterval(async () => {
      // console.log('pollTransaction');
      $ = nimiqClient;
      await this.pollTransactions(nimiqClient);
    }, TRANSACTIONS_POLL_TIME);
  }
};
