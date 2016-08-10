"use strict";

require('promise.prototype.finally');

/**
 * Retrier class for fetching next retry interval based on exponential backoff
 */
class Retrier {

  constructor(minWaitSeconds, maxWaitSeconds) {
    this.minWaitSeconds = minWaitSeconds || 60;
    this.maxWaitSeconds = maxWaitSeconds || 60*10;
  }

  nextTryInterval(tries) {
    return Math.min(
      this.maxWaitSeconds,
      this.minWaitSeconds +  (2 << Math.min(tries-1, 29)));
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

module.exports = {
  Retrier,
  wait,
  nextRetryInterval
};
