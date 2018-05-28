import './config.js';
// const { fork } = require('child_process');
import nimiqHelper from './nimiqHelper.js';
import reddit from './redditHelper.js';

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
      reddit.readMessages($);

      // poll comments!
      reddit.readComments($);

      // const message = await reddit.getPrivateMessages();
      // const message = {
      //   authorName: 'NimiqTipbot',
      //   subject: 'Deposit'
      // };
      // await reddit.handleInboxMessage(message, $);
    }
  };
  await checkNimSynced();
};

(async () => {
  // const response = await refreshToken(currentRefreshToken);
  // redditReadComments();

  // const wallet = await nimiqHelper.generateAddress();

  // const message = {
  //   authorName: 'cinooo1',
  //   subject: 'Deposit'
  // };
  // await reddit.handleMessage(message);

  await startNimiq();
// await reddit.readMessages();
  // console.log(wallet);

  // // read private messages
  // const message = await reddit.getPrivateMessages();
  //
  // await reddit.handleMessage(message);
  //
  // // polls messages
  // await reddit.readMessages();
})();
