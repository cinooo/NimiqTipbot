import nimiqHelper from '../nimiqHelper.js';
const AWS = require('aws-sdk');
AWS.config.region = process.env.REGION;
const dynamo = new AWS.DynamoDB.DocumentClient();

const {
  DYNAMO_TABLE_TIPBOT_USERS,
  DYNAMO_TABLE_TIPBOT_TRANSACTIONS,
  DYNAMO_TABLE_TIPBOT_TRANSACTIONS_ARCHIVED
} = process.env;

export const TIPS_STATUS_NEW = 'New';
export const TIPS_STATUS_PENDING = 'Pending';
export const TIPS_STATUS_ERROR = 'Error';
export const TIPS_STATUS_COMPLETE = 'Complete';

export const query = (params) => {
  return dynamo.query(params).promise().catch((e) => {
    console.error('Error with dynamo query', params, e);
    return Promise.resolve();
  });
};

export const queryUser = authorName => {
  const params = {
    TableName: DYNAMO_TABLE_TIPBOT_USERS,
    KeyConditionExpression: 'authorName = :authorName',
    ExpressionAttributeValues: {
      ':authorName': authorName
    }
  };
  // console.log(params);
  return query(params);
};

export const queryTransaction = commentId => {
  const params = {
    TableName: DYNAMO_TABLE_TIPBOT_TRANSACTIONS,
    KeyConditionExpression: 'commentId = :commentId',
    ExpressionAttributeValues: {
      ':commentId': commentId
    }
  };
  // console.log(params);
  return query(params);
};

export const deleteItem = (table, key) => {
  var params = {
    TableName: table,
    Key: key,
    ReturnValues: 'ALL_OLD'
  };
  return dynamo.delete(params).promise();
};

export const deleteTransaction = key => {
  return dynamo.deleteItem(DYNAMO_TABLE_TIPBOT_TRANSACTIONS, key);
};

export const putUser = async ({ authorName, privateKey, phrases, publicAddress }, time = new Date().getTime()) => {
  let params = {
    TableName: `${DYNAMO_TABLE_TIPBOT_USERS}`,
    Item: {
      authorName,
      createdat: time,
      privateKey,
      phrases,
      publicAddress
    }
  };

  // Need to consider what to do if dynamo put fails
  return dynamo.put(params).promise();
};

export const putTransaction = async (commentId, loggedDetails, time = new Date().getTime()) => {
  let params = {
    TableName: `${DYNAMO_TABLE_TIPBOT_TRANSACTIONS}`,
    Item: {
      commentId,
      status: TIPS_STATUS_NEW,
      ...loggedDetails,
      createdat: time,
      updatedat: time
    }
  };

  // Need to consider what to do if dynamo put fails
  return dynamo.put(params).promise();
};

export const archiveTransaction = async (loggedDetails, time = new Date().getTime()) => {
  let params = {
    TableName: `${DYNAMO_TABLE_TIPBOT_TRANSACTIONS_ARCHIVED}`,
    Item: {
      ...loggedDetails,
      status: TIPS_STATUS_COMPLETE,
      updatedat: time
    }
  };

  // Need to consider what to do if dynamo put fails
  return dynamo.put(params).promise();
};

export const updateTransaction = async (commentId, status = TIPS_STATUS_PENDING) => {
  try {
    const params = {
      TableName: `${DYNAMO_TABLE_TIPBOT_TRANSACTIONS}`,
      Key: {
        commentId
      },
      AttributeUpdates: {
        status: {
          Action: 'PUT',
          Value: TIPS_STATUS_PENDING
        }
      }
    };
    await dynamo.update(params).promise().catch((e) => {
      console.error('Error with dynamo put', params, e);
      return Promise.resolve();
    });
  } catch (e) {
    console.error('Error updateTransaction', e);
  }
};

// get a reddit user's public address, create one if it doesnt exist
export async function getUserPublicAddress(authorName, $) {
  const results = await queryUser(authorName);
  const { privateKey, phrases, publicAddress } = results.Count === 0 ? await nimiqHelper.generateAddress() : results.Items[0];
  if (results.Count === 0) {
    console.log('User not found, creating new user', authorName);
    // save the user if it is a newly generated one
    await putUser({authorName, privateKey, publicAddress, phrases});
  }
  const balance = await $.getBalance(publicAddress);
  return {
    balance,
    publicAddress,
    privateKey,
    phrases
  };
};

export const scan = async (table, lastEvaluatedKey, limit) => {
  const params = {
    'TableName': table,
    ...lastEvaluatedKey && {'ExclusiveStartKey': lastEvaluatedKey},
    'Select': 'ALL_ATTRIBUTES',
    ...typeof limit !== 'undefined' && {'Limit': limit},
    'ConsistentRead': true // takes into account writes since scan started
  };
  return dynamo.scan(params).promise();
};

const wait = s => new Promise(resolve => setTimeout(resolve, s * 1000));

// export const fullTableScan = async (table, scanLimit = 50) => {
//   let lastEvaluatedKey;
//   let results = {
//     items: [],
//     count: 0
//   };
//   do {
//     let response = await scan(table, lastEvaluatedKey, scanLimit);
//     await wait(1);
//     console.log(Object.keys(response));
//     results.items = results.items.concat(response.Items);
//     results.count += response.Count;
//     console.log(results.count);
//     lastEvaluatedKey = response.LastEvaluatedKey; // undefined if no more results left to scan
//   } while (lastEvaluatedKey);
//   return results;
// };
//
// export const scanTips = async () => {
//   let response = await scan(DYNAMO_TABLE_TIPBOT_TRANSACTIONS, null, 2);
//   return {
//     items: response.Items,
//     count: response.Count
//   };
// };

// export const fullTableScanTransactions = () => {
//   const scanResults = fullTableScan(DYNAMO_TABLE_TIPBOT_TRANSACTIONS);
//   const results = scanResults.filter(scanResult => {
//     return
//   })
// };

export const getTransactions = async (maxItems = 1) => {
  let lastEvaluatedKey;
  let items = [];
  const newTransactions = transactions => transactions.filter(transaction => transaction.status === TIPS_STATUS_NEW);
  do {
    let response = await scan(DYNAMO_TABLE_TIPBOT_TRANSACTIONS, lastEvaluatedKey, maxItems);
    await wait(1);
    // console.log(Object.keys(response));
    items = items.concat(response.Items);
    lastEvaluatedKey = response.LastEvaluatedKey; // undefined if no more results left to scan

    // only get transactions of New status
    items = newTransactions(items);
    items = items.slice(0, maxItems);
  } while (lastEvaluatedKey && items.length < maxItems);
  return items;
};
