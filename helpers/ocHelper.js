import { ocConfiguration } from '../constants';
import request from 'request';

let hostname = ocConfiguration.hostname;
let digestUser = ocConfiguration.username;
let digestPass = ocConfiguration.password;
let base64Digest = Buffer.from(`${digestUser}:${digestPass}`).toString('base64');

//Make request know this is digest authentication
//so that it adds the necessary headers
let credentials = {
  auth: {
    user: digestUser,
    pass: digestPass,
    sendImmediately: false
  }
};

//Send required headers to Opencast for authorization
let ocDigestHeader = {
  headers: {
    'X-Requested-With': 'Digest',
    Authorization: `Digest ${base64Digest}`
  }
};

exports.ocConsumer = {
  getUserSeries: function(search) {
    return new Promise((resolve, reject) => {
      let uri = `https://${hostname}/api/series/?filter=textFilter:${search}`;
      let options = Object.assign({uri: uri}, ocDigestHeader, credentials);
      request(options, (err, req, body) => {
        if (err) {
          return reject(err);
        }

        try {
          let result = JSON.parse(body);
          resolve(result);
        } catch(e) {
          reject('server returned with unexpected content type');
        }
      });
    });
  },
  getPersonalSeries: function(search) {
    return new Promise(async(resolve, reject) => {
      try {
        let userSeries = await this.getUserSeries(search);
        resolve(
          userSeries
            .filter(series => series.description.indexOf('Personal') === 0 &&
                              series.description.indexOf(search) > -1)
            .sort((a, b) => a.organizers[0] < b.organizers[0] ? 1 : -1)
            .reduce((series, cur) => series = series || cur, null)
        );
      } catch(e) {
        reject(e);
      }
    });
  },
  createUserSeries: function(opts) {
    opts = opts || {};
    console.log('i am going to make this thing');
    return new Promise((resolve, reject) => {
      let valid = true;
      ['fullname', 'username', 'email', 'siteId'].some(field => {
        if (!opts[field]) {
          valid = false;
          return reject('required field missing: ' + field);
        }
      });

      if (!valid) {
        console.log('invalid here');
        return reject('not a valid thing');
      }

      let payload = getPayload(opts);
      let acl = getACL(opts);

      let requestHeaders = {headers: Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, ocDigestHeader.headers)};
      let options = Object.assign({
           uri: `https://${hostname}/api/series/`,
        method: 'POST',
          form: {
                  metadata: JSON.stringify(payload),
                       acl: JSON.stringify(acl)
                }
      }, requestHeaders, credentials);

      request(options, (err, req, body) => {
        if (err) {
          return reject('got some error', err);
        }

        try {
          resolve(JSON.parse(body));
        } catch(e) {
          resolve(body);
        }
      });
    });
  },
  replaceUserInSeriesACL: function(seriesId, oldUser, newUser) {
    //WARNING: this replaces ACL totally. Check the edge case where the event was shared with another person not related to the series
    return new Promise(async(resolve, reject)=> {
      try {
        let currentAcl = await this.getSeriesAcl(seriesId);
        let newAcl = currentAcl
                       .map(acl => {
                         acl.role = acl.role.replace(oldUser.toUpperCase(), newUser.toUpperCase()); //replace user..
                         return JSON.stringify(acl);                    //...and stringify so that we can make entries unique (MH-13075)
                       })
                       .filter((aclString, index, origArray) => origArray.indexOf(aclString) === index)  //now they are unique...
                       .map(aclString => JSON.parse(aclString))                                          //...and make the entries objects again

        let requestHeaders = {headers: Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, ocDigestHeader.headers)};
        let options = Object.assign({
             uri: `https://${hostname}/api/series/${seriesId}/acl`,
          method: 'POST',
            form: {
                    acl: JSON.stringify(newAcl)
                  }
        }, requestHeaders, credentials);

        request(options, (err, req, body) => {
          if (err) {
            return reject('got some error', err);
          }

          try {
            resolve(JSON.parse(body));
          } catch(e) {
            resolve(body);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  },
  updateUserDetailsForSeries: function(seriesId, user) {
    return new Promise((resolve, reject) => {
      let payload = getPayload(user);
      let requestHeaders = {headers: Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, ocDigestHeader.headers)};
      let options = Object.assign({
           uri: `https://${hostname}/admin-ng/series/${seriesId}/metadata`,
        method: 'PUT',
          form: {
                  metadata: JSON.stringify(payload),
                }
      }, requestHeaders, credentials);

      request(options, (err, req, body) => {
        if (err) {
          return reject(err);
        }

        console.log('Completed series update:', user.username, seriesId);
        try {
          let result = JSON.parse(body);
          resolve(true);
        } catch(e) {
          console.log(e, body);
          reject('server returned with unexpected content type');
        }
      });
    });
  },
  getSeriesById: function(id) {
    return new Promise((resolve, reject) => {
      let uri = `https://${hostname}/api/series/${id}`;
      let options = Object.assign({uri: uri}, ocDigestHeader, credentials);
      request(options, (err, req, body) => {
        if (err) {
          return reject(err);
        }

        try {
          let result = JSON.parse(body);
          resolve(result);
        } catch(e) {
          console.log(e, body);
          reject('server returned with unexpected content type');
        }
      });
    });
  },
  getTAccountSeries: function() {
    return new Promise(async(resolve) => {
      try {
        let tRegex = /^t\d+$/gi;
        let series = await this.getUserSeries('personal');
        let tAccountSeries = series
                               .filter(serie => serie.description && serie.description.indexOf('Personal series') === 0)
                               .filter(serie => {
                                 return serie.creator.charAt(0).toLowerCase() === 't' ||
                                        (serie.organizers[0] && tRegex.test(serie.organizers[0])); //TODO: use regex here, otherwise people with names starting with T will be listed as T account
                               });
        resolve(tAccountSeries);
      } catch(e) {
        console.log('could not get personal series', e);
        resolve([]);
      }
    });
  },
  getSeriesAcl: function(seriesId) {
    return new Promise((resolve, reject) => {
      let requestHeaders = {headers: Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, ocDigestHeader.headers)};
      let options = Object.assign({
           uri: `https://${hostname}/api/series/${seriesId}/acl`,
        method: 'GET'
      }, requestHeaders, credentials);

      request(options, (err, req, body) => {
        if (err) {
          return reject('got some error', err);
        }

        try {
          resolve(JSON.parse(body));
        } catch(e) {
          resolve(body);
        }
      });
    });
  }
}

function getPayload(opts) {
      let basePayload = {
        flavor: 'dublincore/series',
         title: 'Opencast Series DublinCore',
        fields: [
          {
               id: 'title',
            value: `Personal Series (${opts.fullname})`
          },
          {
               id: 'subject',
            value: `Personal`
          },
          {
               id: 'description',
            value: `Personal series:${opts.fullname} (${opts.email})
Sakai site: ${opts.siteId}`
          },
          {
               id: 'language',
            value: 'eng'
          },
          {
               id: 'rightsHolder',
            value: 'The University of Cape Town'
          },
          {
               id: 'license',
            value: 'ALLRIGHTS'
          },
          {
               id: 'creator',
            value: [opts.fullname]
          },
          {
               id: 'contributor',
            value: [opts.username, opts.fullname]
          },
          {
               id: 'publisher',
            value: [opts.fullname]
          }
        ]
      };

      let extendedPayload = {
        flavor: 'ext/series',
         title: 'UCT Series Extended Metadata',
        fields: [
          {
               id: 'course',
            value: ''
          },
          {
               id: 'creator-id',
            value: opts.username
          },
          {
               id: 'site-id',
            value: opts.siteId
          }
        ]
      };

      return [basePayload, extendedPayload];
}

function getACL(opts) {
  let acl = [
    {action: 'read', allow: true, role: `ROLE_USER_${opts.username.toUpperCase()}`},
    {action: 'write', allow: true, role: `ROLE_USER_${opts.username.toUpperCase()}`},
    {action: 'read', allow: true, role: 'ROLE_CILT_OBS'},
    {action: 'write', allow: true, role: 'ROLE_CILT_OBS'},
  ];
  return acl;
}
