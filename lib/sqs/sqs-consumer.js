"use strict";

require('promise.prototype.finally').shim();

const
  promisify = require("es6-promisify"),
  config = require("config"),
  _ = require('lodash'),
  winston = require('winston'),
  commonUtils = require('../common/utils'),
  encryption = require('../common/encryption'),
  readDuration = commonUtils.readDuration,
  error = require('../common/error'),
  SqsBase = require('./sqs-base'),
  humanInterval = require('human-interval'),
  moment = require('moment');

const DEFAULT_AWS_EXT_CONFIG = {
  sqs: {
    defaults: {
      poll: {
        interval: 20,  // seconds
        error: {
          maxWait: 600,  //seconds
          minWait: 10  //seconds
        }
      },
      message: {
        error: {
          minVisibility: 60, // seconds
          maxVisibility : 600 //seconds
        }
      },
    }
  }
};

/**
 * SQS Queue consumer that handles
 * - message parsing (JSON)
 * - validation
 * - Retries and Polling
 * - API Methods to get status and control consumer
 */
class SqsConsumer extends SqsBase {

  constructor(options, handler, defaultAwsExtConfig) {
    super(options, _.merge({}, DEFAULT_AWS_EXT_CONFIG, defaultAwsExtConfig));

    this._errorCnt = 0;
    this._running = false;
    this._lastPollDate = null;
    this._jobRetrier = new commonUtils.Retrier(this.conf.poll.error.minWait, this.conf.poll.error.maxWait);
    this._messageRetrier = new commonUtils.Retrier(this.conf.message.error.minVisibility, this.conf.message.error.maxVisibility);
    
    this._enabled = this.conf.consumer.enabled;
    this._scheduler = this.conf.consumer.scheduler;
    this._nextScheduledStartDate = moment(this._scheduler.start, 'hh:mm:ss');

    // Either handler can be overridden or injected
    // If passed in , we will inject it
    if(handler) {
      this.handle = handler;
    }
  }

  status() {
    return _.merge(super.status(), {
      enabled: this._enabled,
      running: this._running,
      lastPollDate: this._lastPollDate
    });
  }

  get running() {
    return this._running;
  }

  get enabled() {
    return this._enabled;
  }

  getScheduler() {
    return {
      isScheduled: this._scheduler.scheduled,
      nextStartDate: this._nextScheduledStartDate,
      duration: humanInterval(this._scheduler.duration)
    };
  }

  isConsuming() {
    if(!this._scheduler.scheduled) return true;
    return this._getVisibilityTimeout() === 0;
  }

  start(waitTillStopped) {
    if(!this._enabled) {
      return Promise.resolve();
    }
    if(this._running) {
      return Promise.resolve();
    }
    this._running = true;
    return this._init()
      .then(()=>{
        this.emit('running');
        let pollPromise = this._poll();
        if(waitTillStopped) {
          return pollPromise;
        }
      })
      .catch(err => {
        winston.error(`SqsConsumer::${this.name}:: An error occurred during initialization.`, err);
        this._running = false;
        this.emit('stopped');
        throw err;
      });
  }

  stop() {
    winston.info(`SqsConsumer::${this.name}:: Stopping consumer`);
    if(this._running) {
      this._running = false;
      return new Promise(resolve => {
        this.once('stopped', () => {
          this._queueUrl = null;
          return resolve();
        });
      });
    }
    return Promise.resolve();
  }

  /**
   * Handles message. This method should be extended and overridden for application specific message handling.
   * @param {Object} msgBody - Message body
   * @param {Object} message - Original SQS message
   * @return {Promise.<*>}
   */
  handle(msgBody, message) {
    return Promise.reject(new error.NonRetryableError('Not Implemented'));
  }

  /**
   * Handler for handling errors during message processing
   * @param {Error} err - Error to be handled
   * @param {Object} message - Original SQS message
   * @param {Object} msgBody - Parsed message bofy if available
   * @return {Promise.<TResult>|*}
   */
  handleError(err, message, msgBody) {
    this.emit('failed', message, msgBody, err);
    if(err && (err instanceof SyntaxError ||  err instanceof error.ValidationError ||
        err instanceof error.NonRetryableError)) {
      //No Retries on syntax error or ValidationError (Delete the message from queue for these errors)
      //In perfect world this should never happen, but even it does, we do not intend to retry these errors.
      winston.warn(`SqsConsumer::${this.name}:: Invalid message: ${message.MessageId}`,
        err);
      if(!this._queueUrl) {
        return Promise.resolve(true);
      }
      return this._sqs.deleteMessage({
        QueueUrl: this._queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }).promise()
        .then(() => {
          winston.info(`SqsConsumer::${this.name}:: Deleted message: ${message.MessageId}`);
          return true;
        });
    }
    //Only throw errors if we've retried more than the maxRetry count
    if (message.Attributes.ApproximateReceiveCount >= this.conf.message.error.maxRetries) {
      winston.error(`SqsConsumer::${this.name}:: An error occurred processing message: ${message.MessageId}`,
        err);
    }
    throw err;
  }

  _handle(message) {
    winston.info(`SqsConsumer::${this.name}:: Processing message: ${message.MessageId}`);

    let msgBody = null;

    return Promise.resolve(message.Body)
      .then(messageBody => {
        msgBody = JSON.parse(messageBody);
        return msgBody;
      })
      .then(messageBody => this._decryptMessage(messageBody, message))
      .then(messageBody => {
        msgBody = messageBody;
        return this.validateMessage(msgBody);
      })
      .then(() => this.handle(msgBody, message))
      .then(()=> this._sqs.deleteMessage({
        QueueUrl: this._queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }).promise())
      .then(data => {
        this.emit('processed', message, msgBody);
        if(data) {
          winston.info(`SqsConsumer::${this.name}:: Deleted message: ${message.MessageId}`);
        }
        return true;
      })
      .catch(err => {
        return this.handleError(err, message, msgBody);
      })
      .catch(() => {
        // Final Catch all (should not raise further exceptions)
        if(message && this._queueUrl) {
          return this._sqs.changeMessageVisibility({
            QueueUrl: this._queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: this._messageRetrier.nextTryInterval(message.Attributes.ApproximateReceiveCount || 1)
          }).promise()
            .then(() => false)
            .catch((err) => {
              winston.error(`SqsConsumer::${this.name}:: Failed to change message visibility`, err);
              return false;
            });
        }
        return false;
      });
  }

  _checkPoll() {
    if(!this._enabled) {
      winston.info(`SqsConsumer::${this.name}:: Consumer not enabled. Stopping poll.`);
      this.stop();
      return false;
    }
    if(!this._running) {
      winston.info(`SqsConsumer::${this.name}:: Stop polling for queue`, {queueUrl: this._queueUrl});
      return false;
    }
    if(!this._queueUrl) {
      winston.error(`SqsConsumer::${this.name}:: Queue not initialized. Stopping poll`);
      this.stop();
      return false;
    }
    return true;
  }

  _poll() {
    if(!this._checkPoll()) {
      this.emit('stopped');
      return Promise.resolve();
    }
    winston.debug(`SqsConsumer::${this.name}:: Polling queue using long poll`, {queueUrl: this._queueUrl});
    this._lastPollDate = new Date();
    return this._sqs.receiveMessage({
      MaxNumberOfMessages: this.conf.concurrency,
      WaitTimeSeconds: this.conf.poll.interval,
      QueueUrl: this._queueUrl,
      AttributeNames: ['ApproximateReceiveCount']
    }).promise()
    .then(data => this._scheduledConsuming(data))
    .then(data => {
      if(!data || !data.Messages || !data.Messages.length) {
        return Promise.resolve(true);
      }
      return Promise.all(data.Messages.map(message => this._handle(message)))
        .then(results=> results.reduce((previous, current) => previous !== false && current !== false));
    }).catch(err => {
      winston.error(`SqsConsumer::${this.name}:: Unknown error occurred during poll`, err);
      throw err;
    }).then(
      (success) => this._waitAndPoll(!success),
      (err) => this._waitAndPoll(true));
  }

  _waitAndPoll(shouldWait) {

    if(!shouldWait) {
      //Clear error count as we are not waiting.
      this._errorCnt = 0;
      return this._poll();
    }
    this._errorCnt++;
    let waitPeriod = this._jobRetrier.nextTryInterval(this._errorCnt);
    winston.info(`SqsConsumer::${this.name}::Waiting for ${waitPeriod} seconds prior to starting next poll`);
    return commonUtils.wait(waitPeriod * 1000)
      .finally(() => this._poll());
  }

  _scheduledConsuming(data) {
    if(!data || !data.Messages || !data.Messages.length || !this._scheduler || !this._scheduler.scheduled) {
       return Promise.resolve(data);
     }

    let timeout = this._getVisibilityTimeout();
    if(timeout) {
      let messageIds = _.map(data.Messages, _.property('MessageId'));
      winston.info(`SqsConsumer::${this.name}:: Delaying messages by ${timeout} seconds: ` +
                   `${JSON.stringify(messageIds)}`);
      return Promise.all(data.Messages.map(message => {
        this._sqs.changeMessageVisibility({
          QueueUrl: this._queueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: timeout
        }).promise();
      }))
      .then(() => ({}));
    }

    return Promise.resolve(data);
  }

  /**
   * Will decrypt the message body
   * @param  {object} messageBody The SQS message body
   * @return {object} The decrypted message body. If there was no encrypted data, returns messageBody.
   */
  _decryptMessage(messageBody, message) {
    // If the message has encrypted properties...
    if(messageBody.encrypted) {
      return this._decrypt(messageBody.encrypted) // decrypt it...
        .then(decryptedData => {
          delete messageBody.encrypted;
          return _.merge({}, messageBody, decryptedData); // and merge it into the message body
        })
        .catch(err => {
          if (err instanceof TypeError || err.name === 'InvalidCiphertextException') {
            throw new error.NonRetryableError(
              `Failed to decrypt the payload for message: ${message.MessageId}. Reason:${err}`, err);
          }
          throw err;
        });
    }
     // Return the original message body if there was nothing to decrypt
    return Promise.resolve(messageBody);
  }

  /**
   * Returns a SQS queue message visibility timeout based on the schedule's next start date-time
   * @return {Number} timeout A sqs queue message visibility timeout in seconds
   */
  _getVisibilityTimeout() {
    let now = moment().milliseconds(0),
        start = moment(this._scheduler.start, 'hh:mm:ss'),
        end = moment(start).add(humanInterval(this._scheduler.duration), 'ms'),
        timeoutDuration = readDuration(this._scheduler.maxVisibilityTimeout);

    this._nextScheduledStartDate = moment(start);

    // A timeout of zero means we don't want to wait to process the messages later. We're in the processing window.
    if(now.isBetween(start, end)) return 0;

    // Calculate the time until the next scheduled start
    if(now.isAfter(end)) this._nextScheduledStartDate.add(1, 'days');
    let nextStartDiff = this._nextScheduledStartDate.diff(now, 'seconds', true),
        timeout = Math.min(nextStartDiff, timeoutDuration.asSeconds());

    return timeout;
  }
}

module.exports = SqsConsumer;
