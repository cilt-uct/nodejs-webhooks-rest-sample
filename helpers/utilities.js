import https from 'https';

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
