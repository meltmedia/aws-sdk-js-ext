"use strict";

require('../../init-chai');

const
  error = require('../../../lib/common/error'),
  commonUtils = require('../../../lib/common/utils'),
  SqsBase = require('../../../lib/sqs/sqs-base'),
  _ = require('lodash'),
  sinon = require('sinon'),
  chai = require("chai"),
  expect = chai.expect;

const
  MOCK_QUEUE_URL = 'http://MockQueueUrl';

describe('SqsConsumer', () => {
  let sqsBase, sqs, schemaService;

  beforeEach(() => {
    sqs = {
      createQueue: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      getQueueUrl: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      })
    };
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
    sqsBase = new SqsBase({sqs: sqs}, msgBody => Promise.resolve());
  });

  afterEach(() => {
    commonUtils.wait.restore();
  });

  describe('init', () => {
    it('should initialize queue url for existing queue', () => {
      return sqsBase._init().then(() => {
        expect(sqsBase._queueUrl).not.be.null;
        sqsBase._queueUrl.should.be.equal(MOCK_QUEUE_URL);
      });
    });

    it('should initialize queue url for non existing queue', () => {
      const error = new Error('MockError');
      error.code = 'AWS.SimpleQueueService.NonExistentQueue';
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(error) });
      return sqsBase._init().then(() => {
        expect(sqsBase._queueUrl).should.not.be.null;
        sqsBase._queueUrl.should.be.equal(MOCK_QUEUE_URL);
      });
    });

    it('should fail to initialize queue getQueueUrl when AWS Call fails for getQueueUrl', () => {
      const mockError = new Error('MockError');
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(mockError) });
      return sqsBase._init().catch((error) => {
        expect(sqsBase._queueUrl).be.null;
        error.should.be.equal(mockError);
      });
    });

    it('should fail to initialize queue getQueueUrl when AWS Call fails for createQueue', () => {
      const mockNonExistingError = new Error('MockNonExistingQueueError');
      mockNonExistingError.code = 'AWS.SimpleQueueService.NonExistentQueue';
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(mockNonExistingError) });

      const mockCreateQueueError = new Error('MockCreateQueueError');
      sqs.createQueue.returns({ promise: () => Promise.reject(mockCreateQueueError) });


      return sqsBase._init().catch((error) => {
        expect(sqsBase._queueUrl).be.null;
        error.should.be.equal(mockCreateQueueError);
      });
    });

    it('should not re-initialize queue url', () => {
      sqsBase._queueUrl = MOCK_QUEUE_URL;
      return sqsBase._init().then(() => {
        expect(sqsBase._queueUrl).be.equal(MOCK_QUEUE_URL);
        sqs.getQueueUrl.should.not.be.called;
        sqs.createQueue.should.not.be.called;
      });
    });

  });
});