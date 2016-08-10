"use strict";

const SqsConsumer = require('aws-sdk-js-ext').sqs.SqsConsumer;

class SqsConsumerExample extends SqsConsumer{
  handle(msgBody) {
    // Do something here and return a promise

  }
}

/**
 * Create consumer by passing config.
 * Alternatively you can specify config in config module
 *
 * @type {SqsConsumerExample}
 */
let consumer = new SqsConsumerExample({
  name: 'sqs-consumer-example',
  conf: {
    queue: {
      prefix: 'sqs-consumer-example-',
    }
  }
});


consumer.start();
