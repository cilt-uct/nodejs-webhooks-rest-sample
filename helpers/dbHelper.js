import fs from 'fs';
import sql from 'mysql';
import { dbConfiguration } from '../constants';

const pool = sql.createPool({
  connectionLimit: 50,
             host: dbConfiguration.hostname,
             user: dbConfiguration.username,
         password: dbConfiguration.password,
         database: dbConfiguration.database
});

/**
 * Create SQLite3 table Subscription.
 */
export function createDatabase() {
  const dbExists = fs.existsSync(dbFile);
  const db = new sqlite3.Database(dbFile);
  const createSubscriptionStatement =
    'CREATE TABLE Subscription (' +
    'UserId TEXT NOT NULL, ' +
    'SubscriptionId TEXT NOT NULL, ' +
    'AccessToken TEXT NOT NULL, ' +
    'Resource TEXT NOT NULL, ' +
    'ChangeType TEXT NOT NULL, ' +
    'ClientState TEXT NOT NULL, ' +
    'NotificationUrl TEXT NOT NULL, ' +
    'SubscriptionExpirationDateTime TEXT NOT NULL' +
    ')';

  db.serialize(() => {
    if (!dbExists) {
      db.run(
        createSubscriptionStatement,
        [],
        error => {
          if (error !== null) throw error;
        }
      );
    }
  });
  db.close();
}
/*
export function getSubscription(subscriptionId, callback) {
  const db = new sqlite3.Database(dbFile);
  const getUserDataStatement =
    'SELECT ' +
    'UserId as userId, ' +
    'SubscriptionId as subscriptionId, ' +
    'AccessToken as accessToken, ' +
    'Resource as resource, ' +
    'ChangeType as changeType, ' +
    'ClientState as clientState, ' +
    'NotificationUrl as notificationUrl, ' +
    'SubscriptionExpirationDateTime as subscriptionExpirationDateTime ' +
    'FROM Subscription ' +
    'WHERE SubscriptionId = $subscriptionId ' +
    'AND SubscriptionExpirationDateTime > datetime(\'now\')';

  db.serialize(() => {
    db.get(
      getUserDataStatement,
      {
        $subscriptionId: subscriptionId
      },
      callback
    );
  });
}*/
export function getSubscription(subscriptionId) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      let query = 'select A.*, B.token as accessToken from subscriptions A join tokens B on A.account = B.account where A.expiration_date > now()' + (!!subscriptionId ? ' and A.id = ?' : '') + ' order by A.expiration_date desc, B.expiration_date desc';
      let values = [];
      if (subscriptionId) values.push(subscriptionId);
      connection.query(query, values, (e, result) => {
        if (e) {
          return reject(e);
        }

        if (result.length === 0) {
          return reject('no active subscriptions');
        }
        resolve(result[0]);
      });

      connection.release();
    });
  });
}

export function saveSubscription(subscriptionData) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      let timestamp = (new Date((new Date(subscriptionData.expirationDateTime)).getTime() - (new Date()).getTimezoneOffset() * 60 * 1000)).toISOString().replace('T', ' ').replace('Z', '');
      let values = [
        subscriptionData.applicationId,
        subscriptionData.creatorId,
        subscriptionData.id,
        subscriptionData.resource,
        subscriptionData.changeType,
        subscriptionData.clientState,
        subscriptionData.notificationUrl,
        subscriptionData.userId || null,
        subscriptionData.accessToken || null,
        timestamp,
        timestamp,
        subscriptionData.id,
        subscriptionData.accessToken
      ];

      connection.query(
        "insert into subscriptions (application_id, creator_id, id, resource, change_type, client_state, notification_url, account, " +
        "access_token, expiration_date) values (?,?,?,?,?,?,?,?,?,?) on duplicate key update expiration_date = ?, id = ?, access_token = ?",
        values, qErr => {
          if (qErr) {
            return reject(qErr);
          }

          resolve();
        });

      connection.release();
    });
  });
}
/*
export function saveSubscription(subscriptionData, callback) {
  const db = new sqlite3.Database(dbFile);
  const insertStatement =
    'INSERT INTO Subscription ' +
    '(UserId, SubscriptionId, AccessToken, Resource, ChangeType, ' +
    'ClientState, NotificationUrl, SubscriptionExpirationDateTime) ' +
    'VALUES ($userId, $subscriptionId, $accessToken, $resource, $changeType, ' +
    '$clientState, $notificationUrl, $subscriptionExpirationDateTime)';

  db.serialize(() => {
    db.run(
      insertStatement,
      {
        $userId: subscriptionData.userId,
        $subscriptionId: subscriptionData.id,
        $accessToken: subscriptionData.accessToken,
        $resource: subscriptionData.resource,
        $clientState: subscriptionData.clientState,
        $changeType: subscriptionData.changeType,
        $notificationUrl: subscriptionData.notificationUrl,
        $subscriptionExpirationDateTime: subscriptionData.expirationDateTime
      },
      callback
    );
  });
}
*/


export function deleteSubscription(subscriptionId, callback) {
  const db = new sqlite3.Database(dbFile);
  const deleteStatement =
    'DELETE FROM Subscription WHERE ' +
    'SubscriptionId = $subscriptionId';

  db.serialize(() => {
    db.run(
      deleteStatement,
      { $subscriptionId: subscriptionId },
      callback
    );
  });
}

export function getAccessToken() {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      connection.query('select * from tokens', (e, result) => {
        if (e) {
          return reject(e);
        }

        resolve(result[0]);
      });

      connection.release();
    });
  });
}

export function saveAccessToken(tokenData) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      let values = [
        tokenData.accessToken,
        tokenData.expiresOn,
        tokenData.userId,
        null,
        JSON.stringify(tokenData),
        tokenData.refreshToken,
        tokenData.accessToken,
        tokenData.expiresOn,
        tokenData.userId,
        null,
        JSON.stringify(tokenData),
        tokenData.refreshToken
      ];
      connection.query("insert into tokens (token, expiration_date, authorisation_date, account, address, last_payload, refresh_token) " +
                       "values (?, ?, now(), ?, ?, ?, ?) on duplicate key update token = ?, expiration_date = ?, authorisation_date = now(), " +
                       "account = ?, address =?, last_payload = ?, refresh_token = ?", values, (qErr) => {
        if (qErr) {
          return reject(qErr);
        }

        resolve();
      });

      connection.release();
    });
  });
}

export function saveFromRefreshToken(tokenData) {
  return new Promise((resolve, reject) => {
    console.log('got this refresh token', tokenData);
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      if (!tokenData || !tokenData.access_token || tokenData.access_token.split('.').length < 1) {
        return reject("token not properly formatted");
      }

      let base64payload = (tokenData.access_token.split('.'))[1];
      let payload = JSON.parse(new Buffer(base64payload, 'base64').toString('binary'));
      let values = [
        tokenData.access_token,
        tokenData.refresh_token,
        new Date((payload.exp - (new Date()).getTimezoneOffset() * 60) * 1000).toISOString().replace('T', ' ').replace('Z', ''),
        payload.upn
      ];

      connection.query("update tokens set token = ?, refresh_token = ?, expiration_date = ? where account = ?", values, (qErr) => {
        if (qErr) {
          console.log(qErr);
          console.log('some sql error');
          return reject(qErr);
        }

        resolve();
      });

      connection.release();
    });
  });
}

export function saveMeetingDetails(details) {
}

export function getNotifiedTAccounts() {
  return new Promise(async (resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      connection.query("select user_id from user_notifications where notification_desc = ? and (" +
        " notification_date >= date_sub(curdate(), interval 1 week) or " + //user was notified this week
        " notification_count > 2)", //user is deemed notified if they've receive 3 notifications already
        ['t_account_uct_account_transfer'],
        (e, results) => {
          if (e) {
            return reject(e);
          }

          resolve(results);
        }
      );
    });
  });
}

export function saveTAccountPortValidationString(user, validationString) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      connection.query("insert into port_t_account_authorisation (t_account, validation_string) values (?,?)",
        [user, validationString],
        (e, results) => {
          if (e) {
            return reject(e);
          }

          resolve(true);
        }
      );
    });
  });
}

export function checkValidation(code, account) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      connection.query("select t_account from port_t_account_authorisation where t_account = ? and validation_string = ? and user_accepted is null and user_denied is null", [account, code],
        //TODO: think about this query... whether user_[accepted|denied] is necessary
        (e, results) => {
          if (e) {
            return reject(e);
          }

          resolve(results.length > 0);
        }
      );
    });
  });
}

export function logAccountTransfer(code, account, ipAddress, isTransferred) {
  //TODO: clear out rows of users who have transferred accounts
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      let query = "update port_t_account_authorisation set user_affirmation_ip = ?, %chosen% = ? where t_account = ? and validation_string = ?"
                  .replace("%chosen%", isTransferred ? 'user_accepted' : 'user_denied');
      connection.query(query, [ipAddress, 1, account, code],
        (e, results) => {
          if (e) {
            console.log('could not update for ' + account + ' ' + code + ':', e);
          }

          resolve();
        }
      );
    });
  });
}

export function logTAccountNotification(userId, userName, userEmail) {
  //TODO: clear out rows of users who have transferred accounts
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      let query = "insert into user_notifications (user_id, user_fullname, user_email, notification_desc) values (?, ?, ?, 't_account_uct_account_transfer') " +
                  "on duplicate key update notification_count = notification_count + 1";
      connection.query(query, [userId, userName, userEmail],
        (e, results) => {
          if (e) {
            console.log('could not update last notification date for ' + userId + ':', e);
          }

          resolve();
        }
      );
    });
  });
}

export function saveNotifiedTAccount(account) {
}
