"use strict";

require('../../init-chai');

const
  error = require('../../../lib/common/error'),
  commonUtils = require('../../../lib/common/utils'),
  SqsConsumer = require('../../../lib/sqs/sqs-consumer'),
  sinon = require('sinon'),
  chai = require("chai");

const
  MOCK_QUEUE_URL = 'http://MockQueueUrl',
  EXPECTED_MESSAGE_VISIBILITY = 62, //seconds
  EXPECTED_POLL_WAIT = 12000; //ms

describe('SqsConsumer', () => {
  let consumer, sqs, schemaService;

  beforeEach(() => {
    sqs = {
      changeMessageVisibility: sinon.stub().returns({
        promise: () => Promise.resolve({})
      }),
      createQueue: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      getQueueUrl: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      receiveMessage: sinon.stub().returns({
        promise: () => Promise.resolve({})
      }),
      deleteMessage: sinon.stub().returns({
        promise: () => Promise.resolve({})
      })
    };
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
  });

  afterEach(() => {
    commonUtils.wait.restore();
  });

  describe('start', () => {
    beforeEach(() => {
      consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve());
      sinon.stub(consumer, '_checkPoll').onFirstCall().returns(true).onSecondCall().returns(false);
    });

    afterEach(() => {
      consumer._checkPoll.restore();
    });

    it('should not start polling if initialization fails', () => {
      const mockError = new Error('MockError');
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(mockError) });

      return consumer.start(true).catch((error) => {
        error.should.be.equal(mockError);
      });
    });

    it('should poll if initialization succeeds', () => {

      // No error should be thrown
      return consumer.start().then(()=>{
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should continue polling if there are no messages from queue', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: []}) });
      // No error should be thrown
      return consumer.start(true).then(()=>{
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should poll and process messages from queue', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          ReceiptHandle: 'handle1'
        },
        {
          Body: "{}",
          ReceiptHandle: 'handle2'
        }
      ]})});
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledTwice;
        sqs.deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        sqs.deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle2'});
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should poll, validate and process messages from queue when schema is defined', () => {
      consumer.conf.schema.name = 'mock-schema';
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          ReceiptHandle: 'handle1'
        }
      ]})});
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledOnce;
        sqs.deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle error in message processing', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]})});
      consumer.handle = msBody => Promise.reject(new Error('MockError'));
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.not.be.called;
        sqs.changeMessageVisibility.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL,
          ReceiptHandle: "handle1",
          VisibilityTimeout: EXPECTED_MESSAGE_VISIBILITY });
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });

    it('should handle syntax error in message processing', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]})});
      consumer.handle = msBody => Promise.reject(new SyntaxError('MockError'));
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        sqs.changeMessageVisibility.should.not.be.called;
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle NonRetryableError  in message processing', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]})});
      consumer.handle = msBody => Promise.reject(new error.NonRetryableError('MockError'));
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        sqs.changeMessageVisibility.should.not.be.called;
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle validation error during message processing', () => {
      consumer.conf.schema = '{"type": "array"}';

      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]})});
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        sqs.changeMessageVisibility.should.not.be.called;
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle error in message deletion', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]})});
      sqs.deleteMessage.returns({ promise: Promise.reject(new Error('MockError during deletion'))});
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledOnce;
        sqs.changeMessageVisibility.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL,
          ReceiptHandle: "handle1",
          VisibilityTimeout: EXPECTED_MESSAGE_VISIBILITY });
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });

    it('should wait prior to polling for second run if there is an error in processing', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.reject(new Error('MockError'))});
      // No error should be thrown
      return consumer.start(true).then(()=>{
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });
  });

  describe('checkPoll', () => {
    beforeEach(() => {
      consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve());
    });

    it('should return false if queueUrl is not initialized', () => {
      consumer._running=true;

      consumer._checkPoll().should.be.false;
      consumer._running.should.be.false;
    });

    it('should return false if not running', () => {
      consumer._checkPoll().should.be.false;
    });

    it('should return true if queueUrl is initialized and is running', () => {
      consumer._running=true;
      consumer._queueUrl=MOCK_QUEUE_URL;

      consumer._checkPoll().should.be.true;
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve());
    });

    it('should stop polling', () => {
      consumer._running=true;
      consumer.stop();
      consumer._running.should.be.false;
    });
  });

  describe('_scheduledConsuming', () => {
    let config = {
          defaults: {
            consumer: {
              scheduler: {
                scheduled: true,
                start: '12:00:00',
                duration: 2 * 60 * 60,
                maxVisibilityTimeout: 10
              }
            }
          }
        },
        messages = {
          Messages: [{Body: "{}",ReceiptHandle: 'handle1'}]
        };

    beforeEach(() => {
      config = {
        defaults: {
          consumer: {
            scheduler: {
              scheduled: true,
              start: '12:00:00',
              duration: 2 * 60 * 60,
              maxVisibilityTimeout: 10
            }
          }
        }
      };
    });

    context('when consumer config is not present', () => {
      before(() => {
        delete config.defaults.consumer.scheduler;
        consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve(), {sqs: config});
      });

      it('resolves the original data', () => {
        sqs.receiveMessage.returns({ promise: () => Promise.resolve(messages)});
        return sqs.receiveMessage()
          .promise()
          .then(data => {
            return consumer._scheduledConsuming(data);
          })
          .then(data => {
            data.should.deep.equal(messages);
          });
      });
    });

    context('when consumer is not scheduled', () => {
      before(() => {
        config.defaults.consumer.scheduler.scheduled = false;
        consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve(), {sqs: config});
      });

      it('resolves the original data', () => {
        sqs.receiveMessage.returns({ promise: () => Promise.resolve(messages)});
        return sqs.receiveMessage()
          .promise()
          .then(data => {
            return consumer._scheduledConsuming(data);
          })
          .then(data => {
            data.should.deep.equal(messages);
          });
      });
    });

    context('when polling messages before the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(9, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('resolves an empty array', () => {
        sqs.receiveMessage.returns({ promise: () => Promise.resolve(messages)});
        return sqs.receiveMessage()
          .promise()
          .then(data => consumer._scheduledConsuming(data))
          .then(data => {
            data.should.deep.equal({});
          });
      });
    });

    context('when polling messages during the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(13, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('resolves the original data', () => {
        sqs.receiveMessage.returns({ promise: () => Promise.resolve(messages)});
        return sqs.receiveMessage()
          .promise()
          .then(data => {
            return consumer._scheduledConsuming(data);
          })
          .then(data => {
            data.should.deep.equal(messages);
          });
      });
    });

    context('when polling messages after the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(16, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('resolves an empty array', () => {
        sqs.receiveMessage.returns({ promise: () => Promise.resolve(messages)});
        return sqs.receiveMessage()
          .promise()
          .then(data => consumer._scheduledConsuming(data))
          .then(data => {
            data.should.deep.equal({});
          });
      });
    });
  });
});
