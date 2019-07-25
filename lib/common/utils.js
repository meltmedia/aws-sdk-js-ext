"use strict";

require('promise.prototype.finally');

const
  moment = require('moment'),
  humanInterval = require('human-interval');

/**
 * Retrier class for fetching next retry interval based on exponential backoff
 */
class Retrier {

  constructor(minWaitSeconds, maxWaitSeconds, maxRetries, exponentBase) {
    this.minWaitSeconds = minWaitSeconds || 60;
    this.maxWaitSeconds = maxWaitSeconds || 60*10;
    this.maxRetries = maxRetries || 10;
    this.exponentBase = exponentBase || 2;
  }

  nextTryInterval(tries) {
    return Math.min(
      this.maxWaitSeconds,
      this.minWaitSeconds * Math.pow(this.exponentBase, Math.min(tries, this.maxRetries)));
  }
}

/**
 * Gets next retry interval
 * @param tries Current number of tries
 * @param minWaitSeconds Minimum wait to determine retry interval
 * @param maxWaitSeconds Maximum wait to determine retry interval
 * @returns {*}
 */
function nextRetryInterval(tries, minWaitSeconds, maxWaitSeconds) {
  return new Retrier(minWaitSeconds, maxWaitSeconds).nextTryInterval(tries);
}

/**
 * Wait for given timeout and return Promise
 * @param timeout Timeout in ms
 * @returns {Promise} instance of Promise which resolves after timeout.
 */
function wait(timeout) {
  return new Promise((resolve)=>{
    setTimeout(resolve, timeout);
  });
}

/**
 * Returns a moment duration object from a human readable duration string
 * @param  {string} humanIntervalString A human readable string that describes the duration. Ex: '3 hours' or '5 minutes'
 * @return {duration} duration A Moment duration object
 */
function readDuration(humanIntervalString) {
  return moment.duration(humanInterval(humanIntervalString));
}

module.exports = {
  Retrier,
  wait,
  nextRetryInterval,
  readDuration
};
