"use strict";

require('promise.prototype.finally').shim();

const
  promisify = require("es6-promisify"),
  config = require("config"),
  _ = require('lodash'),
  winston = require('winston'),
  commonUtils = require('../common/utils'),
  error = require('../common/error'),
  SqsBase = require('./sqs-base'),
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
    this._messageRetrier = new commonUtils.Retrier(this.conf.message.error.minVisibility,
      this.conf.message.error.maxVisibility);

    this._scheduler = this.conf.consumer.scheduler;
    this._nextScheduledStartDate = moment(this._scheduler.start, 'hh:mm:ss');

    // Either handler can be overridden or injected
    // If passed in , we will inject it
    if(handler) {
      this.handle = handler;
    }
  }

  status() {
    return _.merge(super.status(),{
      running: this._running,
      lastPollDate: this._lastPollDate
    });
  }

  get running() {
    return this._running;
  }

  getScheduler() {
    return {
      isScheduled: this._scheduler.scheduled,
      nextStartDate: this._nextScheduledStartDate,
      duration: moment(this._scheduler.duration, 'seconds')
    };
  }

  start(waitTillStopped) {
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
    this._running = false;
    this._queueUrl = null;
  }

  //Default handler
  handle(msgBody) {
    return Promise.reject(new error.NonRetryableError('Not Implemented'));
  }

  _handle(message) {
    winston.info(`SqsConsumer::${this.name}:: Process message`, message);
    return Promise.resolve(JSON.parse(message.Body))
      .then(messageBody => this.validateMessage(messageBody))
      .then(messageBody => this.handle(messageBody))
      .then( ()=> this._sqs.deleteMessage({
        QueueUrl: this._queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }).promise())
      .then(data => {
        this.emit('processed', message);
        if(data) {
          winston.info(`SqsConsumer::${this.name}:: Message deleted `, {messageId: message.MessageId});
        }
        return true;
      })
      .catch(err => {
        this.emit('failed', message);
        winston.error(`SqsConsumer::${this.name}:: An error occurred processing message.: ${JSON.stringify(message)}`,
          err);
        if(err && (err instanceof SyntaxError ||  err instanceof error.ValidationError ||
          err instanceof error.NonRetryableError)) {
          //No Retries on syntax error or ValidationError (Delete the message from queue for these errors)
          //In perfect world this should never happen, but even it does, we do not intend to retry these errors.
          return this._sqs.deleteMessage({
            QueueUrl: this._queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }).promise()
            .then(() => {
            winston.info(`SqsConsumer::${this.name}:: Message deleted `, {messageId: message.MessageId});
            return true;
          });
        }
        throw err;
      })
      .catch(() => {
        // Final Catch all (should not raise further exceptions)
        if(message) {
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
    if(!this._scheduler || !this._scheduler.scheduled) return Promise.resolve(data);

    let now = moment(),
        start = moment(this._scheduler.start, 'hh:mm:ss'),
        end = moment(start).add(this._scheduler.duration, 'seconds'),
        timeout = this._scheduler.maxVisibilityTimeout;

    this._nextScheduledStartDate = moment(start);

    // If we're in the processing window, just pass the data along
    if(now.isBetween(start, end)) return Promise.resolve(data);

    // Calculate the time until the next scheduled start
    if(now.isAfter(end)) this._nextScheduledStartDate.add(1, 'days');
    timeout = Math.min(timeout, this._nextScheduledStartDate.diff(now, 'seconds'));

    // If we make it this far, change the visibility of all the messages
    return Promise.all(data.Messages.map(message => {
      this._sqs.changeMessageVisibility({
        QueueUrl: this._queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: timeout
      }).promise();
    }))
    .then(() => ({}));
  }
}

module.exports = SqsConsumer;
