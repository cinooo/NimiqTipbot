import Discord from 'discord.js';
import nimiqHelper from './nimiqHelper.js';
import * as dynamo from './utils/dynamo.js';

const {
  NIMIQ_NETWORK,
  DISCORD_BOT_TOKEN
} = process.env;

let client;

const BOT_COMMAND_HELP = '!help';
const BOT_COMMAND_COMMANDS = '!commands';
const BOT_COMMAND_TIP = '!tip';
const BOT_COMMAND_WITHDRAW = '!withdraw';
const BOT_COMMAND_BALANCE = '!balance';
const BOT_COMMAND_DEPOSIT = '!deposit';
const BOT_AVAILABLE_COMMANDS = [BOT_COMMAND_HELP, BOT_COMMAND_COMMANDS, BOT_COMMAND_TIP, BOT_COMMAND_WITHDRAW, BOT_COMMAND_BALANCE, BOT_COMMAND_DEPOSIT];
const SOURCE = 'Discord';

const getBotCommand = content => {
  const command = content.split(' ')[0];
  // returns the command or undefined
  return BOT_AVAILABLE_COMMANDS.filter(availableCommand => command === availableCommand)[0];
};

const getBotCommandArguments = content => {
  const args = content.split(' ');
  return args.slice(1);
};

let $ = {};

// format: NQXX XXXX XXXX ...
function getNimDepositLink(address) {
  const safeUrl = NIMIQ_NETWORK === 'main' ? 'https://safe.nimiq.com/' : 'https://safe.nimiq-testnet.com/';
  return `${safeUrl}#_request/${address.replace(/ /g, '-')}_`;
};

function getReplyMessageForHelp() {
  // const { balance: userBalance, publicAddress: userAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, SOURCE, $);
  return {
    replyMessage: `Commands:
!tip @discord_user [tip amount] - Sends NIM to a discord user.
e.g. !tip @cino#0628 3

!balance - Checks your current NIM balance

!withdraw [NIM address] - Withdraw your entire NIM balance to the NIM address you specify.
e.g. !withdraw NQ52 BCNT 9X0Y GX7N T86X 7ELG 9GQH U5N8 27FE

!deposit - Gives instructions on how to deposit`
  };
};

async function getReplyMessageForBalance(authorId, $) {
  const { balance: userBalance, publicAddress: userAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
  return {
    replyMessage: `Your NIM address is: ${userAddress}

Your current balance is ${userBalance}

You can deposit by visiting ${getNimDepositLink(userAddress)}`
  };
};

const reply = (message) => { return { replyMessage: message }; };

async function getReplyMessageForTip(messageId, authorId, args, content, $) {
  if (args.length !== 2) {
    return reply(`Wrong format for !tip command. Must follow the format of !tip @discorduserid [NIM Amount]
e.g. !tip @cino#0628 3`);
  }

  const [argsUserId, argsNimAmount] = args;

  const discordUseridReg = /<@([0-9]+)>/;
  const matchesDiscordUser = discordUseridReg.exec(argsUserId);
  const isDiscordUser = matchesDiscordUser !== null;
  if (!isDiscordUser) {
    return reply(`Didn't detect a valid discord user to tip, are you sure you selected a Discord user using the @(name) format?`);
  }
  const discordUserId = matchesDiscordUser[1];

  const isNimTipReg = /([0-9]+\.?[0-9]{0,6})/mg;
  const matches = isNimTipReg.exec(argsNimAmount);
  const isNimTip = matches !== null;
  const nimAmount = isNimTip ? matches[1] : 0;
  if (nimAmount === 0) {
    return reply(`Please input a valid NIM amount in the format of X.XX e.g. 3 or 0.0008`);
  }

  const parsedObj = {
    sourceAuthor: authorId,
    destinationAuthor: discordUserId,
    body: content,
    isNimTip,
    nimAmount
  };
  console.log(JSON.stringify(parsedObj, null, 2));

  if (isNimTip) {
    // check to comment id to see if its already paid
    const loggedComment = await dynamo.queryTip(messageId);
    const hasNotBeenLogged = loggedComment.Count === 0;
    if (hasNotBeenLogged) {
      // originating source
      // check if account balance of source is sufficient
      const { balance: userBalance, publicAddress: userAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
      const { publicAddress: destinationFriendlyAddress } = await dynamo.getUserPublicAddress(discordUserId, $);

      if (userAddress === destinationFriendlyAddress) {
        return reply(`You can't tip to the same wallet address`);
      }
      if (userBalance >= nimAmount) {
        // has money, can proceed with tip
        await $.sendTransaction(privateKey, destinationFriendlyAddress, nimAmount);
        // log that comment has been paid
        await dynamo.putTip(messageId, {
          sourceAuthor: authorId,
          sourceAddress: userAddress,
          sourceBalance: userBalance,
          destinationAuthor: discordUserId,
          destinationAddress: destinationFriendlyAddress,
          nimAmount
        });
        // console.log(result);
        return reply(`Tipping ${discordUserId} ${nimAmount} NIM.`);
      } else {
        // no amount? post a reply
        return reply('No NIM balance found for your account please use the links to make a NIM deposit first. Try: !deposit');
      }
    }
  }
};

async function getReplyMessageForWithdraw(messageId, authorId, args, content, $) {
  if (args.length !== 1) {
    return reply(`Wrong format for !withdraw command. Must follow the format of !withdraw [NIM Address]
e.g. !withdraw NQ52 BCNT 9X0Y GX7N T86X 7ELG 9GQH U5N8 27FE`);
  }
  const withdrawDestinationArg = args.join(' ');
  // get the withdrawal amounts and address
  const withdrawDestinationReg = /NQ[A-Z0-9 ]*$/;
  const withdrawDestination = withdrawDestinationArg.trim().match(withdrawDestinationReg) ? withdrawDestinationArg.trim().match(withdrawDestinationReg)[0] : null;
  if (withdrawDestination === null || !nimiqHelper.isValidFriendlyNimAddress(withdrawDestination)) {
    return reply(`Encountered a problem reading the NIM withdrawal address`);
  }

  const { balance: userBalance, publicAddress: userAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
  if (parseFloat(userBalance) === 0) {
    return reply(`Insufficient NIM in balance.`);
  }

  // otherwise message saying process the withdraw request!
  return {
    replyMessage: `Processing your withdrawal of ${userBalance} NIM to ${withdrawDestination}`,
    userAddress,
    withdrawDestination,
    withdrawAmount: userBalance,
    privateKey
  };
};

export default {
  start($) {
    client = new Discord.Client();

    client.on('ready', () => {
      console.log(`Logged in as ${client.user.tag}!`);
      // this.listChannels();
      // const textChannels = this.getTextChannels();
    });

    client.on('message', async message => {
      // console.log(message);
      const {
        id: messageId, // unique message id for reference
        content, // message body contents
        author: {
          id: authorId, // unique id for author
          username, // pretty username
          discriminator // unique identifier for user name
        }
      } = message;
      const command = getBotCommand(content);
      if (command) {
        const args = getBotCommandArguments(content);
        console.log(`Detected bot command ${command}. Has args: ${args}`);
        const { replyMessage, userAddress, withdrawDestination, withdrawAmount, privateKey } =
        command === BOT_COMMAND_HELP || command === BOT_COMMAND_COMMANDS ? getReplyMessageForHelp()
          : command === BOT_COMMAND_BALANCE || command === BOT_COMMAND_DEPOSIT ? await getReplyMessageForBalance(authorId, $)
            : command === BOT_COMMAND_TIP ? await getReplyMessageForTip(messageId, authorId, args, content, $)
              : command === BOT_COMMAND_WITHDRAW ? await getReplyMessageForWithdraw(messageId, authorId, args, content, $) : {};
        if (replyMessage) {
          this.postMessage(message, replyMessage);
        }

        if (command === BOT_COMMAND_WITHDRAW && typeof privateKey !== 'undefined' && typeof withdrawDestination !== 'undefined' && typeof withdrawAmount !== 'undefined') {
          console.log(`Performing withdrawal from ${username}#${discriminator} ${userAddress} to ${withdrawDestination} of NIM amount: ${withdrawAmount}`);
          // process withdrawal
          const result = await $.sendTransaction(privateKey, withdrawDestination, withdrawAmount);
          return result;
        }
      }
    });

    client.login(DISCORD_BOT_TOKEN);
  },

  async postMessage(message, replyMessage) {
    message.reply(replyMessage);
  },

  listChannels() {
    for (let [key, value] of client.channels.entries()) {
      // console.log(key, value);
    }
  },

  getTextChannels() {
    return client.channels.values().filter(entry => {
      return entry.type === 'text';
    });
  }
};
