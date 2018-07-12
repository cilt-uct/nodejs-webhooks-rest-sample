import soap from 'soap';
import { vulaConfiguration } from '../constants';
import { ocConfiguration } from '../constants';
import { httpsRequest } from './utilities';
import { parseString } from 'xml2js';

function VulaWebService() {

  this.hostname = vulaConfiguration.hostname;
  this.credentials = {
    id: vulaConfiguration.username,
    pw: vulaConfiguration.password
  };

  this.loginUrl = `https://${this.hostname}/sakai-ws/soap/login?wsdl`;
  this.sakaiSoapEndpoint = `https://${this.hostname}/sakai-ws/soap/sakai?wsdl`;
  this.uctSoapEndpoint = `https://${this.hostname}/sakai-ws/soap/uct?wsdl`;

  this.authClient = null;
  this.sakaiClient = null;
  this.uctClient = null;

  this.token = '';

  let _listeners = {};
  Object.defineProperty(this, 'listeners', {
    get: function() {
      return _listeners;
    }
  });

  let _ready = false;
  Object.defineProperty(this, 'ready', {
    get: function() {
      return _ready;
    },
    set: function(val) {
      if (typeof val === 'boolean') {
        _ready = val;
        if (val) {
          this.emit('ready');
        }
      }
    }
  });

  this.login()
    .then(() => this.prepareClients())
    .catch(err => { throw new Error(err) });
}

VulaWebService.prototype = {
  login: function() {
    return new Promise((resolve, reject) => {
      soap.createClient(this.loginUrl, (err, client) => {
        if (err) {
          return reject(err);
        }

        this.authClient = client;
        this.authClient.login(this.credentials, (e, res) => {
          if (e) {
            return reject(e);
          }

          this.token = res.return;
          resolve(this.token);
        });
      });
    });
  },
  prepareClients: function() {
    soap.createClient(this.sakaiSoapEndpoint, (err, client) => {
      if (err) {
        throw new Error(err);
      }

      this.sakaiClient = client;
      this.checkState();
    });

    soap.createClient(this.uctSoapEndpoint, (err, client) => {
      if (err) {
        throw new Error(err);
      }

      this.uctClient = client;
      this.checkState();
    });
  },
  checkState: function() {
    if (this.sakaiClient && this.uctClient) {
      this.ready = true;
    }
  },
  checkSession: function() {
    return new Promise((resolve, reject) => {
      soap.createClient(this.sakaiSoapEndpoint, (err, client) => {
        if (err) {
          return reject(err);
        }

        let params = {
          sessionid: this.token,
                eid: this.credentials.id,
             wsonly: true
        };

        client.getSessionForUser(params, (e, res) => {
          if (e) {
            return reject(e);
          }
        });
      });
    });
  },
  checkAuthClient: function() {
    return new Promise((resolve, reject) => {
      if (!this.token) {
        return reject();
      }
      if (this.authClient) {
        return resolve();
      }

      soap.createClient(this.loginUrl, (err, client) => {
        if (err) {
          return reject();
        }

        this.authClient = client;
        resolve();
      });
    });
  },
  checkUserByEid: function(eid) {
    return new Promise((resolve, reject) => {
      if (!this.sakaiClient) {
        return reject('no client available');
      }

      let params = {
        sessionid: this.token,
              eid: eid
      };

      this.sakaiClient.checkForUser(params, (err, res) => {
        if (err) {
          return reject(err);
        }

        resolve(res);
      });
    });
  },
  getUserByEmail: function(email) {
    return new Promise((resolve, reject) => {
      httpsRequest(`https://srvslscet001.uct.ac.za/optout/search/${email}`)
        .then(result => {
          try {
            result = JSON.parse(result);
            (async () => {
              result.vula.siteId = await this.getUserHome(result.vula.username);
              resolve(result);
            })();
          } catch(e) {
            resolve(result);
          }
        })
        .catch(err => {console.log('this error', err); reject(err)});
    });
  },
  getUserHome: function(user) {
    return new Promise((resolve, reject) => {
      if (!this.sakaiClient) {
        return reject('no client available');
      }

      let params = {
        sessionid: this.token,
           userid: user
      };

      this.sakaiClient.getAllSitesForUser(params, (err, res) => {
        if (err) {
          return reject(err);
        }

        parseString(res.return, (e, json) => {
          if (e) {
            return reject(e);
          }

          let homeSite = json.list.item
                           .filter(item => item.siteTitle.length && item.siteTitle[0] === 'Home' && item.siteId[0].indexOf('~') > -1)
                           .reduce((home, current) => {
                             home = home || current.siteId[0];
                             return home;
                           }, '');

          if (!homeSite) return reject('no home site for user');
          resolve(homeSite);
        });
      });
    });
  },
  addOBSTool: function(eid, siteId, ocSeries, ltiLaunchUrl) {
    return new Promise((resolve, reject) => {
      (async () => {
        if (!eid && !seriesId) return reject('no user or site provided');
        if (!ocSeries) return reject('no Opencast series provided');

        if (!siteId) {
          siteId = await this.getUserHome(eid);
        }

        ltiLaunchUrl = ltiLaunchUrl || `https://${ocConfiguration.hostname}/lti`;

        let params = {
                sessionid: this.token,
                   siteid: siteId,
                tooltitle: 'My Videos',
             ltilaunchurl: ltiLaunchUrl,
          lticustomparams: `sid=${ocSeries}
type=personal
tool=https://${ocConfiguration.hostname}/ltitools/manage/`
        };

        this.uctClient.addExternalToolToSite(params, (err, result) => {
          if (err) {
            return reject(err);
          }
          resolve(result.return);
        });
      })();
    });
  },
  close: function() {
    this.checkAuthClient()
      .then(() => {
        this.authClient.logout(this.token);
      });
  },
  on: function(ev, fnObj) {
    if (ev === 'ready' && this.ready) {
      fnObj = typeof fnObj === 'function' ? {scope: null, fn: fnObj} : fnObj;
      let fn = fnObj.fn;
      let scope = fnObj.scope;
      (function() {
        fn.apply(scope);
      })();
    }

    if (!this.listeners[ev]) {
      this.listeners[ev] = {};
    }

    fnObj = typeof fnObj === 'function' ? {fn: fnObj, scope: null} : fnObj;

    let token = '';
    do {
      token = (Math.random() + 1).toString(36).substring(2, 8);
    } while (this.listeners[ev].hasOwnProperty(token));

    this.listeners[ev][token] = fnObj;
  },
  emit: function(ev, vals) {
    if (!this.listeners[ev]) {
      return;
    }

    let args = (Array.prototype.slice.call(arguments)).slice(1);
    for (let key in this.listeners[ev]) {
      let fn = this.listeners[ev][key].fn;
      let scope = this.listeners[ev][key].scope;

      (function() {
        fn.apply(scope, args);
      })();
    }
  }
}

module.exports = VulaWebService;
