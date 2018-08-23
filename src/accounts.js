import './config.js';
import nimiqHelper from './nimiqHelper.js';
import reddit from './redditHelper.js';
import discord from './discordHelper.js';
import * as dynamo from './utils/dynamo';
import Nimiq from '@nimiq/core';
import MnemonicPhrase from './phrase.js';
export const wait = s => new Promise(resolve => setTimeout(resolve, s * 1000));

const startNimiq = async () => {
  const $ = await nimiqHelper.connect();
  const checkNimSynced = async () => {
    await wait(5);
    console.log('waiting 5');
    if ($.isEstablished() === false) {
      await checkNimSynced();
    } else {
      const users = await dynamo.getAllAccounts(3000);
      let totalBalance = 0;
      let accountsWithPositiveBalance = 0;
      let accountsWith0 = 0;
      let accountsWith1 = 0;
      let accountsWith5 = 0;
      let accountsWith50 = 0;
      let accountsWith200 = 0;
      let accountsWith1000 = 0;
      let accountsWithX = 0;
      for (let i = 0; i < users.length; i++) {
        const { publicAddress } = users[i];
        const balance = await $.getBalance(publicAddress);
        console.log(publicAddress, balance);
        totalBalance += balance;
        accountsWithPositiveBalance += parseFloat(balance) > 0 ? 1 : 0;
        accountsWith0 += parseFloat(balance) === 0 ? 1 : 0;
        accountsWith1 += parseFloat(balance) > 0 && parseFloat(balance) <= 1 ? 1 : 0;
        accountsWith5 += parseFloat(balance) > 1 && parseFloat(balance) <= 5 ? 1 : 0;
        accountsWith50 += parseFloat(balance) > 5 && parseFloat(balance) <= 50 ? 1 : 0;
        accountsWith200 += parseFloat(balance) > 50 && parseFloat(balance) <= 200 ? 1 : 0;
        accountsWith1000 += parseFloat(balance) > 200 && parseFloat(balance) <= 1000 ? 1 : 0;
        accountsWithX += parseFloat(balance) > 1000 ? 1 : 0;
        // await wait(0.2);
      }
      console.log('0:', accountsWith0);
      console.log('0 - 1:', accountsWith1);
      console.log('1 - 5:', accountsWith5);
      console.log('5 - 50:', accountsWith50);
      console.log('50 - 200:', accountsWith200);
      console.log('200 - 1000:', accountsWith1000);
      console.log('> 1000:', accountsWithX);
      console.log('Positive accounts:', accountsWithPositiveBalance);
      console.log('Total balance:', totalBalance);
      console.log('Average:', totalBalance / users.length);
    }
  };
  await checkNimSynced();
};

(async () => {
  await startNimiq();
})();
