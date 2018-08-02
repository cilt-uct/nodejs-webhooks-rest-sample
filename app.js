import express from 'express';
import path from 'path';
import logger from 'morgan';
import bodyParser from 'body-parser';

import { authRouter } from './routes/auth';
import { listenRouter } from './routes/listen';
import VulaWebService from './helpers/vulaHelper';
import { ocConsumer } from './helpers/ocHelper';

export const app = express();

const env = process.env.NODE_ENV || 'development';
app.locals.ENV = env;
app.locals.ENV_DEVELOPMENT = (env === 'development');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/obs-api/', express.static(path.join(__dirname, 'public')));
app.use('/obs-api/', authRouter);
app.use('/obs-api/notify', listenRouter);

// catch 404 and forward to error handler
app.use((req, res, next) => {
  let err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use((err, req, res) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err,
      title: 'error'
    });
  });
} else {
  // production error handler
  // no stacktraces leaked to user
  app.use((err, req, res) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: { },
      title: 'error'
    });
  });
}
