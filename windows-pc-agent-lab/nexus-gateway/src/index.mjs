import OAuthProvider from '@cloudflare/workers-oauth-provider';
import {handleDefault, handleMcp} from './handlers.mjs';
export {ConsentGuard} from './guard.mjs';

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: {fetch: (request, env, ctx) => handleMcp(request, env, ctx)},
  defaultHandler: {fetch: (request, env) => handleDefault(request, env)},
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  allowPlainPKCE: false,
  accessTokenTTL: 3600,
});
