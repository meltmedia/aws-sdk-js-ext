"use strict";

require('promise.prototype.finally');

const
  promisify = require("es6-promisify"),
  config = require("config"),
  _ = require('lodash'),
  winston = require('winston'),
  commonUtils = require('../common/utils'),
  ValidationUtil = require('../common/validation'),
  error = require('../common/error'),
  events = require('events'),
  AWS = require('aws-sdk');

const DEFAULT_AWS_EXT_CONFIG = {
  sqs: {
    consumers: {
      defaults: {
        queue: {
          env: process.env.USER, // Use current user as environment
          prefix: 'sqs-default-',
          attributes: {}
        },
        sqsOptions: {
          region: 'us-west-2'
        },
        poll: {
          interval: 20,  // seconds
          error: {
            maxWait: 600,  //seconds
            minWait: 10  //seconds
          }
        },
        schema: {
          "$schema": "http://json-schema.org/draft-04/schema#",
          type: "object"
        },
        message: {
          error: {
            minVisibility: 60, // seconds
            maxVisibility : 600 //seconds
          }
        },
      }
    }
  }
};


class SqsConsumer extends events.EventEmitter {

  constructor(options, handler) {
    super();
    options = options || {};
    this.name = options.name || 'sqs-default';

    let awsext = _.merge(DEFAULT_AWS_EXT_CONFIG, config.awsext);
    let consumersConf = awsext.sqs.consumers;
    this.conf = _.merge(consumersConf.defaults, consumersConf[this.name], options.conf);
    this._sqs = options.sqs || new AWS.SQS(this.conf.sqsOptions);
    this._queueName = this.conf.queue.prefix + this.conf.queue.env;
    this._queueUrl = null; //Initialized using AWS Lookup

    // Promisify SQS Functions
    this._getQueueUrl = promisify(this._sqs.getQueueUrl).bind(this._sqs);
    this._createQueue = promisify(this._sqs.createQueue).bind(this._sqs);
    this._deleteMessage = promisify(this._sqs.deleteMessage).bind(this._sqs);
    this._receiveMessage = promisify(this._sqs.receiveMessage).bind(this._sqs);
    this._changeMessageVisibility = promisify(this._sqs.changeMessageVisibility).bind(this._sqs);


    this._errorCnt = 0;
    this._running = false;
    this._lastPollDate = null;
    this._jobRetrier = new commonUtils.Retrier(this.conf.poll.error.minWait, this.conf.poll.error.maxWait);
    this._messageRetrier = new commonUtils.Retrier(this.conf.message.error.minVisibility,
      this.conf.message.error.maxVisibility);
    this.validationUtil = options.validationUtil || new ValidationUtil();

    // Either handler can be overridden or injected
    // If passed in , we will inject it
    if(handler) {
      this.handler = handler;
    }
  }

  status() {
    return {
      running: this._running,
      queueName: this._queueName,
      queueUrl: this._queueUrl,
      lastPollDate: this._lastPollDate
    };
  }

  get running() {
    return this._running;
  }

  start() {
    this._running = true;
    return this._init()
      .then(()=>{
        this.emit('running');
        return this._poll();
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
  }

  //Default handler
  handler(msgBody) {
    return Promise.reject(new error.NonRetryableError('Not Implemented'));
  }

  _handle(message) {
    winston.info(`SqsConsumer::${this.name}:: Process message`, message);
    return Promise.resolve(JSON.parse(message.Body))
      .then(messageBody => {
        if(this.conf.schema && this.conf.schema.name) {
          return this.validationUtil.validate(messageBody, this.conf.schema).then(() => {
            return messageBody;
          });
        }
        return messageBody;
      })
      .then(messageBody => {
        return this.handler(messageBody);
      })
      .then(()=>this._deleteMessage({
        QueueUrl: this._queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }))
      .then(data => {
        if(data) {
          winston.info(`SqsConsumer::${this.name}:: Message deleted `, {messageId: message.MessageId});
        }
        return true;
      })
      .catch(err => {
        winston.error(`SqsConsumer::${this.name}:: An error ocurred processing message.: ${JSON.stringify(message)}`,
          err);
        if(err instanceof SyntaxError ||  err instanceof err.ValidationError || err instanceof err.NonRetryableError) {
          //No Retries on syntax error or ValidationError (Delete the message from queue for these errors)
          //In perfect world this should never happen, but even it does, we do not intend to retry these errors.
          return this._deleteMessage({
            QueueUrl: this._queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }).then(() => {
            winston.info(`SqsConsumer::${this.name}:: Message deleted `, {messageId: message.MessageId});
            return true;
          });
        }
        throw err;
      })
      .catch(() => {
        // Final Catch all (should not raise further exceptions)
        if(message) {
          return this._changeMessageVisibility({
            QueueUrl: this._queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: this._messageRetrier.nextTryInterval(message.Attributes.ApproximateReceiveCount || 1)
          })
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
    return this._receiveMessage({
      MaxNumberOfMessages: this.conf.concurrency,
      WaitTimeSeconds: this.conf.poll.interval,
      QueueUrl: this._queueUrl,
      AttributeNames: ['ApproximateReceiveCount']
    }).then(data => {
      if(!data.Messages || !data.Messages.length) {
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

  _init() {
    if(!this._queueUrl) {
      winston.info(`SqsConsumer::${this.name}::Using Queue:${this._queueName}`);
      return this._getQueueUrl({QueueName: this._queueName})
        .then(resp => {
          this._queueUrl = resp.QueueUrl;
          winston.info(`SqsConsumer::${this.name}::Using Queue:`, this._queueUrl);
        }).catch(err => {
          if(err.code && err.code == 'AWS.SimpleQueueService.NonExistentQueue') {
            return this._createQueue({
              QueueName: this._queueName,
              Attributes: this.conf.queue.attributes
            }).then(data => {
              winston.info(`SqsConsumer::${this.name}::Created Queue: ${data.QueueUrl}`);
              this._queueUrl = data.QueueUrl;
            });
          }
          throw err;
        }).catch(err => {
          winston.error(err);
          throw err;
        });
    }
    return Promise.resolve();
  }
}

module.exports = SqsConsumer;
