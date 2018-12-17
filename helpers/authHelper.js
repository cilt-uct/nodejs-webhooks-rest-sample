import { AuthenticationContext } from 'adal-node';

import { adalConfiguration, tokenConfiguration } from '../constants';

const resource = 'https://graph.microsoft.com/';

/**
 * Generate a fully formed uri to use for authentication based on the supplied resource argument
 * @return {string} a fully formed uri with which authentication can be completed.
 */
export function getAuthUrl() {
  return adalConfiguration.authority + '/oauth2/v2.0/authorize' +
    '?client_id=' + adalConfiguration.clientID +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(adalConfiguration.redirectUri) +
    '&scope=' + encodeURIComponent(tokenConfiguration.scope) +
    '&response_mode=query'
}

/**
 * Gets a token for a given resource.
 * @param {string} code An authorization code returned from a client.
 * @param {AcquireTokenCallback} callback The callback function.
 */
export function getTokenFromCode(code, callback) {
  const authContext = new AuthenticationContext(adalConfiguration.authority);
  authContext.acquireTokenWithAuthorizationCode(
    code,
    adalConfiguration.redirectUri,
    resource,
    adalConfiguration.clientID,
    adalConfiguration.clientSecret,
    (error, token) => {
      if (error) {
        callback(error, null);
      }
      else {
        callback(null, token);
      }
    }
  );
}
