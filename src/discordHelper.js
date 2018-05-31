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

  const discordUseridReg = /<@!?([0-9]+)>/;
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

  if (isNimTip) {
    // check to comment id to see if its already paid
    const loggedComment = await dynamo.queryTransaction(messageId);
    const hasNotBeenLogged = loggedComment.Count === 0;
    if (hasNotBeenLogged) {
      // originating source
      // check if account balance of source is sufficient
      const { balance: userBalance, publicAddress: sourceAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
      const { publicAddress: destinationAddress } = await dynamo.getUserPublicAddress(discordUserId, $);

      if (sourceAddress === destinationAddress) {
        return reply(`You can't tip to the same wallet address`);
      }
      if (userBalance >= nimAmount) {
        return {
          replyMessage: `Processing tip to ${discordUserId} for ${nimAmount} NIM.`,
          sourceAuthor: authorId,
          sourceAddress,
          sourceBalance: userBalance,
          destinationAuthor: discordUserId,
          destinationAddress,
          privateKey,
          nimAmount
        };
      } else {
        // no amount? post a reply
        return reply('Insufficient balance, deposit more NIM deposit first. Try: !deposit. Current balance:', userBalance);
      }
    }
  }
};

async function getReplyMessageForWithdraw(messageId, authorId, args, content, $) {
  if (args.length !== 9) {
    return reply(`Wrong format for !withdraw command. Must follow the format of !withdraw [NIM Address]
e.g. !withdraw NQ52 BCNT 9X0Y GX7N T86X 7ELG 9GQH U5N8 27FE`);
  }
  const withdrawDestinationArg = args.join(' ');
  // get the withdrawal amounts and address
  const withdrawDestinationReg = /NQ[A-Z0-9 ]*$/;
  const destinationAddress = withdrawDestinationArg.trim().match(withdrawDestinationReg) ? withdrawDestinationArg.trim().match(withdrawDestinationReg)[0] : null;
  if (destinationAddress === null || !nimiqHelper.isValidFriendlyNimAddress(destinationAddress)) {
    return reply(`Encountered a problem reading the NIM withdrawal address`);
  }

  const { balance: sourceBalance, publicAddress: sourceAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
  if (parseFloat(sourceBalance) === 0) {
    return reply(`Insufficient NIM in balance.`);
  }

  // otherwise message saying process the withdraw request!
  return {
    replyMessage: `Processing your withdrawal of ${sourceBalance} NIM to ${destinationAddress}`,
    sourceAuthor: authorId,
    sourceAddress,
    sourceBalance,
    destinationAuthor: authorId,
    destinationAddress,
    nimAmount: sourceBalance,
    privateKey
  };
};

export default {
  start($) {
    client = new Discord.Client();

    client.on('ready', () => {
      console.log(`Logged in as ${client.user.tag}!`);
    });

    client.on('message', async message => {
      const {
        id: messageId, // unique message id for reference
        content, // message body contents
        author: {
          id: authorId, // unique id for author
          username, // pretty username
          discriminator // unique identifier for user name
        },
        channel: {
          id: channelId
        }
      } = message;
      // console.log(channelId, messageId, content);
      const command = getBotCommand(content);
      if (command) {
        const args = getBotCommandArguments(content);
        console.log(`Detected bot command ${command} from ${username}#${discriminator}. Has args: ${args}`);
        const { replyMessage, sourceAuthor, sourceAddress, destinationAuthor, destinationAddress, sourceBalance, nimAmount, privateKey } =
        command === BOT_COMMAND_HELP || command === BOT_COMMAND_COMMANDS ? getReplyMessageForHelp()
          : command === BOT_COMMAND_BALANCE || command === BOT_COMMAND_DEPOSIT ? await getReplyMessageForBalance(authorId, $)
            : command === BOT_COMMAND_TIP ? await getReplyMessageForTip(messageId, authorId, args, content, $)
              : command === BOT_COMMAND_WITHDRAW ? await getReplyMessageForWithdraw(messageId, authorId, args, content, $) : {};

        let newReplyMessage;
        if (replyMessage) {
          newReplyMessage = await this.postMessage(message, replyMessage);
        }

        // need to record a tip for withdraw and tip commands
        if (typeof privateKey !== 'undefined' && typeof destinationAddress !== 'undefined' && typeof nimAmount !== 'undefined') {
          console.log(`Recording discord tip amount for ${sourceAuthor} for ${nimAmount} to ${destinationAddress}`);
          // log that comment has been paid
          await dynamo.putTransaction(messageId, {
            sourceAuthor,
            sourceAddress,
            sourceBalance,
            destinationAuthor,
            destinationAddress,
            privateKey,
            nimAmount,
            replyMetadata: { // when the transaction later gets sent, this info is used to send the reply message back to user
              discord: {
                channelId,
                ...newReplyMessage && { messageId: newReplyMessage.id }
              }
            }
          });
        }
      }
    });

    client.login(DISCORD_BOT_TOKEN);
  },

  async postMessage(message, replyMessage) {
    const newReplyMessage = await message.reply(replyMessage);
    return newReplyMessage;
  },

  listChannels() {
    for (let [key, value] of client.channels.entries()) {
      // console.log(key, value);
    }
  },

  getTextChannels() {
    // console.log(client.channels.values());
    // return client.channels.entries().filter(entry => {
    //   return entry.type === 'text';
    // });
  },

  async editMessage(channelId, messageId, updatedContent) {
    const channel = client.channels.get(channelId);
    // console.log(channel);
    // const sentMessage = await channel.send('yoyoyoyoyo');
    const sentMessage = await channel.fetchMessage(messageId);
    await sentMessage.edit(`${sentMessage.content}
${updatedContent}`);
    // const textChannels = this.getTextChannels();
    // console.log(textChannels);
  }
};
