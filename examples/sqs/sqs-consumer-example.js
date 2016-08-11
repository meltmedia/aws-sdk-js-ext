"use strict";

const SqsConsumer =   require('aws-sdk-js-ext').sqs.SqsConsumer, //require('../../lib').sqs.SqsConsumer
  winston = require('winston'),
  promisify = require('es6-promisify'),
  config = require('config'),
  utils = require('aws-sdk-js-ext').utils;

class SqsConsumerExample extends SqsConsumer{
  handle(msgBody) {
    winston.info(`SqsExample::${this.name}:: Handled message: ${JSON.stringify(msgBody)}`);
  }
}

/**
 * Create consumer
 *
 * @type {SqsConsumerExample}
 */
const consumer = new SqsConsumerExample({
  name: 'sqs-consumer-example', // This is name of consumer and not queue name
  conf: { }, // Override conf/default.yaml settings here
  sqs: null // If not specified, it will automatically be created.
});





consumer.on('running', () => {

  winston.info("SqsExample:: Sending test message");
  return consumer._sqs.sendMessage({
    MessageBody: JSON.stringify({"id": 1, "test": "test"}),
    QueueUrl: consumer.status().queueUrl,
  }).promise()
    .catch(err => {
      winston.error(err);
      throw err;
  });
});

consumer.on('stopped', () => {
  winston.info(`SqsExample::${consumer.name}:: Consumer stopped`);
});


consumer.start();
// We stop the consumer after 20s.
// In actual application, you can stop the queue on SIGINT
utils.wait(20000).then(() => consumer.stop());
