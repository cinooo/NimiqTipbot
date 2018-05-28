const AWS = require('aws-sdk');
AWS.config.region = process.env.REGION;
const dynamo = new AWS.DynamoDB.DocumentClient();

const {
  DYNAMO_TABLE_TIPBOT_USERS,
  DYNAMO_TABLE_TIPBOT_TIPS
} = process.env;

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

export const queryTip = commentId => {
  const params = {
    TableName: DYNAMO_TABLE_TIPBOT_TIPS,
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

export const putTip = async (commentId, loggedDetails, time = new Date().getTime()) => {
  let params = {
    TableName: `${DYNAMO_TABLE_TIPBOT_TIPS}`,
    Item: {
      commentId,
      ...loggedDetails,
      createdat: time,
      updatedat: time
    }
  };

  // Need to consider what to do if dynamo put fails
  return dynamo.put(params).promise();
};

export const updateTip = async (commentId, processed) => {
  try {
    const params = {
      TableName: `${DYNAMO_TABLE_TIPBOT_TIPS}`,
      Key: {
        commentId
      },
      AttributeUpdates: {
        processed: {
          Action: 'PUT',
          Value: processed
        }
      }
    };
    await dynamo.update(params).promise().catch((e) => {
      console.error('Error with dynamo put', params, e);
      return Promise.resolve();
    });
  } catch (e) {
    console.error('Error updateTip', e);
  }
};
