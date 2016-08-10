"use strict";

const SqsConsumer =  require('../../lib').sqs.SqsConsumer, //require('aws-sdk-js-ext').sqs.SqsConsumer,
  winston = require('winston'),
  AWS = require('aws-sdk'),
  promisify = require('es6-promisify'),
  utils = require('aws-sdk-js-ext').utils;

class SqsConsumerExample extends SqsConsumer{
  handle(msgBody) {
    winston.info(`SqsConsumer::${this.name}:: Handled message: ${JSON.stringify(msgBody)}`);
  }
}

const sqs = new AWS.SQS({
  region: 'us-west-2'
});

/**
 * Create consumer by passing config.
 * Alternatively you can specify config in config module
 *
 * @type {SqsConsumerExample}
 */
const consumer = new SqsConsumerExample({
  name: 'sqs-consumer-example',
  conf: {
    queue: {
      prefix: 'sqs-consumer-example-',
    }
  },
  sqs: sqs // Optional
});


consumer.start().then(() => {
  return sqs.sendMessage({
    MessageBody: JSON.stringify({"test": "test"}),
    QueueUrl: consumer.status().queueUrl,
  }).promise()
    .catch(err => {
      winston.error(err);
      throw err;
    });
});

// We stop the consumer after 20s.
// In actual application, you can stop the queue on SIGINT
utils.wait(20000).then(() => consumer.stop());
