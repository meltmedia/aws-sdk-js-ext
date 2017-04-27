'use strict';

const ALGORITHM = 'aes-256-ecb';
const CIPHERTEXT_KEY = 'ciphertext';
const DATA = {key: 'test key', value: 'test value'};
const ENCRYPTED_DATA = 'o9w7+YNBLNpmlzIBIL06Gf0bpy7xgn7s3EpCJvh3pPHGaNehTNv111UU9a0Bmvhl';
const ENCRYPTED_PAYLOAD = {data: ENCRYPTED_DATA, key: CIPHERTEXT_KEY};
const PLAINTEXT_KEY = '00000000001111111111222222222233';

module.exports = {
  ALGORITHM,
  CIPHERTEXT_KEY,
  DATA,
  ENCRYPTED_DATA,
  ENCRYPTED_PAYLOAD,
  PLAINTEXT_KEY
};
