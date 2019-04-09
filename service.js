const fs = require( "fs" );
const path = require( "path" );
const commandLineArgs = require('command-line-args');
const spawn = require('child_process').spawn;
const execSync = require('child_process').execSync;
const chalk = require('chalk');
const Bootstrapper = require( "./Bootstrapper.js" ).Bootstrapper;

/* Options
  exec : String : [node]
  processName : String,
  forwardArgs : String Array,
  pid : String,
  useLogging : Boolean,
  appendLogs : Boolean,
  startupMessage : String,
  stdout : String,
  stderr : String,
  services : Service Array,
  cli : Command Array,
  config: String,
  target : String,
  environments: String Array,
  execute : Function #for single services this will do inline command execution keeping the debugger running intack.
}
*/

exports.Service = class Service{
  constructor( options = {} ){
    let defaultEnv = process.env.NODE_ENV || options.target || ( options.environments ? options.environments[0] : "development" );
    if( options.target && options.environments.indexOf( options.target ) === -1 ){
      options.environments.push( options.target );
    }
    this.execScript = path.relative( process.cwd(), this.caller(2) );
    this.options = options;
    this._createCliOptions( [
      {
        name : "command",
        alias : 'x',
        type : String,
        defaultValue : "start",
        defaultOption : true,
        description : "Command to run the service with. Default 'start'",
        typeLabel : "[underline]{start}|[underline]{debug}|[underline]{restart-debug}|[underline]{stop}|[underline]{restart}|[underline]{status}|[underline]{manual}"
      }, {
        name : "killCode",
        alias : 'k',
        type : String,
        defaultValue : options.killCode || "SIGINT",
        description : `Kill code to use when using the stop or restart command. Default '${options.killCode || "SIGINT"}'`,
      }, {
        name : "config",
        alias : "c",
        type : String,
        defaultValue : options.config || "",
        description : `Config file to load into bootstrap.${this.options.config ? " Default " + this.options.config + "." : ""}`,
        typeLabel : "[underline]{filename}"
      }, {
        name : "target",
        alias : "t",
        description : `Target environment. Default '${options.target || defaultEnv}'`,
        type : String,
        defaultValue : options.target || defaultEnv,
        typeLabel : ( options.environments || ["production", "test", "development"] )
          .sort( (x, y) => x === defaultEnv ? -1 : y === defaultEnv ? 1 : 0 )
          .map( env => `[underline]{${env}}` )
          .join( '|' )
      }, {
        name : "isBootStrapped",
        type : Boolean,
        defaultValue : false
      }, {
        name : "isHooked",
        type : Boolean,
        defaultValue : false
      }
	  ] );

    this._yieldProcesses();
  }

  _killProcess( service, overrideSignal = null ){
    overrideSignal = overrideSignal || this.cliOptions.killCode;
    let pid = fs.readFileSync( this._pidLocation( service ) ).toString().trim();
    if( pid.match( /^\d+$/ ) && this._pidDetail( service ) === this._title( service ) ){
      process.kill( pid, overrideSignal );
    }
    if( overrideSignal === "SIGTERM" || overrideSignal === "SIGKILL" ){
      try{
        fs.unlinkSync( this._pidLocation( service ) );
      }
      catch( ex ){
        //Throw away kill process file errors//
      }
    }
  }

  async _yieldProcesses(){
    if( ( !this.options.group && !this.options.services ) || this.cliOptions.command === "manual" ){
      this._yieldProcess();
    }
    else{
      if( this.cliOptions.service ){
        //this.options.services.filter( x => x.name === this.cliOptions.service )[0].pushDebug = true;
        this._yieldProcess( this.cliOptions.service );
      }
      else{
        for( let i = 0; i < this.options.services.length; i++ ){
          if( ( !this.cliOptions.group || this.options.services[i].group === this.cliOptions.group ) && ( this.cliOptions.command === "debug" || this.cliOptions.command === "restart-debug" || !this.options.services[i].debugOnly ) ){
            await this._yieldProcess( this.options.services[i].name );
          }
        }
      }
    }
  }

  _status( service ){
    return this._title( service ) + " is " + ( ( this._isStopped( service ) ) ? "stopped" : "running" );
  }

  _timeout( timer ){
    return new Promise( ( resolve, reject ) => {
      setTimeout( () => resolve(), timer );
    });
  }

  async _yieldProcess( service ){
    if( this.cliOptions.isHooked ){
      this._configureProcess( service );
      let bootstrapper = new Bootstrapper( service, this );
      let proc = await this._runCommand( service, this._generateArguments( service, true ), true, this.options.services.filter( x => x.name === service )[0].captureInput || false, this.options.services.filter( x => x.name === service )[0].autoRestart );
      if( this.options.services.filter( x => x.name === service )[0].parentExecute ){
        this.options.services.filter( x => x.name === service )[0].parentExecute( bootstrapper );
      }
      process.on( "SIGINT", () => {
        proc.kill( "SIGINT" );
        process.exit();
      })
    }
    else if( this.cliOptions.isBootStrapped ){
      process.title = this._title( service ) + "-child";
      //console.log( "--YIELD PROCESS " + service + " FINISHED--" );
      this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this, false ) );
    }
    else{
      switch( this.cliOptions.command ){
        case "restart":
          let maxKillTimer = 3000;
          let currentTimer = 0;
          this._killProcess( service );
          while( currentTimer < maxKillTimer && !this._isStopped( service ) ){
            await this._timeout( 10 );
            currentTimer += 10;
          }
          if( !this._isStopped( service ) ){
            console.log( "Couldn't stop process sending termination signal." );
            this._killProcess( service, "SIGTERM" );
          }
          await this._runCommand( service, this._generateArguments( service ), false, this.options.services.filter( x => x.name === service )[0].captureInput || false );
          break;
        case "manual":
          const getUsage = require('command-line-usage');
          let sections = this.options.usage || [];
          sections.push( { header : "Options", optionList : this._appCliOptions.filter( option => option.name !== "isBootStrapped" && option.name !== "isHooked" ) } );
          console.log( getUsage( sections ) );
          break;
        case "status":
          console.log( this._status( service ) );
          break;
        case "stop":
          if( !this._isStopped( service ) ){
            this._killProcess( service );
            console.log( this._title( service ) + " has been stopped." );
          }
          else{
            if( fs.existsSync( this._pidLocation( service ) ) ){
              fs.unlinkSync( this._pidLocation( service ) );
              console.log( "Cleared stale pid for " + this._title( service ) + "." );
            }
            else{
              console.log( this._title( service ) + " is not running." );
            }
            
          }
          break;
        case "start":
          if( this._isStopped( service ) ){
            await this._runCommand( service, this._generateArguments( service ), false, this.options.services.filter( x => x.name === service )[0].captureInput || false );
          }
          else{
            console.log( this._title( service ) + " is already running." );
          }
          break;
        case "restart-debug":
          if( !this._isStopped( service ) ){
            this._killProcess( service );
            console.log( this._title( service ) + " stopped to restart for debug." );
          }
        case "debug":
          if( this._isStopped( service ) ){
            if( !this.options.services ){
              this._configureProcess( service );
              this.options.execute( new Bootstrapper( service, this ));
            }
            else if( this.options.services.filter( x => x.name === service )[0].pushDebug ){
              this._configureProcess( service );
              this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this ) );
            }
            else{
              await this._runCommand( service, this._generateArguments( service ), true, this.options.services.filter( x => x.name === service )[0].captureInput || false );
            }
          }
          else{
            console.log( this._title( service ) + " is already running.\nRun 'stop', 'restart', or 'restart-debug'." );
          }
          break;
      }
    }
  }

  caller( depth ) {
    let pst, stack, file, frame;

    pst = Error.prepareStackTrace;
    Error.prepareStackTrace = function (_, stack) {
      Error.prepareStackTrace = pst;
      return stack;
    };

    stack = (new Error()).stack;
    depth = !depth || isNaN(depth) ? 1 : (depth > stack.length - 2 ? stack.length - 2 : depth);
    stack = stack.slice(depth + 1);

    do {
      frame = stack.shift();
      file = frame && frame.getFileName();
    } while (stack.length && file === 'module.js');

    return file;
  }

  _generateArguments( service, bootstraped = false ){
    let args = [ this.execScript ];
    args = args.concat( this.options.forwardArgs || [] );

    let cliOps = Object.assign( {}, this.cliOptions );
    cliOps.service = service;
    if( bootstraped === false ){
      cliOps.isHooked = true;
    }
    else{
      delete cliOps.isHooked;
      cliOps.isBootStrapped = true;
    }
    
    args = args.concat( this.options.forwardArgs || [] );
    for( let i = 0; i < this._appCliOptions.length; i++ ){
      if( cliOps[this._appCliOptions[i].name] ){
        args.push( "--" + this._appCliOptions[i].name );
        args.push( cliOps[this._appCliOptions[i].name] );
      }
    }
    return args;
  }

  _runCommand( service, args, watch = false, passinput = false, autoRestart = false ){
    return new Promise( ( resolve, reject ) => {
      this._validatePath( path.resolve( path.dirname( this.stdOut( service ) ) ), "stdout log file" );
      this._validatePath( path.resolve( path.dirname( this.stdErr( service ) ) ), "stderr log file" );
      
      const localEnv = { ...process.env };
      localEnv.NODE_ENV = this.cliOptions.target;
      if( watch ){
        let resolved = false;
        let childSpawn = spawn( this.options.exec || "node", args, {
          env: localEnv
        } );
        if( passinput ){
          process.stdin.on('readable', () => {
            var chunk = process.stdin.read();
            if (chunk !== null) {
              childSpawn.stdin.write( chunk );
            }
          });
        }
        childSpawn.stdout.setEncoding( "utf8" );
        childSpawn.stdout.on( 'data', ( chunk ) => {
          if( !resolved ){
            resolved = true;
            resolve();
          }
          console.log( chunk.toString().trim() );
        } );
        childSpawn.stderr.on( 'data', ( chunk ) => {
          console.error( chalk.red( chunk.toString().trim() ) );
        });
        childSpawn.on( "exit", ( ) => {
          if( autoRestart ){
            this._runCommand( service, args, watch, passinput, autoRestart );
          }
        } );
        resolve( childSpawn );
      }
      else{
        let out = fs.openSync( this.stdOut( service ), 'a');
        let outRead = fs.createReadStream( this.stdOut( service ) );
        let readStream = fs.createReadStream( this.stdOut( service ) );
        let err = fs.openSync( this.stdErr( service ), 'a');
        let errRead = fs.createReadStream( this.stdErr( service ) );
        let childSpawn = spawn( this.options.exec || "node", args, {
          detached: true,
          stdio: [ 'ignore', out, err ],
          env: localEnv
        } );

        readStream.on( 'data', ( chunk ) => {
          readStream.close();
          resolve();
        } );

        childSpawn.unref();
      }
    });
  }

  _pidDetail( service ){
    if( !fs.existsSync( this._pidLocation( service ) ) ){
      return "";
    }
    else{
      try{
        let pidNumber = fs.readFileSync( this._pidLocation( service ) ).toString().trim();
        if( pidNumber.match( /^\d+$/) ){
          return execSync( "ps -p " + pidNumber + " -o command=" ).toString().trim();
        }
      }
      catch( ex ){
        return "";
      }

      return "";
    }
  }

  _isStopped( service ){
    return !( ( fs.existsSync( this._pidLocation( service ) ) && this._pidDetail( service ) === this._title( service ) ) );
  }

  _createCliOptions( defaultCliOptions ){
    if( this.options.services && this.options.services instanceof Array ){
      let valueTypes = this.options.services.map( x => "[underline]{" + x.name + "}" );
      let groupTypes = [ ...new Set( this.options.services.filter( x => x.group ).map( x => x.group ) )].map( group => "[underline]{" + group + "}" );
      defaultCliOptions.push( { name : "service", alias : 's', type : String, description : "Service to execute command on.", typeLabel : valueTypes.join("|") } );
      if( groupTypes.length > 0 ){
        defaultCliOptions.push( { name : "group", alias : 'g', type : String, description : "Service group to execute command on.", typeLabel : groupTypes.join("|") } );
      }
    }
    let appCliOptions = this.options.cli || [];
    let appCliNames = appCliOptions.map( y => y.name );
    defaultCliOptions.filter( x => appCliNames.indexOf( x.name ) === -1 ).map( x => appCliOptions.push( x ) );
    this._appCliOptions = appCliOptions;
    this.cliOptions = commandLineArgs( this._appCliOptions );
  }

  _title( service ){
    return this._replaceNaming( service, this.options.processName || "bootloader-%service%" );
  }

  _pidLocation( service ){
    return this._replaceNaming( service, this.options.pid || "run/process-%service%.pid" );
  }

  stdErr( service ){
    return this._replaceNaming( service, this.options.stderr || "logs/stderr-%service%.log" );
  }

  stdOut( service ){
    return this._replaceNaming( service, this.options.stdout || "logs/stdout-%service%.log" );
  }

  _configureProcess( service ){
    process.title = this._title( service );
    this._validatePath( path.resolve( path.dirname( this._pidLocation( service ) ) ), "pid file" );
    if( this.options.useLogging === undefined || this.options.useLogging === true ){
      let appendLogs = this.options.appendLogs || false;
      let startupMessage = this.options.startupMessage || "======= Start up " + ( new Date() ) + " =======\r\n";
      if( appendLogs ){
        fs.appendFileSync( this.stdOut( service ), "\n" );
        console.log( startupMessage );
        fs.appendFileSync( this.stdErr( service ), "\n" );
        console.error( startupMessage );
      }
      else{
        fs.writeFileSync( this.stdOut( service ), "" );
        console.log( startupMessage );
        fs.writeFileSync( this.stdErr( service ), "" );
        console.error( startupMessage );
      }
    }
  }

  _replaceNaming( service, namedString ){
    namedString = namedString.replace( "%service%", service || "daemon" );
    let serviceOptions = this.options.services.filter( x => x.name === service )[0] || {};
    namedString = namedString.replace( "%group%", serviceOptions.group || "daemon-group" );
    this._appCliOptions.map( x => namedString = namedString.replace( "%" + x.name + "%", this.cliOptions[x.name] ));
    return namedString;
  }

  _validatePath( dir, reason ){
    let validationPath = path.relative( process.cwd(), dir );
    if( validationPath !== "" ){
      let pathing = validationPath.split( "/" );
      let searchPath = "";
      for( let i = 0; i < pathing.length; i++ ){
        if( pathing[i] !== ".." ){
          searchPath += pathing[i] + "/";
          try{
            if( !fs.statSync( searchPath ).isDirectory() ){
              console.error( "Validation path for '" + reason + "' is a file and must be a directory" );
              process.exit();
            }
            
          }
          catch( ex ){
            fs.mkdirSync( searchPath );
          }
          
        }
        else{
          searchPath += "../";
        }
      }
    }
  }
}