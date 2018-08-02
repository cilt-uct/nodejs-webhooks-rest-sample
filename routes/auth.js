import express from 'express';
import https from 'https';
import querystring from 'querystring';

import { getSubscription, saveSubscription, deleteSubscription,
         getAccessToken, saveAccessToken, saveFromRefreshToken } from '../helpers/dbHelper';
import { getAuthUrl, getTokenFromCode } from '../helpers/authHelper';
import { getData, postData, deleteData, patchData } from '../helpers/requestHelper';
import { ocConsumer } from '../helpers/ocHelper';
import { subscriptionConfiguration, adalConfiguration,
         tokenConfiguration } from '../constants';

export const authRouter = express.Router();

// Redirect to start page
authRouter.get('/', (req, res) => {
  res.redirect('/obs-api/index.html');
});

// Start authentication flow
authRouter.get('/signin', (req, res) => {
  res.redirect(getAuthUrl());
});

// This route gets called at the end of the authentication flow.
// It requests the subscription from Office 365, stores the subscription in a database,
// and redirects the browser to the home page.
authRouter.get('/authorise', (req, res, next) => {
  getTokenFromCode(req.query.code, (authenticationError, token) => {
    if (token) {
      // Request this subscription to expire one day from now.
      // Note: 1 day = 86400000 milliseconds
      saveAccessToken(token)
        .then(() => {
          makeWebhookSubscription(token)
            .then(() => {
              res.redirect(
                '/obs-api/home.html?subscriptionId=' + subscriptionData.id +
                '&userId=' + subscriptionData.userId
              );
            })
            .catch(err => {
              reject(error);
              res.status(500);
              next(err);
            });
        })
        .catch(err => {
           console.log('saving token error', err);
           reject(error);
           res.status(500);
           next(err);
        });
        // Make the request to subscription service.
    } else if (authenticationError) {
      res.status(500);
      next(authenticationError);
    }
  });
});

authRouter.patch('/subscription', (req, res, next) => {
  getSubscription()
    .then(subscription => {

      let patchBody = {
        expirationDateTime: (new Date((new Date()).getTime() + 4229 * 60 * 1000)).toISOString()
      };

      patchData(
        `/v1.0/subscriptions/${subscription.id}`,
        subscription.accessToken,
        JSON.stringify(patchBody),
        (requestError, result) => {
          if (requestError) {
            return res.status(500).send(requestError);
          }

          res.status(204).send();
          result.accessToken = subscription.access_token;
          saveSubscription(result);
        }
      );
    })
    .catch(err => {
      res.status(404).send("No active subscriptions available for regeneration");
    });
});

authRouter.get('/subscription', (req, res, next) => {
  getSubscription()
    .then(subscription => {
      res.send(subscription);
    })
    .catch(err => res.status(404).send("No active subscriptions available for regeneration"));
});

authRouter.post('/subscription', (req, res, next) => {
  getAccessToken()
    .then(result => {
      makeWebhookSubscription(result)
        .then(response => res.send('Subscription success'))
        .catch(err => res.status(500).send(err));
    })
    .catch(err => res.status(404).send(err));
});

authRouter.get('/refresh', (req, res, next) => {
  getAccessToken()
    .then(token => {
      httpsRequest(
        `${adalConfiguration.authority}/${tokenConfiguration.tokenUri}`,
        {
          method: 'post',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          data: {
                client_id: adalConfiguration.clientID,
                    scope: tokenConfiguration.scope,
            refresh_token: token.refresh_token,
             redirect_uri: adalConfiguration.redirectUri,
               grant_Type: 'refresh_token',
            client_secret: adalConfiguration.clientSecret
          },
          returnResponse: true
        }
      )
      .then(response => {
        try {
          let reply = JSON.parse(response.body);
          saveFromRefreshToken(reply);
          
        } catch(e) {
          console.log('could not parse json body: ', e);
        }
        res.send();
      })
      .catch(err => {console.log(err);throw new Error(JSON.stringify(err))});
    })
    .catch(err => res.status(500).send(err));
});

authRouter.get('/event', (req, res) => {
  getAccessToken()
    .then(result => {
      getData(
        `/v1.0/me/events`,
        result.token,
        (requestError, endpointData) => {
          if (endpointData) {
            let filteredFields = ['id','hasAttachments','subject','isAllDay','type','webLink','body','start','end','organizer','attachments'];
            let formattedData = endpointData.value
                                  .filter(event => {
                                    return ((new Date(event.start.dateTime)).getTime() - (new Date()).getTime() > -7200000 ||
                                            new Date(event.end.dateTime).getTime() > (new Date()).getTime()) &&
                                            new Date(event.end.dateTime).getTime() < ((new Date()).getTime() + 24*60*60*1000);
                                  })
                                  .sort((a, b) => (new Date(a.start.dateTime)).getTime() - (new Date(b.start.dateTime)).getTime())
                                  .map(event => {
                                    let returnedEvent = filteredFields.reduce((result, field) => {
                                      result[field] = event[field] || null;
                                      return result;
                                    }, {});
                                    return returnedEvent;
                                  });

            const promises = formattedData.map(async (event) => {
              event.ocSeries = await ocConsumer.getUserSeries(event.organizer.emailAddress.address);
              return event;
            });

            Promise.all(promises)
              .then(events => {
                res.json(
                  events.map
                    (event => {
                      if (event.ocSeries.length) {
                        event.ocSeriesTitle = event.ocSeries[0].title;
                        event.ocSeries = event.ocSeries[0].identifier;
                      }
                      else {
                        event.ocSeriesTitle = null;
                        event.ocSeries = null;
                      }
                      return event;
                    })
                );
              })
              .catch(() => res.send([]));

          } else if (requestError) {
            res.status(500).send(requestError);
          }
        }
      );
    })
    .catch(err => res.status(500).send(err));
});


// This route signs out the users by performing these tasks
// Delete the subscription data from the database
// Redirect the browser to the logout endpoint.
authRouter.get('/signout/:subscriptionId', (req, res) => {
  const redirectUri = `${req.protocol}://${req.hostname}:${req.app.settings.port}`;

  // Delete the subscription from Microsoft Graph
  getSubscription(req.params.subscriptionId, (dbError, subscriptionData, next) => {
    if (subscriptionData) {
      deleteData(
        `/beta/subscriptions/${req.params.subscriptionId}`,
        subscriptionData.accessToken,
        error => {
          if (!error) deleteSubscription(req.params.subscriptionId, null);
        }
      );
    } else if (dbError) {
      res.status(500);
      next(dbError);
    }
  });

  res.redirect('https://login.microsoftonline.com/common/oauth2/logout?post_logout_redirect_uri=' + redirectUri);
});

function makeWebhookSubscription(token) {
  return new Promise((resolve, reject) => {
    subscriptionConfiguration.expirationDateTime = new Date(Date.now() + 4229 * 60 * 1000).toISOString();

    postData(
      '/v1.0/subscriptions',
      token.accessToken || token.token,
      JSON.stringify(subscriptionConfiguration),
      (requestError, subscriptionData) => {
        if (subscriptionData) {
          subscriptionData.accessToken = token.accessToken || token.token;
          subscriptionData.userId = token.userId || token.account;

          saveSubscription(subscriptionData, null)
            .then(() => resolve())
            .catch(err => reject("could not save subscription: " + err));
        } else if (requestError) {
          reject(requestError);
        }
      }
    );
  });
}

function httpsRequest(url, opts) {
  return new Promise((resolve, reject) => {
    opts = opts || {};
    let method = (opts.method || 'get').toUpperCase();
    let options = {method: method};
    let data = '';
    let urlArr = url.split('/');
    options.host = urlArr[2];
    options.port = '443';
    options.path = '/' + urlArr.slice(3).join('/');
    if (opts.headers) {
      options.headers = opts.headers;
    }
    options.headers = options.headers || {};
    if (opts.data) {
      data = querystring.stringify(opts.data);
      options.headers = options.headers || {};
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, res => {
      let body = '';

      res.on('data', chunk => {body += chunk});

      res.on('end', () => {
        if (opts && opts.returnResponse) {
          return resolve({body: body, response: res});
        }
        resolve(body);
      });
    })

    req.on('error', err => {
      if (opts && opts.returnResponse) {
        return reject({body: err, response: req});
      }
      reject(err);
    });

    req.write(data);
    req.end();
  });
}
