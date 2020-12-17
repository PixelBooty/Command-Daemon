# Command-Daemon
Daemon with command line arguments for execution.

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

Built in CLI Options
====================
* --command or -x: Command to run the server, this is also the default cli argument and the default value is start. Options start|debug|restart|restart-debug|status|manual
* --killCode or -k: Kill code to be used to kill the running process for stop command, defaults value is SIGINT.
* --config or -c: The location of the config file the bootloader will use, it can use %service|group|target% syntax.
* --target or -t: Target of the running system if you want to have your targets run differently, this defaults to NODE_ENV or the target in the config, or the first envrionment.
* --group or -g: Target group of services to run the command on. Services must have a group option set to run in a group.
* --service or -s: Target service name to run the command on.

Config Options
==============
* usage : Command line usage sections, see 'npm command-line-usege'
* exec : String, default 'node', the process that will be executed.
* processName : String default 'bootloader-%service%', like other names %option% is a replacement for cli option by name.
* forwardArgs : String[], additional arguments for exec process.
* pid : String default 'run/process-%service%.pid', location of the generated pid file.
* useLogging : Boolean default true, tells the system if custom basic logging is enabled.
* appendLogs : Boolean default false, tells the basic logging system to append rather then replace.
* startupMessage : String default '======= Start up {date} =======', message to start basic logging.
* stdout : String default 'logs/stdout-%service%.log', location of stdout for basic logging.
* stderr : String default 'logs/stderr-%service%.log', location of stderr for basic logging.
* logSize : Number in megabytes of which after the log will break off.
* logBreaks : Number of times a log can break off before a break is removed.
* services : Array of sevices, see service options.
* cli : Array of cli options see 'npm command-line-args' for details on cli objects.
* target: Default target to be used.
* environments: Array of types of environments to allow to be targeted. Defaults to and array of "production, test, and development".

Service Options
===============
* name : String, name of the service, when services are not used the name of the default service is daemon.
* debugOnly : Will only start/stop the node when in debug mode.
* pushDebug : Passes process instance to this service rather then creating a spawn.
* captureInput : Passes process instance input to service, recommended this is only set for one service, and pushDebug is off.
* execute : Method that executes to start the node service.
* group : Name of the group that will be targeted with the command.
* autoRestart : The process is watched by a parent process, and can be automatically restarted if this option is turned on.
* parentExecute : If additional functionallity is to be performed on the parent process this execute function will be run in the parent process if the option exists.
* configFile : Override of the location of the config file for a serivce in the service tree.

Basic Use
=========
Create a file like server.js
```
require( "command-daemon" ).startup( { execute : ( bootstrap ) => { ...Run App... } } );
```
```
node server.js debug|stop|start|restart|restart-debug|status|manual
```

Multiple Nodes
==============
Use the settings for services, each service being configured. As an example running a npm command behind your application.
```

require( "command-daemon" ).startup( {
  services : [
    {
      name : "webserver",
      pushDebug : true,
      execute : ( bootstrap ) => {
        //... Run Web Server ...
        require( "./myWebServer.js" )( bootstrap.config );
      }
    }, {
      name : "npmTask",
      debugOnly : true,
      execute : ( bootstrap ) => {
        //Npm or another cli program other than node//
        bootstrap.task( "npm run task", { cwd: "/x/y/z" }, () => console.log( "Task ended" ) );
      }
    }
  ]
} );
```

BootStrapper
============
The Boot strapper is in charge of tracking pids. Creating exception helpers. It also loads and tracks config files written in JSON. By default if no config file is loaded it will set the debug flag depending on if the execution command is a debug type. It has one exposed event for sub process clean up which is 'onclose'.

Roadmap
=======
1. See if debug system of node can't be sent to parent spawn to allow for single step debugging.