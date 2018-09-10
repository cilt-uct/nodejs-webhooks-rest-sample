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
  createUserSeries: function(opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      let valid = true;
      ['fullname', 'username', 'email', 'siteId'].some(field => {
        if (!opts[field]) {
          valid = false;
          return reject('required field missing: ' + field);
        }
      });

      if (!valid) {
        return;
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
            value: [opts.fullname]
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
        {action: 'read', allow: true, role: `ROLE_USER_${opts.username}`},
        {action: 'write', allow: true, role: `ROLE_USER_${opts.username}`},
        {action: 'read', allow: true, role: 'ROLE_CILT_OBS'},
        {action: 'write', allow: true, role: 'ROLE_CILT_OBS'},
        {action: 'read', allow: true, role: 'ROLE_USER_PERSONALSERIESCREATOR'},
      ];
      return acl;
}
