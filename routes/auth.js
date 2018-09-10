import express from 'express';
import https from 'https';
import querystring from 'querystring';

import { getSubscription, saveSubscription, deleteSubscription,
         getAccessToken, saveAccessToken, saveFromRefreshToken } from '../helpers/dbHelper';
import { getAuthUrl, getTokenFromCode } from '../helpers/authHelper';
import { getData, postData, deleteData, patchData } from '../helpers/requestHelper';
import VulaWebService from '../helpers/vulaHelper';
import { ocConsumer } from '../helpers/ocHelper';
import { subscriptionConfiguration, adalConfiguration,
         tokenConfiguration } from '../constants';
import { prepareSites } from '../routes/listen.js';

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

authRouter.get('/token', (req, res) => {
  getAccessToken()
    .then(token => res.send(token))
    .catch(err => res.status(404).send("No active tokens available"));
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
  let opts = {
       start: "",
    startEnd: "",
         end: ""
  }

  if (req.query.start || req.query.end) {
    if (req.query.start) {
      opts.start = "dateTime%20ge%20'" + convertToUTC(req.query.start)  + "'";
    }
    if (req.query.end) {
      opts.startEnd = "dateTime%20le%20'" + convertToUTC(req.query.end) + "'";
    }
  }
  else {
    opts.start = "dateTime%20le%20'" + getCurrentTime() + "'";
    opts.end = "dateTime%20ge%20'" + getCurrentTime() + "'";
  }
  let url = `/v1.0/me/events?$filter=start/${opts.start}${opts.end ? `%20and%20end/${opts.end}` : ''}${opts.startEnd ? `%20and%20start/${opts.startEnd}` : ''}&$orderby=start/dateTime%20asc`;

  getAccessToken()
    .then(result => {
      getData(
        url,
        result.token,
        (requestError, endpointData) => {
          if (endpointData) {
            let filteredFields = ['id','hasAttachments','subject','isAllDay','type','webLink','body','start','end','organizer','attachments'];
            let formattedData = endpointData.value
                                  .filter(event => {
                                    return event.organizer.emailAddress.address !== 'One_Button_Studio@uct.ac.za';
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

authRouter.get('/event/series', (req, res) => {
  getAccessToken()
    .then(result => {
      getData(
        `/v1.0/me/events?$top=50`,
        result.token,
        (requestError, endpointData) => {
          if (endpointData) {
            let filteredFields = ['id','hasAttachments','subject','isAllDay','type','webLink','body','start','end','organizer','attachments'];
            let formattedData = endpointData.value
//                                  .filter(event => {
//                                    return ((new Date(event.start.dateTime)).getTime() - (new Date()).getTime() > -7200000 ||
//                                            new Date(event.end.dateTime).getTime() > (new Date()).getTime()) &&
//                                            new Date(event.end.dateTime).getTime() < ((new Date()).getTime() + 24*60*60*1000);
//                                  })
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
                let queueSeriesCreation = events.filter(event => !event.ocSeries.length);
                
                res.json(
                  events.filter(event => !event.ocSeries.length)
                );
              });
          }
          else if (requestError) {
            res.status(500).send(requestError);
          }
      })
    })
    .catch(err => res.status(500).send(err));
});

authRouter.put('/event/series', (req, res) => {
  getAccessToken()
    .then(result => {
      getData(
        `/v1.0/me/events?$top=50`,
        result.token,
        (requestError, endpointData) => {
          if (endpointData) {
            res.status(202).send();
            let filteredFields = ['id','hasAttachments','subject','isAllDay','type','webLink','body','start','end','organizer','attachments'];
            let formattedData = endpointData.value
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
                //Get all events which are not part of an OC series
                let seriesCreationQueue = events.filter(event => !event.ocSeries.length);

                if (!seriesCreationQueue.length) {
                  return res.send();
                }

                //Get the associated email addresses (uniquely) of those events above...
                let seriesOwners = seriesCreationQueue.map(event => event.organizer.emailAddress.address);
                seriesOwners = seriesOwners
                                 .filter((ownerEmail, index) => index === seriesOwners.indexOf(ownerEmail));

                seriesOwners.forEach(async(email) => {
                  try {
                    let vula = new VulaWebService();

                    let userDetails = await vula.getUserByEmail(email);
                    let ocSetup = {
                      fullname: userDetails.ldap[0].preferredname + ' ' + userDetails.ldap[0].sn,
                      username: userDetails.vula.username,
                        siteId: userDetails.vula.siteId,
                         email: email
                    };
                    ocSetup.ocSeries = await ocConsumer.getUserSeries(email);
                    console.log(ocSetup);
                    if (!ocSetup.ocSeries.length) {
                      let ocSeries = await ocConsumer.createUserSeries(ocSetup);
                      let obsToolCreation = await vula.addOBSTool(userDetails.vula.username, userDetails.vula.siteId, ocSeries.identifier);
                      console.log('OBS tool creation for ' + email + ': ', obsToolCreation);
                    }
                    await vula.close();
                    vula = null;
                  } catch(creationError) {
                    console.log('creation error', creationError);
                  }
                });
              });
          }
          else if (requestError) {
            res.status(500).send(requestError);
          }
          else {
            res.send('');
          }
      })
    })
    .catch(err => res.status(500).send(err));
});

authRouter.get('/event/owner/:email', (req, res) => {
  let email = req.params.email;
  (async () => {
    try {
      let vula = new VulaWebService();
      let userDetails = await vula.getUserByEmail(email);
      let ocSetup = {
        fullname: userDetails.ldap[0].preferredname + ' ' + userDetails.ldap[0].sn,
        username: userDetails.vula.username,
          siteId: userDetails.vula.siteId,
           email: userDetails.vula.email
      };
      ocSetup.ocSeries = await ocConsumer.getUserSeries(email);
      await vula.close();
      vula = null;
      res.json(ocSetup);
    } catch(e) {
      console.log('Could not create series for ', email, e);
      res.status(500).send(e);
    }
  })();
});

authRouter.post('/series/:email', async (req, res) => {
  let email = req.params.email;
  try {
    let ocSeries = await prepareSites({emailAddress: {address: email}});
    return res.json(ocSeries);
  } catch(e) {
    if (e.code && e.code === 409) {
      return res.json(e.series);
    }

    console.log('Could not create series for ', email, e);
    res.status(500).send();
  }
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

function getCurrentDate() {
  let d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}T00:00`;
}

function getCurrentTime() {
  let d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() < 9 ? '0' : '') + (d.getUTCMonth() + 1)}-${(d.getUTCDate() < 10 ? '0' : '') + d.getUTCDate()}T${(d.getUTCHours() < 10 ? '0': '') + d.getUTCHours()}:${(d.getUTCMinutes() < 10 ? '0' : '') + d.getUTCMinutes()}`;
}

function convertToUTC(dateStr) {
  try {
    let d = new Date(dateStr);
    return `${d.getUTCFullYear()}-${(d.getUTCMonth() < 9 ? '0' : '') + (d.getUTCMonth() + 1)}-${(d.getUTCDate() < 10 ? '0' : '') + d.getUTCDate()}T${(d.getUTCHours() < 10 ? '0': '') + d.getUTCHours()}:${(d.getUTCMinutes() < 10 ? '0' : '') + d.getUTCMinutes()}`;
  } catch(e) {
    console.log('falling back on date', e);
    return getCurrentTime();
  }
}
