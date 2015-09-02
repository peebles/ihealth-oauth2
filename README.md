# Ihealth OAuth2

Client library to support interfacing with the Ihealth API using OAuth2.

This library implements the Authorization Code Grant Flow for Ihealth.  Specifically, this flow
allows a browser-less server to make Ihealth API calls using a persisted token.  The initial
user authorization must be done in a browser environment.  If the token returned is persisted
(to a database for example), then subsequent API calls may be made on behalf of the user by
webserver or by non-webserver code.  This library automatically handles token refreshes.

## Usage Example

### In a webapp

    var express = require('express'),
        app = express();
    var config = require( './config/app.json' );
    var fs = require( 'fs' );
    
    var Ihealth = require( 'ihealth-oauth2' );
    
    // Simple token persist functions.
    //
    var persist = {
        read: function( filename, cb ) {
            fs.readFile( filename, { encoding: 'utf8', flag: 'r' }, function( err, data ) {
                if ( err ) return cb( err );
                try {
                    var token = JSON.parse( data );
                    cb( null, token );
                } catch( err ) {
                    cb( err );
                }
            });
        },
        write: function( filename, token, cb ) {
            console.log( 'persisting new token:', JSON.stringify( token ) );
            fs.writeFile( filename, JSON.stringify( token ), cb );
        }
    };
    
    // Instanciate a ihealth client.  See example config below.  Also pass in a
    // token persistence function, to persist a new token when fetched or
    // refreshed.
    //
    var ih = new Ihealth( config, function( token, cb ) {
        persist.write( 'ih-token.json', token, cb );
    });
    
    // In a browser, http://localhost:4000/ihealth to authorize a user for the first time.
    //
    app.get('/ihealth', function (req, res) {
        res.redirect( ih.authorizeURL() );
    });
    
    // Callback service parsing the authorization token and asking for the access token.  This
    // endpoint is refered to in config.authorization_uri.redirect_uri.  See example
    // config below.
    //
    app.get('/ihealth_auth_callback', function (req, res, next) {
        var code = req.query.code;
        ih.fetchToken( code, function( err, token ) {
            if ( err ) return next( err );
            persist.write( 'ih-token.json', token, function( err ) {
                if ( err ) return next( err );
                res.redirect( '/ih-profile' );
            });
        });
    });
    
    // Call an API.  ihealth.request() mimics nodejs request() library, automatically
    // adding other required parameters.  The callback is a bit different, called
    // with ( err, body, token ).  If token is non-null, this means a refresh has happened
    // and you should persist the new token, unless you passed a persistence function
    // as an argument to the constructor.
    //
    app.get( '/ih-profile', function( req, res, next ) {
        ih.request({
            uri: ih_config.uris.apiUri + "/openapiv2/user/_USERID_.json",
            method: 'GET',
        }, function( err, body, token ) {
            if ( err ) return next( err );
            var profile = JSON.parse( body );
            res.send( '<pre>' + JSON.stringify( profile, null, 2 ) + '</pre>' );
        });
    });
    
    app.listen(4000);
    console.log('ihealth auth server started on port 4000');

### Outside of a webapp

Once a token has been persisted, you can write non-webapp code to call Ihealth APIs.  When
the token expires, this library will automatically refresh the token and carry on.  Here's
an example:

    var config = require( './config/app' );
    var fs     = require( 'fs' );
    var async  = require( 'async' );
    var moment = require( 'moment' );
    
    var Ihealth = require( 'ihealth-oauth2' );
    
    // Simple token persist code
    //
    var tfile = 'ih-token.json';
    var persist = {
        read: function( filename, cb ) {
            fs.readFile( filename, { encoding: 'utf8', flag: 'r' }, function( err, data ) {
                if ( err ) return cb( err );
                try {
                    var token = JSON.parse( data );
                    cb( null, token );
                } catch( err ) {
                    cb( err );
                }
            });
        },
        write: function( filename, token, cb ) {
            console.log( 'persisting new token:', JSON.stringify( token ) );
            fs.writeFile( filename, JSON.stringify( token ), cb );
        }
    };
    
    // Instanciate the client.  Specify the token persistence function
    // here so we don't have to deal with it on every call to an api.
    //
    var ihealth = new Ihealth( config, function( token, cb ) {
        persist.write( tfile, token, cb );
    });
    
    // Read the persisted token, initially captured by a webapp.
    //
    persist.read( tfile, function( err, token ) {
        if ( err ) {
            console.log( err );
            process.exit(1);
        }
    
        // Set the client's token
        ihealth.setToken( token );
    
        // Make an API call
        // The "_USERID_" placeholder will be replaced by the UserID stored in the token.
        async.series([
            function( cb ) {
                ihealth.request({
                    uri: config.uris.apiUri + "/openapiv2/user/_USERID_.json",
                    method: 'GET',
                }, function( err, body, token ) {
                    if ( err ) return cb( err );
    
                    console.log( JSON.stringify( JSON.parse( body ), null, 2 ) );
                    cb();
                });
            },
            function( cb ) {
                ihealth.request({
                    uri: config.uris.apiUri + "/openapiv2/user/_USERID_/spo2.json",
                    method: 'GET',
                    qs: {
                        start_time: 0,
                        end_time: moment().unix(),
                    },
                }, function( err, body, token ) {
                    if ( err ) return cb( err );
    
                    console.log( JSON.stringify( JSON.parse( body ), null, 2 ) );
                    cb();
                });
            },
        ], function( err ) {
            if ( err ) console.log( err );
            process.exit(0);
        });
    });

## Configuration

An example configuration file:

    {
        "timeout": 10000,
        "creds": {
            "clientID": "YOUR_CLIENT_ID",
            "clientSecret": "YOUR_CLIENT_SECRET"
        },
        "uris": {
            "apiUri": "https://api.ihealthlabs.com:8443",
            "authorizationUri": "https://api.ihealthlabs.com:8443",
            "authorizationPath": "/api/OAuthv2/userauthorization.ashx",
            "tokenUri": "https://api.ihealthlabs.com:8443",
            "tokenPath": "/api/OAuthv2/userauthorization.ashx"
        },
        "authorization_uri": {
            "redirect_uri": "http://localhost:4000/ihealth_auth_callback/",
            "response_type": "code",
            "APIName": "OpenApiActivity OpenApiBG OpenApiBP OpenApiSleep OpenApiSpO2 OpenApiUserInfo OpenApiWeight"
        },
        "SC": "YOUR_SC_VALUE",
        "SV": {
            "OpenApiActivity": "YOUR_SV_FOR_ACTIVITY",
            "OpenApiBG": "YOUR_SV_FOR_BG",
            "OpenApiBP": "YOUR_SV_FOR_BP",
            "OpenApiSleep": "YOUR_SV_FOR_SLEEP",
            "OpenApiSpO2": "YOUR_SV_FOR_SPO2",
            "OpenApiUserInfo": "YOUR_SV_FOR_USERINFO",
            "OpenApiWeight": "YOUR_SV_FOR_WEIGHT"
        }
    }

The values you need to plug in here for your application will be given to you in an email when you register a new app
at the iHealth web site.

## Token Storage

A token is a JSON blob, and looks like this:

    {
        "access_token": ACCESS_TOKEN,
        "expires_in": SECONDS,
        "expires_at": "20150829T10:20:25",
        "refresh_token": REFRESH_TOKEN,
	"UserID": IHEALTH_USER_ID
    }

## API

#### `new Ihealth( config )`
Constructor.  See example config above.

#### `new Ihealth( config, persistTokenCB )`
Alternative constructor.  If called with a function as the second parameter, that function will be called when
a new token has been fetched as the result of a token refresh.  The function is called with the new token (as
a JSON struct) and a callback.  When the function is finished it should call the callback.  Example:

    var ihealth = new Ihealth( config, function( token, cb ) {
        saveToken( JSON.stringify( token ), function( err ) {
            if ( err ) return cb( err );
            cb();
        });
    });

#### `setToken( token )`
Set the client token.  The client token must be set before a call to request() is made.  In a webapp,
the client token will be set when initial authorization happens.  In a non-webapp, you must obtain
the token from persistent storage and call this method.

#### `getToken()`
Returns the client token if it has been set, null otherwise.

#### `authorizeURL()`
Used in a webapp to get the authorization URL to start the OAuth2 handshake.  Typical usage:

    app.get( '/auth', function( req, res ) {
        res.redirect( ihealth.authorizeURL() );
    });

#### `fetchToken( code, cb )`
Used in a webapp to handle the second step of OAuth2 handshake, to obtain the token from Ihealth.  See
example above for usage.

#### `request( options, cb )`
Call a Ihealth API.  The options structure is the same as nodejs request library and in fact is passed
almost strait through to request().  The cb() is called with (err, body, token).  If token is not
null, then it means that a token refresh has happened and you should persist the new token.

Some of the iHealth endpoints require the "user_id" in the endpoint uri.  This user_id is stored in the
OAuth2 token.  When you specify the endpoint uri, "_USERID_" will be replaced with the user_id before the
call is made to the endpoint.  For example, to call the blood oxygen endpoint with a user_id:

    ihealth.request({
        uri: config.uris.apiUri + "/openapiv2/user/_USERID_/spo2.json",
        method: 'GET',
        start_time: moment().subtract( 1, 'week' ).unix()
    }, function( err, body, token ) {
        // ...
    });

