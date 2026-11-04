// Test helper (not deployed): a stand-in for the gateway's owner key — signs owner_decide exactly like /live/decide.
import crypto from 'node:crypto';
import {ownerDecisionMessage} from './server.mjs';
const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
export const OWNER_X = publicKey.export({format: 'jwk'}).x;
export const withOwnerKey = cfg => { cfg.ownerPub = async () => OWNER_X; return cfg; };
export const signed = (consentId, decision, ts = Date.now(), key = privateKey) =>
  ({consentId, decision, ts, sig: crypto.sign(null, Buffer.from(ownerDecisionMessage({consentId, decision, ts})), key).toString('base64url')});
export const foreignKey = crypto.generateKeyPairSync('ed25519').privateKey;
