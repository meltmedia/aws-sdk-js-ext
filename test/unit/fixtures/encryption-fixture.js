'use strict';

/*
  All constants relating to encrypting data. DATA was encrypted into ENCRYPTED_DATA with the key PLAINTEXT_KEY.
  If any of these constants need to change, the values need to be recomputed. CIPHERTEXT_KEY is not
  dependent on any of the other settings, and does not need to be recomputed.
*/
const CIPHERTEXT_KEY = '0101030078272078a6a49e40b3b49b112d08fd9bbdc92ba31545b984791c3732507b87f4d70000007' +
  'e307c06092a864886f70d010706a06f306d020100306806092a864886f70d010701301e060960864801650304012e3011040c' +
  '8bb0ce00520444cdf20c010d020110803b440788a79fc5d852848ac694e203c5f4a97a5502266a35fd5fb4afb88f8ffd45090' +
  '8ad52f425bb6d85091ac68187e3025232e81d7c4c9b7b4cd118';
const DATA = {someProperty: 'some property value', someOtherProperty: 'some other property value'};
const ENCRYPTED_DATA = 'U2FsdGVkX18/uu8Konmet8cCMahvUuPstqLyS3figm6O8yOOC79i0shuHyPEGWow+NieTbjPwLmIcZ' +
  'N230HDmC5v/HTPpKiX0sOnS0DHHf5leRP4lGsnJS7D+XgbPTawTsgTPHnnAvfVQgS//cYLhQ==';
const ENCRYPTED_PAYLOAD = {data: ENCRYPTED_DATA, key: CIPHERTEXT_KEY};
const PLAINTEXT_KEY = '065d40571aa541cce57ddaf484639a14b8ddfd61725d9bfa81fa0bc9b8c1ef5f';

module.exports = {
  CIPHERTEXT_KEY,
  DATA,
  ENCRYPTED_DATA,
  ENCRYPTED_PAYLOAD,
  PLAINTEXT_KEY
};
