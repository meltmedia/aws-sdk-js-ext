"use strict";

require('../../init-chai');

const
  error = require('../../../lib/common/error'),
  commonUtils = require('../../../lib/common/utils'),
  ValidationUtil = require('../../../lib/common/validation'),
  SqsConsumer = require('../../../lib/sqs/sqs-consumer'),
  _ = require('lodash'),
  sinon = require('sinon'),
  chai = require("chai"),
  expect = chai.expect;

const
  MOCK_QUEUE_URL = 'http://MockQueueUrl',
  CONSUMERS_CONF = {
    defaults: {
      schema: {},
      queue: {
        env: 'test',
      }
    },
    mock: {
      queue: {
        prefix: 'MockQueue'
      }
    }
  },
  EXPECTED_MESSAGE_VISIBILITY = 62, //seconds
  EXPECTED_POLL_WAIT = 12000; //ms

describe('SqsConsumer', () => {
  let consumer, sqs, schemaService;

  beforeEach(() => {
    sqs = {};
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
    consumer = new SqsConsumer({}, msgBody => Promise.resolve());
    consumer._changeMessageVisibility = sinon.stub().returns(Promise.resolve({}));
    consumer._createQueue = sinon.stub().returns(Promise.resolve({QueueUrl: MOCK_QUEUE_URL}));
    consumer._getQueueUrl = sinon.stub().returns(Promise.resolve({QueueUrl: MOCK_QUEUE_URL}));
    consumer._receiveMessage = sinon.stub().returns(Promise.resolve({}));
    consumer._deleteMessage = sinon.stub().returns(Promise.resolve({}));
  });

  afterEach(() => {
    commonUtils.wait.restore();
  });

  describe('init', () => {
    it('should initialize queue url for existing queue', () => {
      return consumer._init().then(() => {
        expect(consumer._queueUrl).not.be.null;
        consumer._queueUrl.should.be.equal(MOCK_QUEUE_URL);
      });
    });

    it('should initialize queue url for non existing queue', () => {
      const error = new Error('MockError');
      error.code = 'AWS.SimpleQueueService.NonExistentQueue';
      consumer._getQueueUrl.returns(Promise.reject(error));
      return consumer._init().then(() => {
        expect(consumer._queueUrl).should.not.be.null;
        consumer._queueUrl.should.be.equal(MOCK_QUEUE_URL);
      });
    });

    it('should fail to initialize queue getQueueUrl when AWS Call fails for getQueueUrl', () => {
      const mockError = new Error('MockError');
      consumer._getQueueUrl.returns(Promise.reject(mockError));
      return consumer._init().catch((error) => {
        expect(consumer._queueUrl).be.null;
        error.should.be.equal(mockError);
      });
    });

    it('should fail to initialize queue getQueueUrl when AWS Call fails for createQueue', () => {
      const mockNonExistingError = new Error('MockNonExistingQueueError');
      mockNonExistingError.code = 'AWS.SimpleQueueService.NonExistentQueue';
      consumer._getQueueUrl.returns(Promise.reject(mockNonExistingError));

      const mockCreateQueueError = new Error('MockCreateQueueError');
      consumer._createQueue.returns(Promise.reject(mockCreateQueueError));

      return consumer._init().catch((error) => {
        expect(consumer._queueUrl).be.null;
        error.should.be.equal(mockCreateQueueError);
      });
    });

    it('should not re-initialize queue url', () => {
      consumer._queueUrl = MOCK_QUEUE_URL;
      return consumer._init().then(() => {
        expect(consumer._queueUrl).be.equal(MOCK_QUEUE_URL);
        consumer._getQueueUrl.should.not.be.called;
        consumer._createQueue.should.not.be.called;
      });
    });

  });

  describe('start', () => {
    beforeEach(() => {
      sinon.stub(consumer, '_checkPoll').onFirstCall().returns(true).onSecondCall().returns(false);
    });

    afterEach(() => {
      consumer._checkPoll.restore();
    });

    it('should not start polling if initialization fails', () => {
      const mockError = new Error('MockError');
      consumer._getQueueUrl.returns(Promise.reject(mockError));

      return consumer.start().catch((error) => {
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
      consumer._receiveMessage.returns(Promise.resolve({Messages: []}));
      // No error should be thrown
      return consumer.start().then(()=>{
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should poll and process messages from queue', () => {
      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          ReceiptHandle: 'handle1'
        },
        {
          Body: "{}",
          ReceiptHandle: 'handle2'
        }
      ]}));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.be.calledTwice;
        consumer._deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        consumer._deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle2'});
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should poll, validate and process messages from queue when schema is defined', () => {
      consumer.conf.schema.name = 'mock-schema';
      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          ReceiptHandle: 'handle1'
        }
      ]}));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.be.calledOnce;
        consumer._deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle error in message processing', () => {
      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]}));
      consumer.handler = msBody => Promise.reject(new Error('MockError'));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.not.be.called;
        consumer._changeMessageVisibility.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL,
          ReceiptHandle: "handle1",
          VisibilityTimeout: EXPECTED_MESSAGE_VISIBILITY });
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });

    it('should handle syntax error in message processing', () => {
      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]}));
      consumer._handleMessageBody = msBody => Promise.reject(new SyntaxError('MockError'));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        consumer._changeMessageVisibility.should.not.be.called;
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle NonRetryableError  in message processing', () => {
      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]}));
      consumer._handleMessageBody = msBody => Promise.reject(new error.NonRetryableError('MockError'));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        consumer._changeMessageVisibility.should.not.be.called;
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle validation error during message processing', () => {
      consumer.conf.schema = '{"type": "array"}';

      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]}));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL, ReceiptHandle: 'handle1'});
        consumer._changeMessageVisibility.should.not.be.called;
        commonUtils.wait.should.not.be.called;
      });
    });

    it('should handle error in message deletion', () => {
      consumer._receiveMessage.returns(Promise.resolve({Messages: [
        {
          Body: "{}",
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]}));
      consumer._deleteMessage.returns(Promise.reject(new Error('MockError during deletion')));
      return consumer.start().then(()=>{
        consumer._deleteMessage.should.be.calledOnce;
        consumer._changeMessageVisibility.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL,
          ReceiptHandle: "handle1",
          VisibilityTimeout: EXPECTED_MESSAGE_VISIBILITY });
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });

    it('should wait prior to polling for second run if there is an error in processing', () => {
      consumer._receiveMessage.returns(Promise.reject(new Error('MockError')));
      // No error should be thrown
      return consumer.start().then(()=>{
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });
  });

  describe('checkPoll', () => {
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
    it('should stop polling', () => {
      consumer._running=true;
      consumer.stop();
      consumer._running.should.be.false;
    });
  });
});