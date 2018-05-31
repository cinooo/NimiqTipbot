import './config.js';
// const { fork } = require('child_process');
import nimiqHelper from './nimiqHelper.js';
import reddit from './redditHelper.js';
import discord from './discordHelper.js';
import * as dynamo from './utils/dynamo';

export const wait = s => new Promise(resolve => setTimeout(resolve, s * 1000));

const startNimiq = async () => {
  // const $ = fork('./build/nimiq.js');

  const $ = await nimiqHelper.connect();
  const checkNimSynced = async () => {
    await wait(5);
    console.log('waiting 5');
    if ($.isEstablished() === false) {
      await checkNimSynced();
    } else {
      console.log('Nimiq is synced');
      // initialise the inbox poll
      // reddit.readMessages($);

      // poll comments!
      // reddit.readComments($);

      // start the discord bot
      discord.start($);

      // start the poll on transactions
      nimiqHelper.startPollTransactions($);
    }
  };
  await checkNimSynced();
};

(async () => {
  await startNimiq();
  // await discord.start();
})();
