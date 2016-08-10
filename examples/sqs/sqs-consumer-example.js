"use strict";

const SqsConsumer = require('aws-sdk-js-ext').sqs.SqsConsumer;

class SqsConsumerExample extends SqsConsumer{
  handle(msgBody) {
    // Do something here and return a promise

  }
}

new SqsConsumerExample().start();