'use strict';

/*
  All constants relating to encrypting data. DATA was encrypted into ENCRYPTED_DATA with the key PLAINTEXT_KEY.
  If any of these constants need to change, the values need to be recomputed. CIPHERTEXT_KEY is not
  dependent on any of the other settings, and does not need to be recomputed.
*/
const CIPHERTEXT_KEY = 'ciphertext';
const DATA = {key: 'test key', value: 'test value'};
const ENCRYPTED_DATA = 'U2FsdGVkX1+yJ81Mbd23pFIkhXq7tFfHFCB9iAQLAmryztJwqkAHw2+0PdU3VB0v1IUNGfK93tFvJ4ZPcbMnrg==';
const ENCRYPTED_PAYLOAD = {data: ENCRYPTED_DATA, key: CIPHERTEXT_KEY};
const PLAINTEXT_KEY = '00000000001111111111222222222233';

module.exports = {
  CIPHERTEXT_KEY,
  DATA,
  ENCRYPTED_DATA,
  ENCRYPTED_PAYLOAD,
  PLAINTEXT_KEY
};
