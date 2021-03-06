'use strict';

require('../../init-chai');

const
  _ = require('lodash'),
  error = require('../../../lib/common/error'),
  commonUtils = require('../../../lib/common/utils'),
  SqsConsumer = require('../../../lib/sqs').SqsConsumer,
  sinon = require('sinon'),
  chai = require('chai'),
  should = chai.should();

const
  MOCK_QUEUE_URL = 'http://MockQueueUrl',
  MOCK_MESSAGE_WITH_ID = {MessageId: 'MOCK-MESSAGE-ID'},
  EXPECTED_MESSAGE_VISIBILITY = 120, //seconds
  EXPECTED_POLL_WAIT = 20000; //ms

const
  encryptFixture = require('../fixtures/encryption-fixture');

describe('SqsConsumer', () => {
  let consumer, sqs, kms, conf;

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
    kms = {
      generateDataKey: sinon.stub().returns({
        promise: () => Promise.resolve({
          Plaintext: Buffer.from(encryptFixture.PLAINTEXT_KEY, 'hex'),
          CiphertextBlob: Buffer.from(encryptFixture.CIPHERTEXT_KEY, 'hex')
        })
      }),
      decrypt: sinon.stub().returns({
        promise: () => Promise.resolve({
          Plaintext: Buffer.from(encryptFixture.PLAINTEXT_KEY, 'hex')
        })
      })
    };
    conf = {
      encryption: {
        key: 'Key Name'
      }
    };
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
  });

  afterEach(() => {
    commonUtils.wait.restore();
  });

  describe('start', () => {
    beforeEach(() => {
      consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve());
      sinon.stub(consumer, '_checkPoll').onFirstCall().returns(true).onSecondCall().returns(false);
    });

    afterEach(() => {
      consumer._checkPoll.restore();
    });

    it('should not start polling if enabled is false', () => {
      let newConf = Object.assign({}, conf, { consumer: { enabled: false } });
      let disabledConsumer = new SqsConsumer({ sqs, kms, conf: newConf }, msgBody => Promise.resolve());

      return disabledConsumer.start(true)
        .then(() => {
          disabledConsumer.conf.consumer.enabled.should.be.false;
          disabledConsumer.running.should.be.false;
        });

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
          MessageId: '1',
          Body: '{}',
          ReceiptHandle: 'handle1'
        },
        {
          MessageId: '2',
          Body: '{}',
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
          MessageId: '1',
          Body: '{}',
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
          MessageId: '1',
          Body: '{}',
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
          ReceiptHandle: 'handle1',
          VisibilityTimeout: EXPECTED_MESSAGE_VISIBILITY });
        commonUtils.wait.should.be.calledWith(EXPECTED_POLL_WAIT);
      });
    });

    it('should handle syntax error in message processing', () => {
      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          MessageId: '1',
          Body: '{}',
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
          MessageId: '1',
          Body: '{}',
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
      consumer.conf.schema = {type: 'array'};

      sqs.receiveMessage.returns({ promise: () => Promise.resolve({Messages: [
        {
          MessageId: '1',
          Body: '{}',
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
          MessageId: '1',
          Body: '{}',
          Attributes: {
            ApproximateReceiveCount: 1
          },
          ReceiptHandle: 'handle1'
        }
      ]})});
      sqs.deleteMessage.returns({ promise: () => Promise.reject(new Error('MockError during deletion'))});
      return consumer.start(true).then(()=>{
        sqs.deleteMessage.should.be.calledOnce;
        sqs.changeMessageVisibility.should.be.calledWith({
          QueueUrl: MOCK_QUEUE_URL,
          ReceiptHandle: 'handle1',
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
      consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve());
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
      consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve());
      consumer.start();
    });

    it('should stop polling', () => {
      return consumer.stop().then(() => {
        consumer._running.should.be.false;
        should.not.exist(consumer._queueUrl);
      });
    });
  });

  describe('_scheduledConsuming', () => {
    let config,
    messages = {
      Messages: [{MessageId: '1', Body: '{}',ReceiptHandle: 'handle1'}]
    };

    before(() => {
      config = {
        defaults: {
          consumer: {
            scheduler: {
              scheduled: true,
              start: '12:00:00',
              duration: '2 hours',
              maxVisibilityTimeout: '10 seconds'
            }
          }
        }
      };
    });

    context('when consumer config is not present', () => {
      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: {}});
      });

      it('resolves the original data', () => {
        return consumer._scheduledConsuming(messages)
          .then(data => {
            data.should.deep.equal(messages);
          });
      });
    });

    context('when consumer is not scheduled', () => {
      before(() => {
        let mockConfig = _.cloneDeep(config);
        mockConfig.defaults.consumer.scheduler.scheduled = false;
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: mockConfig});
      });

      it('resolves the original data', () => {
        return consumer._scheduledConsuming(messages)
          .then(data => {
            data.should.deep.equal(messages);
          });
      });
    });

    context('when scheduling messages before the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(9, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('resolves an empty object', () => {
        return consumer._scheduledConsuming(messages)
          .then(data => {
            data.should.deep.equal({});
          });
      });
    });

    context('when scheduling messages during the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(13, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('resolves the original data', () => {
        return consumer._scheduledConsuming(messages)
          .then(data => {
            data.should.deep.equal(messages);
          });
      });
    });

    context('when scheduling messages after the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(16, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('resolves an empty object', () => {
        return consumer._scheduledConsuming(messages)
          .then(data => {
            data.should.deep.equal({});
          });
      });
    });

    context('when there are no messages to consume', () => {

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
      });

      it('resolves the original object: {}', () => {
        return consumer._scheduledConsuming({})
          .then(data => {
            data.should.deep.equal({});
          });
      });

      it('resolves the original object: { Messages: [] }', () => {
        return consumer._scheduledConsuming({Messages: []})
          .then(data => {
            data.should.deep.equal({Messages: []});
          });
      });
    });
  });

  describe('_getVisibilityTimeout', () => {
    let config,
        messages = {
          Messages: [{MessageId: '1', Body: '{}',ReceiptHandle: 'handle1'}]
        };

    beforeEach(() => {
      config = {
        defaults: {
          consumer: {
            scheduler: {
              scheduled: true,
              start: '12:00:00',
              duration: '2 hours',
              maxVisibilityTimeout: '6 hours'
            }
          }
        }
      };
    });

    describe('when outside the scheduled processing window', () => {
      let clock;

      beforeEach(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
      });

      afterEach(() => {
        clock.restore();
      });

      context('by a duration larger than the max visibility timeout', () => {
        before(() => {
          clock = sinon.useFakeTimers(new Date().setHours(5, 0, 0));
        });

        it('returns the max visibility', () => {
          let timeout = consumer._getVisibilityTimeout();
          timeout.should.equal(6 * 60 * 60);
        });
      });

      context('by a duration smaller than the max visibility timeout', () => {
        before(() => {
          clock = sinon.useFakeTimers(new Date().setHours(11, 0, 0));
        });

        it('returns a timeout of the difference between now and the scheduled processing window', () => {
          let timeout = consumer._getVisibilityTimeout();
          timeout.should.equal(1 * 60 * 60);
        });
      });
    });

    describe('when in the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(13, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('returns a timeout of 0', () => {
        let timeout = consumer._getVisibilityTimeout();
        timeout.should.equal(0);
      });
    });

  });

  describe('isConsuming', () => {
    let config,
        messages = {
          Messages: [{MessageId: '1', Body: '{}',ReceiptHandle: 'handle1'}]
        };

    before(() => {
      config = {
        defaults: {
          consumer: {
            scheduler: {
              scheduled: true,
              start: '12:00:00',
              duration: '2 hours',
              maxVisibilityTimeout: '6 hours'
            }
          }
        }
      };
    });

    context('when the consumer is not scheduled', () => {

      before(() => {
        let mockConfig = _.cloneDeep(config);
        mockConfig.defaults.consumer.scheduler.scheduled = false;
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: mockConfig});
      });

      it('returns true', () => {
        let isConsuming = consumer.isConsuming();
        isConsuming.should.be.true;
      });
    });

    context('when outside the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(5, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('returns false', () => {
        let isConsuming = consumer.isConsuming();
        isConsuming.should.be.false;
      });
    });

    context('when in the scheduled processing window', () => {
      let clock;

      before(() => {
        consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve(), {sqs: config});
        clock = sinon.useFakeTimers(new Date().setHours(13, 0, 0));
      });

      after(() => {
        clock.restore();
      });

      it('returns true', () => {
        let isConsuming = consumer.isConsuming();
        isConsuming.should.be.true;
      });
    });

  });

  describe('_decryptMessage()', () => {
    let conf;

    before(() => {
      conf = {
        encryption: {
          key: 'Key Name'
        }
      };
      consumer = new SqsConsumer({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve());
    });

    beforeEach(() => {
      consumer._encryption = conf.encryption;
    });

    it('returns the original message body if there is nothing to decrypt', () => {
      let messageBody = {myProperty: 'myValue'};
      return consumer._decryptMessage(messageBody, MOCK_MESSAGE_WITH_ID)
        .then(decryptedMessage => {
          decryptedMessage.should.equal(messageBody);
        });
    });

    it('returns the decrypted message body', () => {
      let messageBody = {myProperty: 'myValue', encrypted: encryptFixture.ENCRYPTED_PAYLOAD};
      return consumer._decryptMessage(messageBody, MOCK_MESSAGE_WITH_ID)
        .then(decryptedMessage => {
          decryptedMessage.should.eql(_.merge({}, {myProperty: 'myValue'}, encryptFixture.DATA));
        });
    });

    it('throws NonRetryableError when key is not present', () => {
      let messageBody = {myProperty: 'myValue', encrypted: {
        data: encryptFixture.ENCRYPTED_PAYLOAD.data
      }};
      return consumer._decryptMessage(messageBody, MOCK_MESSAGE_WITH_ID).should.be.eventually.rejectedWith(
        error.NonRetryableError);
    });

    it('throws NonRetryableError when key is not valid', () => {
      let messageBody = {myProperty: 'myValue', encrypted: {
        key: 'invalid',
        data: encryptFixture.ENCRYPTED_PAYLOAD.data
      }};
      return consumer._decryptMessage(messageBody, MOCK_MESSAGE_WITH_ID).should.be.eventually.rejectedWith(
        error.NonRetryableError);
    });
  });

});
