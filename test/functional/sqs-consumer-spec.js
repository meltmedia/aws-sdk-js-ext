"use strict";

require('../init-chai');

const 
  AWS = require('aws-sdk'),
  SqsConsumer = require('../../lib/sqs/sqs-consumer'),
  sinon = require('sinon'),
  chai = require('chai'),
  winston = require('winston'),
  should = chai.should();

const
  TEST_SQS_QUEUE_NAME = 'TEST_SQS_QUEUE_NAME',
  MAX_RETRIES = 3,
  AWS_EXT_CONFIG = {
    sqs: {
      defaults: {
        consumer: {
          enabled: true
        },
        message: {
          error: {
            minVisibility: 1, // seconds
            maxVisibility: 2, //seconds
            maxRetries: MAX_RETRIES
          }
        },
        poll: {
          interval: 1,  // seconds
          error: {
            maxWait: 5,  //seconds
            minWait: 1  //seconds
          }
        }
      },
      unsubscribe: {
        queue: {
          prefix: 'TEST_SQS_QUEUE_NAME'
        }
      }
    },
    encryption: {
      key: 'Key Name'
    }
  };

describe('Sqs Consumer', () => {
  let sqs, queueURL, consumer;

  before(done => {
    AWS.config.update({ region: 'REGION' });
    sqs = new AWS.SQS({
      apiVersion: '2012-11-05',
      endpoint: 'http://localhost:9324'
    });

    let params = {
      QueueName: TEST_SQS_QUEUE_NAME,
    };

    consumer = new SqsConsumer({ sqs: sqs }, null, AWS_EXT_CONFIG);
    consumer._queueName = TEST_SQS_QUEUE_NAME;

    sqs.createQueue(params, function (err, data) {
      if (err) {
        console.log(err, err.stack);
        done();
      } else {
        queueURL = data.QueueUrl;
        consumer._queueUrl = queueURL;
        done();
      }
    });
  });

  beforeEach(done => {
    let defaultMessage = {
      MessageBody: '{ "test" : true }',
      QueueUrl: queueURL
    };

    sqs.sendMessage(defaultMessage, function (err, data) {
      if (err) {
        console.log(err, err.stack);
        done();
      } else {
        done();
      }
    });
  })

  afterEach(done => {
    sqs.purgeQueue({ QueueUrl: queueURL }, function (err, data) {
      if (err) {
        console.log(err, err.stack);
        done();
      } else {
        done();
      }
    });
  });

  it('consumer should only throw errors after max retry attempts', done => {
    let winstonSpy = sinon.spy(winston, 'error');
    let consumerSpy = sinon.spy(consumer, "handleError");
    consumer.handle = msgBody => Promise.reject(new Error('MockError'));
    consumer.start();
    consumer.on('failed', (msg, msgBody, err) => {
      //The reason this value is max_retries + 1 is the actual error message happens after this event is emitted
      if (consumerSpy.callCount >= MAX_RETRIES + 1) {
        consumerSpy.callCount.should.be.equal(MAX_RETRIES + 1);
        winstonSpy.callCount.should.be.equal(1);
        done();
      } else{
        winstonSpy.callCount.should.be.equal(0);
      }
    });
  }).timeout(12000);
});
