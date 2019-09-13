import express from 'express';
import https from 'https';
import querystring from 'querystring';

import { getSubscription, saveSubscription, deleteSubscription,
         getAccessToken, saveAccessToken, saveFromRefreshToken,
         getNotifiedTAccounts, saveTAccountPortValidationString,
         checkValidation, logAccountTransfer, logTAccountNotification } from '../helpers/dbHelper';
import { getAuthUrl, getTokenFromCode } from '../helpers/authHelper';
import { getData, postData, deleteData, patchData } from '../helpers/requestHelper';
import VulaWebService from '../helpers/vulaHelper';
import { ocConsumer } from '../helpers/ocHelper';
import { mailTemplate, sendMail } from '../helpers/utilities';
import { subscriptionConfiguration, adalConfiguration,
         tokenConfiguration } from '../constants';
import { prepareSites } from '../routes/listen.js';

export const authRouter = express.Router();

let isTokenExpired = false;
let lastTokenCheck = 0;

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
            .then(subscriptionData => {
              res.redirect(
                '/obs-api/home.html?subscriptionId=' + subscriptionData.id +
                '&userId=' + subscriptionData.userId
              );
            })
            .catch(err => {
              res.status(500);
              next(err);
            });
        })
        .catch(err => {
           console.log('saving token error', err);
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
      let data = {
                client_id: adalConfiguration.clientID,
                    scope: tokenConfiguration.scope,
            refresh_token: token.refresh_token,
             redirect_uri: adalConfiguration.redirectUri,
               grant_type: 'refresh_token',
            client_secret: adalConfiguration.clientSecret
          };
      httpsRequest(
        `${adalConfiguration.authority}/${tokenConfiguration.tokenUri}`,
        {
          method: 'post',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          data: data,
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
      .catch(err => {throw new Error(JSON.stringify(err))});
    })
    .catch(err => res.status(500).send(err));
});

authRouter.get('/event', (req, res) => {
  if (isTokenExpired && lastTokenCheck + 300000 > (new Date()).getTime()) {
    return res.json([]);
  }

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
      opts.startEnd = "dateTime%20lt%20'" + convertToUTC(req.query.end) + "'";
    }
  }
  else {
    opts.start = "dateTime%20le%20'" + getCurrentTime() + "'";
    opts.end = "dateTime%20gt%20'" + getCurrentTime() + "'";
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

            if (isTokenExpired) {
              isTokenExpired = false;
            }

          } else if (requestError) {
	    if (requestError.error) {
	      if (requestError.error.code === 'InvalidAuthenticationToken') {
                //Token has expired. notify LT team
	        isTokenExpired = true;
                lastTokenCheck = (new Date()).getTime();
              }
	    } 
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

authRouter.get('/series/taccs', async (req, res) => {
  try {
    let tAccountSeries = await ocConsumer.getTAccountSeries();
    res.json(tAccountSeries);
  } catch(e) {
    res.status(500).send('server error in getting t account series');
  }
});

authRouter.post('/series/:email', async (req, res) => {
  let email = req.params.email;
  let caName = req.body.hostname;
  try {
    let ocSeries = await prepareSites({emailAddress: {address: email}, host: caName});
    return res.json(ocSeries);
  } catch(e) {
    if (e.code && e.code === 409) {
      return res.json(e.series);
    }

    console.log('Could not create series for ', email, e);
    res.status(500).send();
  }
});

authRouter.post('/mail', async (req, res) => {
  let formattedEmail = await mailTemplate('obs', {fullname: 'Duncan Smith', UCTAccount: '01457245'});
  sendMail('duncan.smith@uct.ac.za', 'Welcome to the One Button Studio', formattedEmail, {contentType: 'HTML'});
  res.send();
});

authRouter.get('/mail/taccounts', async (req, res) => {
  res.status(202).send();
  try {
    let tAccountSeries = await ocConsumer.getTAccountSeries();
    let notifiedAccounts = (await getNotifiedTAccounts()).map(account => account.user_id);
    let notificationList = tAccountSeries
                             .filter(series => notifiedAccounts.indexOf(series.organizers[0]) === -1 &&
                                               (!series.organizers[1] || notifiedAccounts.indexOf(series.organizers[1]) === -1))
                             .map(series => appendAdditionalUserDetails(series));

    let sendPortAccountOption = async (index) => {
      //Port as in porting cell number between ISPs
      index = index || 0;
      if (notificationList.length <= index) {
        return;
      }

      try {
        let series = notificationList[index];
        let validationString = (Math.random() + 1).toString(36).substring(2, 12) + (Math.random() + 1).toString(36).substring(2, 12); //TODO: this generates a new validation string... set this to use the current one if it exists
        let saveValidationString = await saveTAccountPortValidationString(series.account, validationString);
        let formattedEmail = await mailTemplate('taccount', {fullname: series.contributors[0], validationString: validationString, account: series.account, email: series.email});
        await sendMail(series.email, formattedEmail.subject, formattedEmail.body, {contentType: 'HTML'});
        await logTAccountNotification(series.account, series.contributors[0], series.email);
      } catch(e) {
        switch (e.code) {
          case 'ER_DUP_ENTRY':
            //Validation string already saved
            break;

          default:
            console.log(e);
        }
      }
      sendPortAccountOption(++index);
    };
    sendPortAccountOption();
  } catch(e) {
    res.status(500).send(e);
  }
});

authRouter.get('/series/transfer', async (req, res) => {
  let account = req.query.account;
  let validationString = req.query.validation;
  let email = req.query.email;
  let ipAddress = req.headers['x-real-ip'] || req.connection.remoteAddress;
  let isTransfer = req.query.transfer === 'true';
  try {
    if (isTransfer) {
      let transferComplete = await transferAccount(validationString, account, email, ipAddress);
      res.send(transferComplete ? "done" : "failed");
    }
    else {
      res.send("skipping");
      let skipTransferComplete = await skipTransfer(validationString, account, email, ipAddress);
    }
  } catch (e) {
    res.status(500).send(e.message);
  }
});

authRouter.get('/series/duncan', async (req, res) => {
  try {
    let userDetails = await vula.getUserByEmail('01457245');             //get LDAP user details
  } catch(e) {
    res.status(500).send(e.message || e);
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

function transferAccount(validationCode, initAccount, email, ipAddress) {
  return new Promise(async(resolve, reject) => {
    try {
      let isAllowed = await checkValidation(validationCode, initAccount);
      if (isAllowed) {
        let vula = new VulaWebService();

        let userDetails = await vula.getUserByEmail(email);             //get LDAP user details
        let tAccountVulaDetails = await vula.getUserByEid(initAccount); //get Vula details for T-account. We compare supplied email against the T-account's email
                                                                        //These two emails match if the T-account and UCT staff number belong to the same person
        if (tAccountVulaDetails.vula.email !== email) {
          throw new Error("accounts do not match, aborting");
        }
        userDetails.fullname = userDetails.vula.fullname = userDetails.ldap[0].preferredname + ' ' + userDetails.ldap[0].sn;

        let userSeries = await ocConsumer.getPersonalSeries(email);
        if (!userSeries) {
          throw new Error("no OC series for " + email);
        }
        await ocConsumer.replaceUserInSeriesACL(userSeries.identifier, initAccount, userDetails.vula.username);
        await ocConsumer.updateUserDetailsForSeries(userSeries.identifier, userDetails.vula);
        let obsToolCreation = await vula.addOBSTool(userDetails.vula.username, userDetails.vula.siteId, userSeries.identifier);
        await vula.close();
        vula = null;
        logAccountTransfer(validationCode, initAccount, ipAddress, true);
        resolve(true);
      }
      else {
        console.log('failed to switch');
        resolve(false);
      }
    } catch(e) {
      reject(e);
    }
  });
}

function appendAdditionalUserDetails(series) {
  //The description field from the series metadata will have the user's UCT email address
  series.email = null;
  let emailRegexResult = /\((.*)@uct.ac.za\)/.exec(series.description);
  if (emailRegexResult) {
    series.email = emailRegexResult[0].replace("(", "").replace(")", "");
  }
  let accountRegex = /^[a-zA-Z0-9]+$/;
  if (accountRegex.exec(series.creator)) {
    series.account = (accountRegex.exec(series.creator))[0];
  }
  else {
    series.account = series.organizers
                       .filter(organizer => accountRegex.exec(organizer))
                       .map(organizer => (accountRegex.exec(organizer))[0])
                       .reduce((main, cur) => main = main || cur, null);
  }
  return series;
}

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
            .then(() => resolve(subscriptionData))
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
    return getCurrentTime();
  }
}
