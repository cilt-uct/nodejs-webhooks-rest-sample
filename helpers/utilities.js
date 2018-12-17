let fs = require('fs');
import https from 'https';
import { getAccessToken } from './dbHelper';
import { postData } from './requestHelper';

export function httpsRequest(url, opts) {
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

export function mailTemplate(templateName, opts) {
  switch (templateName) {
    //obs is the only initial template we need to send right now, so go straight to default
    //Future:
    //case 'obs':
    //  return obstemplate or something (initEmail right now)
    //case 'clinskills1':
    //  return clinskillstemplate or something
    case 'clinskills1':
    case 'clinskills2':
    case 'clinskills3':
    case 'clinskills4':
      return null;
    case 'taccount':
      return portingTAccountEmail(opts);
    default:
      return initEmail(opts);
  }
}

function initEmail(opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    fs.readFile('./views/initial_email_template', 'utf8', (err, template) => {
      if (err) {
        return reject(err);
      }

      if (opts.fullname) {
        template = template.replace(/UCT Colleague/g, opts.fullname);
      }
      if (opts.UCTAccount) {
        template = template.replace(/vula_account/g, `~${opts.UCTAccount}`);
      }
      resolve({body: template, subject: 'Welcome to the One Button Studio'});
    });
  });
}

function portingTAccountEmail(opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    fs.readFile('./views/taccount_email_template', 'utf8', (err, template) => {
      if (err) {
        return reject(err);
      }

      if (opts.fullname) {
        template = template.replace(/UCT Colleague/g, opts.fullname);
      }
      if (opts.validationString) {
        template = template.replace(/%validationString%/g, opts.validationString);
      }
      if (opts.account) {
        template = template.replace(/%account%/g, opts.account);
      }
      if (opts.email) {
        template = template.replace(/%email%/g, opts.email);
      }

      resolve({body: template, subject: 'Transfer your video series to your UCT account'});
    });
  });
}

export function sendMail(toArr, subject, body, opts) {
  opts = opts || {};
  let reqBody = {
        message: {
          toRecipients: [],
          ccRecipients: [],
               subject: subject || 'Default subject',
                  body: {
                    contentType: opts.contentType || 'Text',
                        content: typeof body == 'string' ? body : 'A body'
               },
        },
        saveToSentItems: "true"
  };

  toArr = toArr ? (Array.isArray(toArr) ? toArr : [toArr]) : [];
  toArr
    .filter(email => email.match(/.+\@.+\..+/))
    .forEach(email => {
      reqBody.message.toRecipients.push(
        {
          emailAddress: {
            address: email
          }
        }
      );
    });

  if (!reqBody.message.toRecipients.length) {
    reqBody.message.toRecipients = [{emailAddress: {address: 'duncan.smith@uct.ac.za' }}];
  }

  return new Promise(async (resolve, reject) => {
    try {
      let tokenDetails = await getAccessToken();
      postData(
        '/v1.0/me/sendMail',
        tokenDetails.token,
        JSON.stringify(reqBody),
        (requestError, mailData) => {
          if (requestError) {
            console.log('got an error sending mail', requestError);
            return reject(requestError);
          }

          console.log('successfully sent mail', JSON.stringify(reqBody.message.toRecipients), mailData);
          resolve(true);
        }
      );
    } catch(e) {
      console.log(e);
      reject(e);
    }
  });
}
