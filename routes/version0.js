import express from 'express';
import https from 'https';
import querystring from 'querystring';

import { getSubscription, getAccessToken} from '../helpers/dbHelper';
import { getAuthUrl, getTokenFromCode } from '../helpers/authHelper';
import { getData, postData, deleteData } from '../helpers/requestHelper';
import { subscriptionConfiguration, adalConfiguration,
         tokenConfiguration } from '../constants';

export const apiVersion = express.Router();

apiVersion.get('/token', (req, res) => {
  getAccessToken()
    .then(result => res.send(result))
    .catch(err => res.status(500).send(err));
});

apiVersion.get('/subscription', (req, res) => {
  getSubscription()
    .then(result => res.send(result))
    .catch(err => res.status(500).send(err));
});
