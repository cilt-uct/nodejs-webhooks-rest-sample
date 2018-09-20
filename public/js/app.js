let tokenEntity = {
  getToken: function() {
    return new Promise((resolve, reject) => {
      xhr('/obs-api/token')
        .then(res => {msToken = res; resolve(res)})
        .catch(err => reject('error', err));
    });
  },
  displayToken: function(tokenInfo) {
    let tokenInfoEl = document.querySelector('#token .entityInfo');
    tokenInfoEl.textContent = '';

    let fieldName  = document.createElement('span');
    let fieldValue  = document.createElement('span');

    ['account', 'authorisation_date', 'expiration_date'].forEach(fieldType => {
      let fieldEl = document.createElement('li');
      let fieldName = document.createElement('span');
      let fieldValue = document.createElement('span');

      fieldName.textContent = humanise(fieldType);
      fieldValue.textContent = humanise(fieldType, tokenInfo[fieldType]);
      fieldEl.appendChild(fieldName);
      fieldEl.appendChild(fieldValue);
      tokenInfoEl.appendChild(fieldEl);
    });
    tokenInfoEl.parentNode.classList.remove('loading');
  },
  fetchToken: function() {
    tokenEntity.getToken()
      .then(result => tokenEntity.displayToken(result))
      .catch(err => console.log('got an error', err));
  },
  getSubscription: function() {
    return new Promise((resolve, reject) => {
      xhr('/obs-api/subscription')
        .then(res => resolve(res))
        .catch(err => reject('error', err));
    });
  },
  displaySubscription: function(tokenInfo) {
    let tokenInfoEl = document.querySelector('#subscriptions .entityInfo');
    tokenInfoEl.textContent = '';

    let fieldName  = document.createElement('span');
    let fieldValue  = document.createElement('span');

    ['account', 'authorisation_date', 'expiration_date'].forEach(fieldType => {
      let fieldEl = document.createElement('li');
      let fieldName = document.createElement('span');
      let fieldValue = document.createElement('span');

      fieldName.textContent = humanise(fieldType);
      fieldValue.textContent = humanise(fieldType, tokenInfo[fieldType]);
      fieldEl.appendChild(fieldName);
      fieldEl.appendChild(fieldValue);
      tokenInfoEl.appendChild(fieldEl);
    });
    tokenInfoEl.parentNode.classList.remove('loading');
  },
  fetchSubscription: function() {
    tokenEntity.getSubscription()
      .then(result => tokenEntity.displaySubscription(result))
      .catch(err => console.log('got an error', err));
  },
  fetchNextEvent: function() {
    tokenEntity.getEvents({start: (new Date()).toISOString().split('T')[0]})
      .then(result => tokenEntity.displayNextEvent(result[0]))
      .catch(err => console.log('got an error when trying to retrieve events', err));
  },
  getEvents: function(params) {
    return new Promise((resolve, reject) => {
      let url = '/obs-api/event';
      if (typeof params == 'object' && Object.keys(params).length > -1) {
        url += '?' +
                  Object.keys(params)
                    .map(key => `${key}=${encodeURIComponent(params[key])}`)
                    .join('&');
      }
      xhr(url)
        .then(res => resolve(res))
        .catch(err => reject(err));
    });
  },
  displayNextEvent: function(eventDetails) {
    let eventEl = document.getElementById('nextEvent');
    eventEl.classList.remove('loading');

    if (!eventDetails) {
      return;
    }

    let eventInfoEl = eventEl.querySelector('.entityInfo');
    eventInfoEl.textContent = '';

    ['subject', 'organizer', 'start'].forEach(fieldType => {
      let fieldEl = document.createElement('li');
      let fieldName = document.createElement('span');
      let fieldValue = document.createElement('span');

      fieldName.textContent = humanise(fieldType);
      fieldValue.textContent = humanise(fieldType != 'start' ? fieldType : 'start_date', (eventDetails[fieldType].emailAddress || {name: null}).name || eventDetails[fieldType].dateTime || eventDetails[fieldType]);
      fieldEl.appendChild(fieldName);
      fieldEl.appendChild(fieldValue);
      eventInfoEl.appendChild(fieldEl);
    });
  }
}

function humanise(field, fieldValue) {
  if (!field) return '';
  if (!fieldValue) {
    return field
             .split('_')
             .map(word => word.charAt(0).toUpperCase() + word.substring(1))
             .join(' ')
  }

  if (field.indexOf('_date') > -1) {
    try {
      let d = new Date(fieldValue);
      let dTime = `${(d.getHours() < 10 ? '0' : '') + d.getHours()}:${(d.getMinutes() < 10 ? '0' : '') + d.getMinutes()}`;
      let now = new Date();
      let timeDiff = d.getTime() - now.getTime();
      if (Math.abs(timeDiff) > 60 * 60 * 24 * 1000) {
        return `${dayName(d.getDay())} ${d.getDate()} ${monthName(d.getMonth())}${(d.getFullYear() !== now.getFullYear() ? d.getFullYear() : '')} @ ${dTime}`;
      }
      else {
        if ((d.getTime() / 86400000 >> 0) * 86400000 > now.getTime()) {
          return `Tomorrow @ ${dTime}`;
        }
        else if ((d.getTime() / 86400000 >> 0) * 86400000 < now.getTime() && d.getTime() > now.getTime()) {
          return `Today @ ${dTime}`;
        }
        else return `Yesterday @ ${dTime}`;
      }
    } catch(e) {
      return 'None';
    }
  }
  else return fieldValue;
}

function monthName(num) {
  let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  return months[num];
}

function dayName(num) {
  let days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[num];
}


function xhr(url, opts) {
  return new Promise((resolve, reject) => {
    if (!url) {
      return reject('no url provided');
    }

    opts = opts || {};

    let req = new XMLHttpRequest();
    let reqType = (opts.type || 'GET').toUpperCase();
    req.open(reqType, url, true);

    for (let key in opts.headers) {
      req.setRequestHeader(key, opts.headers[key]);
    }
    for (let key in opts.attributes) {
      req[key] = opts.attributes[key];
    }

    req.onload = () => {
      let contentType = req.getResponseHeader('Content-Type');

      if (contentType.indexOf('application/json') > -1) {
        return resolve(req.responseJSON || JSON.parse(req.responseText));
      }
      else {
        return resolve(req.responseText);
      }
    };

    req.onerror = err => {
      return reject(err);
    };

    req.send(opts.data || null);
  });
}

var msToken = null;
tokenEntity.fetchToken();
tokenEntity.fetchSubscription();
tokenEntity.fetchNextEvent();
