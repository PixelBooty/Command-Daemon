# Command-Daemon
Daemon with command line arguments for execution.

Work in progress
================
This package is enabled for debug commands, start command is not fully implemented.
This readme is not fleshed out.

Features
========
* Command-line process daemon for when running one instance of node won't cut it, and starting each is tedious.
* Works for single node applications as well.
* Custom command-line options.
* Helpers to keep node running indefinitly like exception handels.
* Basic built in logging.
* Inline output for multiple debugged services.

Install
=======
`npm install command-daemon`

Config Options
==============
* exec : String, default 'node', the process that will be executed.
* processName : String default 'bootloader-%service%', like other names %option% is a replacement for cli option by name.
* forwardArgs : String[], additional arguments for exec process.
* pid : String default 'run/process-%service%.pid', location of the generated pid file.
* useLogging : Boolean default true, tells the system if custom basic logging is enabled.
* appendLogs : Boolean default false, tells the basic logging system to append rather then replace.
* startupMessage : String default '======= Start up {date} =======', message to start basic logging.
* stdout : String default 'logs/stdout-%service%.log', location of stdout for basic logging.
* stderr : String default 'logs/stderr-%service%.log', location of stderr for basic logging.
* services : Array of sevices optional, see service options.
* cli : Array of cli options see 'npm command-line-args' for details on cli objects.
* execute : Function( Bootstrapper ), method if no services are used to execute service.

Service Options
===============
* name : String, name of the service, when services are not used the name of the default service is daemon.
* debugOnly : Will only start/stop the node when in debug mode.
* pushDebug : Boolean default true, Passes process instance to this service rather then creating a spawn.
* captureInput : Boolean default false, Passes process instance input to service, recommended this is only set for one service, and pushDebug is off.
* execute : Method that executes to start the node service.

Basic Use
=========
Create a file like server.js
`require( "command-daemon" ).startup( { execute : ( bootstrap ) => { ...Run App... } } );`
`node server.js debug|stop|start|restart|status|manual`

Multiple Nodes
==============
Use the settings for services, each service being configured. As an example running a npm command behind your application.
```
const spawn = require('child_process').spawn;

require( "command-daemon" ).startup( {
  services : [
    {
      name : "webserver",
      pushDebug : true,
      execute : ( bootstrap ) => {
        ... Run Web Server ...
      }
    }, {
      name : "npmTask",
      debugOnly : true,
      execute : () => {
        let childSpawn = spawn( "npm", [ "run", "... npm task ..." ] );
        childSpawn.stdout.on( 'data', ( chunk ) => {
          console.log( chunk.toString().trim() );
        } );
        childSpawn.stderr.on( 'data', ( chunk ) => {
          console.error( chunk.toString().trim() );
        });
        childSpawn.on( "exit", ( ) => {
          console.log( "npmTask CLOSED!" );
        } );

        bootstrap.OnClose( ( signal ) => {
          childSpawn.kill();
        });
      }
    }
  ]
} );
```

Roadmap
=======
1. See if debug system of node can't be sent to parent spawn to allow for single step debugging.