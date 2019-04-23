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
    let pids = [];
    if( fs.existsSync( this._pidLocation( service ) ) ){
      pids = [ fs.readFileSync( this._pidLocation( service ) ).toString().trim() ];
    }
    else{
      //The pid file has been removed, now we kill um all...
      if( this._hasZombies( service ) ){
        let processTitle = this._title( service );
        let zombieResult = execSync( `ps aux | grep [${processTitle[0]}]${processTitle.substring( 1 )}` ).toString().trim();
        pids = zombieResult.split( "\n" ).map( psAuxLine => {
          let foundResult = psAuxLine.match( /^[A-z\d\_\-]+\s+(\d+)/ );
          return foundResult[1] || null;
        }).filter( pidResult => pidResult !== null );
      }
    }
    pids.forEach( pid => {
      if( pid.match( /^\d+$/ ) && ( this._pidDetail( service ) === this._title( service ) || this._pidDetail( service ) === "" ) ){
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
    });
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
    return this._title( service ) + " is " + ( ( this._isStopped( service ) ) ? "stopped" + ( this._hasZombies( service ) ? " with zombies" : "" ) : "running" );
  }

  _timeout( timer ){
    return new Promise( ( resolve, reject ) => {
      setTimeout( () => resolve(), timer );
    });
  }

  async _fullStop( service ){

    if( this._anyRunning( service ) ){

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

      if( !this._anyRunning( service ) ){
        console.log( this._title( service ) + " has been stopped." );
      }
      else{
        if( fs.existsSync( this._pidLocation( service ) ) ){
          fs.unlinkSync( this._pidLocation( service ) );
          console.log( "Cleared stale pid for " + this._title( service ) + "." );
        }
        this._killProcess( service, "SIGTERM" );
        console.log( this._title( service ) + " has been stopped forcefully." );
      }
      
    }
    else{
      console.log( this._title( service ) + " is not running." );
    }
  }

  _anyRunning( service ){
    return !this._isStopped( service ) || this._hasZombies( service );
  }

  async _yieldProcess( service ){
    if( this.cliOptions.isHooked ){
      this._configureProcess( service );
      let bootstrapper = new Bootstrapper( service, this );
      let proc = await this._runCommand( service, true, true );
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
          await this._fullStop( service );
          await this._runCommand( service, false );
          console.log( this._title( service ) + " has started." );
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
          await this._fullStop( service );
          break;
        case "start":
          if( !this._anyRunning( service ) ){
            await this._runCommand( service, false );
            console.log( this._title( service ) + " has started." );
          }
          else{
            console.log( this._title( service ) + " is already running." );
          }
          break;
        case "restart-debug":
          this._fullStop( service );
        case "debug":
          if( !this._anyRunning( service ) ){
            if( this.options.services.filter( x => x.name === service )[0].pushDebug ){
              this._configureProcess( service );
              this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this ) );
            }
            else{
              await this._runCommand( service, true );
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

  _generateArguments( service, bootstraped ){
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

  _configureLoggers( service, logSize, logBreaks ){
    let stdOut = [];
    let stdErr = [];
    let consoleOrg = {
      log: console.log,
      error: console.error,
      info: console.info,
      warn: console.warn
    };

    console.log = function(){
      let args = [ ...arguments ].map( arg => arg.toString() );
      stdOut.push( args.join( "\n" ) + "\n" );
      consoleOrg.log.apply( this, arguments );
    }

    console.error = function(){
      let args = [ ...arguments ].map( arg => arg.toString() );
      stdErr.push( args.join( "\n" ) + "\n" );
      consoleOrg.error.apply( this, arguments );
    }

    console.info = function(){
      let args = [ ...arguments ].map( arg => arg.toString() );
      stdOut.push( args.join( "\n" ) );
      consoleOrg.info.apply( this, arguments );
    }

    console.warn = function(){
      let args = [ ...arguments ].map( arg => arg.toString() );
      stdErr.push( args.join( "\n" ) );
      consoleOrg.warn.apply( this, arguments );
    }

    let outFile = this.stdOut( service );
    let errFile = this.stdErr( service );

    let cycle = async () => {
      if( stdOut.length > 0 ){
        let stdOutCopy = stdOut;
        stdOut = [];
        try{
          await this._appendLog( outFile, stdOutCopy.join( "\n" ) );
        }
        catch( ex ){
          //Load back in and wait for next log dump
          console.error( "SYSTEM ERROR: unable to append logs", ex );
          stdOut = [ ...stdOutCopy, ...stdOut ];
        }
        await this._breakLogFile( outFile, logSize, logBreaks );
      }
      if( stdErr.length > 0 ){
        let stdErrCopy = stdErr;
        stdErr = [];
        try{
          await this._appendLog( errFile, stdErrCopy.join( "\n" ) );
        }
        catch( ex ){
          //Load back in and wait for next log dump
          console.error( "SYSTEM ERROR: unable to append logs", ex );
          stdErr = [ ...stdErrCopy, ...stdErr ];
        }
        await this._breakLogFile( errFile, logSize, logBreaks );
      }
      setTimeout( cycle, 1 );
    };
    cycle();
  }

  _createFile( logFile ){
    return new Promise( ( resolve, reject ) => {
      fs.writeFile( logFile, "", (err) => {
        if( err ){
          reject( err );
        }
        else{
          resolve();
        }
      });
    })
  }

  _appendLog( logFile, content ){
    return new Promise( ( resolve, reject ) => {
      fs.appendFile( logFile, content, ( err ) => {
        if( err ){
          reject( err );
        }
        else{
          resolve();
        }
      });
    });
  }

  _statFile( fileName ){
    return new Promise( ( resolve, reject ) => {
      fs.stat( fileName, ( err, stat ) => {
        if( err ){
          reject( err );
        }
        else{
          resolve( stat );
        }
      });
    });
  }

  _exists( fileName ){
    return new Promise( ( resolve ) => {
      fs.access( fileName, fs.constants.F_OK | fs.constants.W_OK, ( err ) => {
        if( err ){
          resolve( false );
        }
        else{
          resolve( true );
        }
      });
    })
  }

  _rename( fileName, nextName ){
    return new Promise( ( resolve, reject ) => {
      fs.rename( fileName, nextName, (err) => {
        if( err ){
          reject( err );
        }
        else{
          resolve();
        }
      });
    } );
  }

  async _breakLogFile( logFile, logSize, logBreaks ){
    if( logSize !== -1 && logBreaks > 0 ){
      try{
        let stat = await this._statFile( logFile );
        let fileSizeMegs = stat.size / 1024 / 1024;
        if( fileSizeMegs > logSize ){
          for( let i = logBreaks - 1; i >= 0; i-- ){
            if( i === 0 ){
              try{
                await this._rename( logFile, logFile + "." + ( i + 1 ) );
                await this._createFile( logFile );
              }
              catch( ex ){
                console.error( "SYSTEM ERROR: unable to move log file", logFile, ex );
                break;
              }
            }
            if( await this._exists( logFile + "." + i ) ){
              try{
                await this._rename( logFile + "." + i, logFile + "." + ( i + 1 ) );
              }
              catch( ex ){
                console.error( "SYSTEM ERROR: unable to move log file", logFile, ex );
                break;
              }
            }
          }
        }
      }
      catch( ex ){
        console.error( "SYSTEM ERROR: unable to break up logs", ex );
      }
    }
  }

  _runCommand( service, watch = false, bootstrapped = false ){
    let serviceObject = this.options.services.filter( x => x.name === service )[0];
    let passinput = serviceObject.captureInput || false;
    let autoRestart = false;
    let logoutput = false;
    let args = null;
    if( bootstrapped ){
      args = this._generateArguments( service, true );
      autoRestart = serviceObject.autoRestart || autoRestart;
      logoutput = true;
    }
    else{
      args = this._generateArguments( service, false );
    }
    
    return new Promise( ( resolve, reject ) => {
      if( logoutput ){
        if( this.options.useLogging === undefined || this.options.useLogging === true ){
          this._validatePath( path.resolve( path.dirname( this.stdOut( service ) ) ), "stdout log file" );
          this._validatePath( path.resolve( path.dirname( this.stdErr( service ) ) ), "stderr log file" );
          let appendLogs = this.options.appendLogs || false;
          let startupMessage = this.options.startupMessage || "======= Start up " + ( new Date() ) + " =======\r\n";
          if( appendLogs ){
            fs.appendFileSync( this.stdOut( service ), "\n" );
            fs.appendFileSync( this.stdErr( service ), "\n" );
          }
          else{
            fs.writeFileSync( this.stdOut( service ), "" );
            fs.writeFileSync( this.stdErr( service ), "" );
          }

          this._configureLoggers( service, this.options.logSize || -1, this.options.logBreaks || 0 );

          console.log( startupMessage );
          console.error( startupMessage );
        }
      }
      
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
          if( !logoutput ){
            console.error( chalk.red( chunk.toString().trim() ) );
          }
          else{
            console.error( chunk.toString().trim() );
          }
        });
        childSpawn.on( "exit", ( ) => {
          if( autoRestart ){
            this._runCommand( service, watch, bootstrapped );
          }
        } );
        resolve( childSpawn );
      }
      else{
        if( fs.existsSync( this._pidLocation( service ) ) ){
          fs.unlinkSync( this._pidLocation( service ) );
        }
        let processHook = () => {
          if( fs.existsSync( this._pidLocation( service ) ) ){
            resolve();
          }
          else{
            setTimeout( processHook, 50 );
          }
        };
        setTimeout( processHook, 50 );
        let childSpawn = spawn( this.options.exec || "node", args, {
          detached: true,
          stdio: 'ignore',
          env: localEnv
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

  _hasZombies( service ){
    let processTitle = this._title( service );
    let hasZombies = false
    try{
      hasZombies = execSync( `ps aux | grep [${processTitle[0]}]${processTitle.substring( 1 )}` ).toString().trim() != "";
    }
    catch( ex ){
      //Grep found nothing//
    }

    return hasZombies;
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