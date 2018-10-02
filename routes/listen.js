import express from 'express';
import http from 'http';

import { ioServer } from '../helpers/socketHelper';
import { getData } from '../helpers/requestHelper';
import { getSubscription } from '../helpers/dbHelper';
import { subscriptionConfiguration } from '../constants';
import VulaWebService from '../helpers/vulaHelper';
import { ocConsumer } from '../helpers/ocHelper';
import { mailTemplate, sendMail } from '../helpers/utilities';

export const listenRouter = express.Router();

let notificationTimeouts = {};

listenRouter.get('/', (req, res) => {
  res.send("you're at notify endpoint");
});

/* Default listen route */
listenRouter.post('/', (req, res, next) => {
  let status;
  let clientStatesValid;

  // If there's a validationToken parameter in the query string,
  // then this is the request that Office 365 sends to check
  // that this is a valid endpoint.
  // Just send the validationToken back.
  if (req.query && req.query.validationToken) {
    res.send(req.query.validationToken);
    // Send a status of 'Ok'
    status = 200;
  } else {
    clientStatesValid = false;

    // First, validate all the clientState values in array
    for (let i = 0; i < req.body.value.length; i++) {
      const clientStateValueExpected = subscriptionConfiguration.clientState;

      if (req.body.value[i].clientState !== clientStateValueExpected) {
        // If just one clientState is invalid, we discard the whole batch
        clientStatesValid = false;
        break;
      } else {
        clientStatesValid = true;
      }
    }

    // If all the clientStates are valid, then process the notification
    if (clientStatesValid) {
      for (let i = 0; i < req.body.value.length; i++) {
        const details = req.body.value[i];
        //TODO: switch this to use details.resource, but with a fresh subscriptionId
        //Also, delete subscriptions. stale ones are returned (irritating!)
        if (!notificationTimeouts[details.subscriptionId]) {
          notificationTimeouts[details.subscriptionId] = setTimeout(() => {
            clearTimeout(notificationTimeouts[details.subscriptionId]);
            delete notificationTimeouts[details.subscriptionId];
          }, 10000);
          const resource = req.body.value[i].resource;
          const subscriptionId = req.body.value[i].subscriptionId;
          processNotification(subscriptionId, resource, res, next);
        }
      }
      // Send a status of 'Accepted'
      status = 202;
    } else {
      // Since the clientState field doesn't have the expected value,
      // this request might NOT come from Microsoft Graph.
      // However, you should still return the same status that you'd
      // return to Microsoft Graph to not alert possible impostors
      // that you have discovered them.
      status = 202;
    }
  }
  res.status(status).end(http.STATUS_CODES[status]);
});

// Get subscription data from the database
// Retrieve the actual mail message data from Office 365.
// Send the message data to the socket.
function processNotification(subscriptionId, resource, res, next) {
  getSubscription(subscriptionId)
    .then(subscriptionData => {
      if (subscriptionData) {
        getData(
          `/v1.0/${resource}`,
          subscriptionData.accessToken,
          (requestError, endpointData) => {
            if (endpointData) {
              prepareSites(endpointData.organizer);
            } else if (requestError) {
              //Some errors here are for declined events.
              //Example: { error: 
              //   { code: 'ErrorItemNotFound',
              //     message: 'The specified object was not found in the store.',
              //     innerError: 
              //      { 'request-id': 'f0f8033a-7814-4233-b249-b8073f56babc',
              //        date: '2018-09-20T13:29:42' } } }
              res.status(500);
              next(requestError);
            }
          }
        );
      } else if (dbError) {
        res.status(500);
        next(dbError);
      }
    });
//    .catch(err => console.log('got error', err));
}

/******************************************************* *
 * Create OC series and link it to user's Vula workspace *
 * ******************************************************/

export function prepareSites(info) {
  let email = info.emailAddress.address;
  return new Promise(async (resolve, reject) => {
    try {
      let ocSeries = await ocConsumer.getUserSeries(email);

      if (ocSeries.length) {
        console.log(`${email} has an ocSeries`);
        //User already has a series
        return reject({code: 409, series: ocSeries[0]});
      }

      let vula = new VulaWebService();
      try {
        let userDetails = await vula.getUserByEmail(email);
        let ocSetup = {
          fullname: userDetails.ldap[0].preferredname + ' ' + userDetails.ldap[0].sn,
          username: userDetails.vula.username,
            siteId: userDetails.vula.siteId,
             email: userDetails.vula.email
        };
        let ocSeries = await ocConsumer.createUserSeries(ocSetup);
        let obsToolCreation = await vula.addOBSTool(userDetails.vula.username, userDetails.vula.siteId, ocSeries.identifier);
        console.log('OBS tool creation for ' + email + ': ', obsToolCreation);
        await vula.close();
        vula = null;
        let formattedEmail = await mailTemplate('obs', {fullname: ocSetup.fullname, UCTAccount: ocSetup.username});
        sendMail(ocSetup.email, 'Welcome to the One Button Studio', formattedEmail, {contentType: 'HTML'});
        let seriesDetails = await ocConsumer.getSeriesById(ocSeries.identifier);
        resolve(seriesDetails);
      } catch(e) {
        console.log('Could not create series for ', email, e);
        reject(e);
      }
    } catch(asyncErr) {
      console.log('got error from preparing in async', asyncErr);
      reject(asyncErr);
    }
  });
}
