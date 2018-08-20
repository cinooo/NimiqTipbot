import Discord from 'discord.js';
import nimiqHelper from './nimiqHelper.js';
import * as dynamo from './utils/dynamo.js';

const {
  NIMIQ_NETWORK,
  DISCORD_BOT_TOKEN,
  DISCORD_HISTORY_CHANNEL_ID,
  RAIN_SOAK_MAXIMUM_PERSONS
} = process.env;

let client;

const BOT_COMMAND_HELP = '!help';
const BOT_COMMAND_COMMANDS = '!commands';
const BOT_COMMAND_TIP = '!tip';
const BOT_COMMAND_WITHDRAW = '!withdraw';
const BOT_COMMAND_BALANCE = '!balance';
const BOT_COMMAND_DEPOSIT = '!deposit';
const BOT_COMMAND_RAIN = '!rain';
const BOT_COMMAND_SOAK = '!soak';
const BOT_AVAILABLE_COMMANDS = [BOT_COMMAND_HELP, BOT_COMMAND_COMMANDS, BOT_COMMAND_TIP, BOT_COMMAND_WITHDRAW, BOT_COMMAND_BALANCE, BOT_COMMAND_DEPOSIT, BOT_COMMAND_RAIN, BOT_COMMAND_SOAK];
const SOURCE = 'Discord';

const getBotCommand = content => {
  const command = content.split(' ')[0].toLowerCase();
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
  return {
    replyMessage: `Commands:
!tip @discord_user [tip amount] - Sends NIM to a discord user.
e.g. !tip @cino#0628 3

!balance - Checks your current NIM balance

!withdraw [NIM address] - Withdraw your entire NIM balance to the NIM address you specify.
e.g. !withdraw NQ52 BCNT 9X0Y GX7N T86X 7ELG 9GQH U5N8 27FE

!deposit - Gives instructions on how to deposit

!rain [total_NIM_amount_to_rain] [number_of_ppl_to_rain_to] - sends NIM to a random number of users, max ${RAIN_SOAK_MAXIMUM_PERSONS} ppl

!soak [total_NIM_amount_to_soak] [number_of_ppl_to_soak_to] - sends NIM to a random number of online users, max ${RAIN_SOAK_MAXIMUM_PERSONS} ppl`
  };
};

async function getReplyMessageForBalance(authorId, $) {
  const { balance: userBalance, publicAddress: userAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
  await logMessageToHistoryChannel(`Check !balance from discord: ${authorId}`);
  return {
    replyMessage: `Your NIM address is: ${userAddress}

Your current balance is ${userBalance} NIM

You can deposit by visiting ${getNimDepositLink(userAddress)}`
  };
};

const reply = (message) => { return { replyMessage: message }; };

async function getReplyMessageForTip(messageId, authorId, args, niceName, content, $) {
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

  // const isNimTipReg = /([0-9]+\.?[0-9]{0,6})/mg;
  const isNimTipReg = /\d*(\.\d{1,6})?/mg;
  const matches = isNimTipReg.exec(argsNimAmount);
  const isNimTip = matches !== null;
  const nimAmount = isNimTip ? matches[0] : 0;
  console.log(isNimTip, matches[0]);
  if (parseFloat(nimAmount) === 0) {
    return reply(`Please input a valid NIM amount in the format of X.XX e.g. 3 or 0.0008`);
  }

  if (parseFloat(nimAmount) < 0.00001 && parseFloat(nimAmount) !== 0) {
    return reply(`Can't send a NIM amount smaller than 0.00001`);
  }

  if (isNimTip && parseFloat(nimAmount) >= 0.00001) {
    // check to comment id to see if its already paid
    const loggedComment = await dynamo.queryTransaction(messageId);
    const hasNotBeenLogged = loggedComment.Count === 0;
    if (hasNotBeenLogged) {
      // originating source
      // check if account balance of source is sufficient
      const { balance: userBalance, publicAddress: sourceAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);
      const { publicAddress: destinationAddress } = await dynamo.getUserPublicAddress(discordUserId, $, false);

      if (sourceAddress === destinationAddress) {
        return reply(`You can't tip to the same wallet address`);
      }

      // Check the user has not reached MAX_USER_TRANSACTION_LIMIT
      // if (await dynamo.userHasReachedTransactionLimit(authorId)) {
      //   return reply(`Maximum limit of 10 transactions per account source reached, please try again in a minute, this is to prevent spam.`);
      // };

      console.log(userBalance, nimAmount, parseFloat(userBalance), parseFloat(nimAmount), parseFloat(userBalance) >= parseFloat(nimAmount));
      if (parseFloat(userBalance) >= parseFloat(nimAmount)) {
        await logMessageToHistoryChannel(`Processing !tip from discord: ${niceName} for ${nimAmount} NIM`);
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
        await logMessageToHistoryChannel(`Processing !tip from discord: Insufficient balance from ${discordUserId}`);
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

  // Check the user has not reached MAX_USER_TRANSACTION_LIMIT
  if (await dynamo.userHasReachedTransactionLimit(authorId)) {
    return reply(`Maximum limit of 10 free transactions per account source reached, please try again in a minute.`);
  };

  await logMessageToHistoryChannel(`Withdrawal from discord: ${authorId}`);

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

function getRandomSubarray(arr, size) {
  let shuffled = arr.slice(0);
  let i = arr.length;
  let temp;
  let index;
  while (i--) {
    index = Math.floor((i + 1) * Math.random());
    temp = shuffled[index];
    shuffled[index] = shuffled[i];
    shuffled[i] = temp;
  }
  return shuffled.slice(0, size);
}

async function getReplyMessageForRainOrSoak(method = 'rain', messageId, authorId, args, content, $, message) {
  // !rain 10
  // console.log(args, args.length);
  if (args.length !== 2) {
    return reply(`Wrong format for !${method} command, use:
!rain [total_NIM_amount_to_rain] [number_of_ppl_to_rain_to]`);
  };

  const nimAmount = parseFloat(args[0]);
  const rainToNumber = parseInt(args[1]);

  if (isNaN(nimAmount)) {
    return reply(`Use a valid whole number for the NIM ${method} amount`);
  };

  if (nimAmount < 0.0001) {
    return reply(`Minimum amount to ${method} is 0.0001`);
  }

  if (isNaN(rainToNumber) || rainToNumber < 1 || rainToNumber > RAIN_SOAK_MAXIMUM_PERSONS) {
    return reply(`Please choose a number between 1 and ${RAIN_SOAK_MAXIMUM_PERSONS} persons`);
  };

  const isNotBot = member => member.user.bot === false;
  const isNotOriginatingAuthor = member => member.user.id !== authorId;

  console.log(message.guild.name, message.guild.members.array().length, message.guild.members.filter(member => member.presence.status === 'online').array().length);

  // soak uses only the members which are online
  const whichMembers = method === 'rain'
    ? message.guild.members
    : message.guild.members.filter(member => member.presence.status === 'online');

  const members = whichMembers.reduce((acc, member) => {
    return isNotBot(member) && isNotOriginatingAuthor(member) ? [
      ...acc,
      member
    ] : acc;
  }, []);
  // console.log(members);

  // return reply(`hello <@361767686222512130>`);

  if (members.length < rainToNumber) {
    return reply(`There has to be at least ${rainToNumber} other members on this server to use the !${method} command`);
  };

  const { balance: sourceBalance, publicAddress: sourceAddress, privateKey } = await dynamo.getUserPublicAddress(authorId, $);

  // require a minimum of 1 additional NIM in wallet for rain & soaks to cover fees
  const feeRequired = method === 'soak' ? 1.0 : 0.0;

  if (parseFloat(sourceBalance) + feeRequired < nimAmount) {
    const message = method === 'rain' ? `Insufficient NIM in balance.` : `Insufficient NIM in balance. rain & soak also requires 1 additional NIM in case transaction fees are required.`;
    return reply(message);
  };

  // Check the user has not reached MAX_USER_TRANSACTION_LIMIT
  // if (await dynamo.userHasReachedTransactionLimit(authorId, rainToNumber)) {
  //   return reply(`Maximum limit of 10 transactions per account source reached, please try again in a minute, this is to prevent spam.`);
  // };

  await logMessageToHistoryChannel(`Processing ${method} from discord: ${authorId} - nim amount ${nimAmount}, ${method} number ${rainToNumber}`);

  // ensure that there is enough to split between everyone and it is rounded down
  const individualRainAmount = Math.floor(nimAmount / rainToNumber * 100000) / 100000;
  // console.log(individualRainAmount);

  const chosenMembers = getRandomSubarray(members, rainToNumber);
  const membersIdListString = chosenMembers.reduce((acc, member) => {
    return `<@${member.user.id}> ${acc}`.trim();
  }, '');
  const getRainDestinations = chosenMembers.map(member => {
    const destinationAuthor = member.user.id;
    return dynamo.getUserPublicAddress(destinationAuthor, $, false)
      .then(response => {
        const { publicAddress: destinationAddress } = response;
        return {
          destinationAuthor,
          destinationAddress
        };
      });
  });

  const rainDestinations = await Promise.all(getRainDestinations);
  const response = {
    replyMessage: `Sending ${individualRainAmount} each to ${membersIdListString}`,
    sourceAuthor: authorId,
    sourceAddress,
    sourceBalance,
    privateKey,
    rainDestinations,
    nimAmount: individualRainAmount
  };
  // console.log('rain response', response);
  return response;
}

export async function logMessageToHistoryChannel(message) {
  // 452985675659083778 453353690707918848 hi
  const channelId = DISCORD_HISTORY_CHANNEL_ID;
  if (client && DISCORD_HISTORY_CHANNEL_ID && message) {
    const channel = client.channels.get(channelId);
    await channel.send(message);
  }
}

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
          id: channelId,
          name: channelName
        },
        guild: {
          name: guildName
        }
      } = message;

      // console.log(message.guild);
      // console.log(channelId, messageId, content);
      // console.log(message.guild.name, message.guild.presences.array().length, message.guild.presences.filter(presence => presence.status === 'online').array().length);
      // console.log(message.guild.name, message.guild.members.array().length, message.guild.members.filter(member => member.presence.status === 'online').array().length);
      // console.log(message.guild.presences.values().length);
      // console.log(message.guild.members.length);

      const singleSpaceContent = content.replace(/ [ ]*/gm, ' ');
      const command = getBotCommand(singleSpaceContent);
      if (command) {
        const args = getBotCommandArguments(singleSpaceContent);
        const niceName = `@${username}#${discriminator}`;
        console.log(`Detected bot command ${command} from ${niceName}. Has args: ${args}`);
        const {
          replyMessage,
          sourceAuthor,
          sourceAddress,
          destinationAuthor,
          destinationAddress,
          sourceBalance,
          nimAmount,
          privateKey,
          rainDestinations // only returned by BOT_COMMAND_RAIN
        } = command === BOT_COMMAND_HELP || command === BOT_COMMAND_COMMANDS ? getReplyMessageForHelp()
          : command === BOT_COMMAND_BALANCE || command === BOT_COMMAND_DEPOSIT ? await getReplyMessageForBalance(authorId, $)
            : command === BOT_COMMAND_TIP ? await getReplyMessageForTip(messageId, authorId, args, niceName, content, $)
              : command === BOT_COMMAND_WITHDRAW ? await getReplyMessageForWithdraw(messageId, authorId, args, content, $)
                : (command === BOT_COMMAND_RAIN || command === BOT_COMMAND_SOAK) ? await getReplyMessageForRainOrSoak(command.substring(1), messageId, authorId, args, content, $, message) : {};

        // the replyMessage creates a new message id - this message id later is used and edited with the transaction details
        let newReplyMessage;
        if (replyMessage) {
          newReplyMessage = await this.postMessage(message, replyMessage);
        }

        try {
          await logMessageToHistoryChannel(`Command ${command}, ${guildName}: ${channelName} from ${username}#${discriminator}`);
        } catch (e) {
          console.log('Error logging to discord', e);
        }

        // need to record a tip for withdraw and tip commands
        if ((command === BOT_COMMAND_TIP || command === BOT_COMMAND_WITHDRAW) && typeof privateKey !== 'undefined' && typeof destinationAddress !== 'undefined' && typeof nimAmount !== 'undefined') {
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
            },
            heightRecorded: $.getHeight($)
          });
        }

        if ((command === BOT_COMMAND_RAIN || command === BOT_COMMAND_SOAK) && typeof nimAmount !== 'undefined' && Array.isArray(rainDestinations)) {
          console.log(`Recording discord ${command} amount from ${sourceAuthor} for ${nimAmount} to ${rainDestinations.length} accounts`);
          await dynamo.putTransaction(messageId, {
            sourceAuthor,
            sourceAddress,
            sourceBalance,
            nimAmount,
            privateKey,
            rainDestinations,
            replyMetadata: { // when the transaction later gets sent, this info is used to send the reply message back to user
              discord: {
                channelId,
                ...newReplyMessage && { messageId: newReplyMessage.id }
              }
            },
            heightRecorded: $.getHeight($)
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
