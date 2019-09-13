require('babel-register')({
        presets: [ 'env' ]
    })

require("babel-core/register");
require("babel-polyfill");

// Import the rest of our application.
 module.exports = require('./app.js')
