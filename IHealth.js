var request = require( 'request' );
var moment  = require( 'moment' );
var async = require( 'async' );
var path = require( 'path' );

/*
  var Ihealth = require( './lib/Ihealth' );

  function persistToken( token, cb ) {
      fs.writeFile( 'token.json', JSON.stringify( token ), cb );
  }

  var ihealth = new Ihealth( config, persistToken );

  // fetch a token from persistent storage.  if it exists in storage:
  ihealth.setToken( token );

  // In an express app:

  app.get( '/auth', function( req, res ) {
      if ( ihealth.getToken() )
          res.redirect( '/profile' );
      else
          res.redirect( ihealth.authorizeURL() );
  });

  app.get( '/auth_callback', function( req, res, next ) {
      var code = req.query.code;
      ihealth.fetchToken( code, function( err, token ) {
          if ( err ) return next( err );
	  res.redirect( '/profile' );
      });
  });

  // ihealth.request() can be done outside of a web app context, so
  // long as a token is available and ihealth.setToken( token ) was
  // called.  ihealth.request() will automatically refresh the token
  // when required.
  //
  app.get( '/profile', function( req, res, next ) {
    ihealth.request({
        uri: "https://api.ihealth.com/1/user/-/profile.json",
	method: 'GET',
    }, function( err, body ) {
        if ( err ) return next( err );
	var profile = JSON.parse( body );
	res.jsonp( profile );
    });
  });

  DATA STRUCTURES:

  token = {
      "access_token": ACCESS_TOKEN,
      "expires_in": SECONDS,
      "expires_at": "20150829T10:20:25",
      "refresh_token": REFRESH_TOKEN
  }

  config = {
	"creds": {
	    "clientID": ID,
	    "clientSecret": SECRET,
	},
	"uris": {
	    "authorizationUri": "https://www.ihealth.com",
	    "authorizationPath": "/oauth2/authorize",
	    "tokenUri": "https://api.ihealth.com",
	    "tokenPath": "/oauth2/token"
	},
	"authorization_uri": {
	    "redirect_uri": "http://localhost:3000/auth_callback/",
	    "response_type": "code",
	    "scope": "activity nutrition profile settings sleep social weight heartrate",
	    "state": "3(#0/!~"
	}
  }
*/

var fcnToSV = {
    'bp.json': 'OpenApiBP',
    'weight.json': 'OpenApiWeight',
    'glucose.json': 'OpenApiBG',
    'spo2.json': 'OpenApiSpO2',
    'activity.json': 'OpenApiActivity',
    'sleep.json': 'OpenApiSleep',
    'userinfo.json': 'OpenApiUserInfo',

    'bp.xml': 'OpenApiBP',
    'weight.xml': 'OpenApiWeight',
    'glucose.xml': 'OpenApiBG',
    'spo2.xml': 'OpenApiSpO2',
    'activity.xml': 'OpenApiActivity',
    'sleep.xml': 'OpenApiSleep',
    'userinfo.xml': 'OpenApiUserInfo',
};

var IHealth = function( config, persist ) {
    this.config = config;
    this.token  = null;
    this.persist = persist;
    if ( ! this.config.timeout ) this.config.timeout = 60 * 1000; // default 1 minute
}

IHealth.prototype.authorizeURL = function() {
    return require('simple-oauth2')({
	clientID: this.config.creds.clientID,
	clientSecret: this.config.creds.clientSecret,
	site: this.config.uris.authorizationUri,
	authorizationPath: this.config.uris.authorizationPath,
    }).authCode.authorizeURL( this.config.authorization_uri );
}

IHealth.prototype.fetchToken = function( code, cb ) {
    var self = this;
    request({
        uri: self.config.uris.tokenUri + self.config.uris.tokenPath,
        method: 'GET',
	timeout: self.config.timeout,
        qs: {
            code: code,
            redirect_uri: self.config.authorization_uri.redirect_uri,
            grant_type: 'authorization_code',
            client_id: self.config.creds.clientID,
            client_secret: self.config.creds.clientSecret,
        }
    }, function( err, res, body ) {
	if ( err ) return cb( err );
	try {
	    var ih_token = JSON.parse( body );

	    if ( ih_token.Error )
		return cb( new Error( ih_token.ErrorCode + " " + ih_token.ErrorDescription ) );

	    var token = {
		access_token: ih_token.AccessToken,
		refresh_token: ih_token.RefreshToken,
		expires_in: ih_token.Expires,
		UserID: ih_token.UserID,
	    };

	    token.expires_at = moment().add( token.expires_in, 'seconds' ).format( 'YYYYMMDDTHH:mm:ss' );
	    self.token = token;
	    if ( ! self.persist ) return cb( null, token );
	    self.persist( self.token, function( err ) {
		if ( err ) return cb( err );
		cb( null, token );
	    });
	} catch( err ) {
	    cb( err );
	}
    });
}

IHealth.prototype.setToken = function( token ) {
    this.token = token;
}

IHealth.prototype.getToken = function( token ) {
    return this.token;
}

IHealth.prototype.refresh = function( cb ) {
    var self = this;
    request({
        uri: self.config.uris.tokenUri +  self.config.uris.tokenPath,
        method: 'GET',
	timeout: self.config.timeout,
        qs: {
            client_id: self.config.creds.clientID,
            client_secret: self.config.creds.clientSecret,
            redirect_uri: self.config.authorization_uri.redirect_uri,
            response_type: 'refresh_token',
            refresh_token: self.token.refresh_token,
	    UserID: self.token.UserID,
        }
    }, function( err, res, body ) {
        if ( err ) return cb( new Error( 'token refresh: ' + err.message ) );
	try {
            var ih_token = JSON.parse( body );

	    var token = {
		access_token: ih_token.AccessToken,
		refresh_token: ih_token.RefreshToken,
		expires_in: ih_token.Expires,
		UserID: ih_token.UserID,
	    };
	    
            token.expires_at = moment().add( token.expires_in, 'seconds' ).format( 'YYYYMMDDTHH:mm:ss' );
	    self.token = token;
	    if ( ! self.persist ) return cb( null, token );
	    self.persist( self.token, function( err ) {
		if ( err ) return cb( err );
		cb( null, token );
	    });
	} catch( err ) {
	    cb( err );
	}
    });
}

// The callback gets three params: err, body, token.  If token is not null, that
// means a token refresh was performed, and the token is the new token.  If tokens
// are persisted by the caller, the caller should persist this new token.  If the
// token is null, then a refresh was not performed and the existing token is still valid.
//
IHealth.prototype.request = function( options, cb ) {
    var self = this;

    if ( ! self.token )
	return cb( new Error( 'must setToken() or getToken() before calling request()' ) );

    if ( ! self.token.access_token )
	return cb( new Error( 'token appears corrupt: ' + JSON.stringify( self.token) ) );

    async.series([
	function( cb ) {
	    if ( moment().unix() >= moment( self.token.expires_at, 'YYYYMMDDTHH:mm:ss' ).unix() )
		self.refresh( cb );
	    else
		cb();
	},
	function( cb ) {
	    if ( ! options.timeout ) options.timeout = self.config.timeout;

	    if ( options.uri )
		options.uri = options.uri.replace( '_USERID_', self.token.UserID );
	    if ( options.url )
		options.url = options.url.replace( '_USERID_', self.token.UserID );

	    var p = 'qs';
	    if ( options.method == 'POST' ) p = 'form';

	    if ( ! options[ p ] ) options[ p ] = {};
            options[ p ].client_id = self.config.creds.clientID;
            options[ p ].client_secret = self.config.creds.clientSecret;
            options[ p ].access_token = self.token.access_token;
	    options[ p ].SC = self.config.SC;

	    // Determine what SV to send
	    var url = options.uri || options.url;
	    var fcn = path.basename( url );
	    options[ p ].SV = self.config.SV[ fcnToSV[ fcn ] || 'OpenApiUserInfo' ];

	    //console.log( JSON.stringify( options, null, 2 ) );

	    request( options, function( err, res, body ) {
		if ( err ) return cb( new Error( 'request: ' + err.message ) );
		cb( null, body );
	    });
	},
    ], function( err, results ) {
	if ( err ) return cb( err );
	cb( null, results[1], results[0] );
    });
}

module.exports = IHealth;
