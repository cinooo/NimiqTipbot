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
      for (let i = 0; i < users.length; i++) {
        const { publicAddress } = users[i];
        const balance = await $.getBalance(publicAddress);
        console.log(publicAddress, balance);
        totalBalance += balance;
        accountsWithPositiveBalance += parseFloat(balance) > 0 ? 1 : 0;
        // await wait(0.2);
      }
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
