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
    this.execScript = path.relative( process.cwd(), this.Caller(2) );
    this.options = options;
    this._CreateCliOptions( [
      {
        name : "command",
        alias : 'x',
        type : String,
        defaultValue : "start",
        defaultOption : true,
        description : "Command to run the service with. Default 'start'",
        typeLabel : "[underline]{start}|[underline]{debug}|[underline]{restart-debug}|[underline]{stop}|[underline]{restart}|[underline]{status}|[underline]{manual}."
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
      }
	  ] );

    this._YieldProcesses();
  }

  _KillProcess( service, overrideSignal = null ){
    overrideSignal = overrideSignal || this.cliOptions.killCode;
    let pid = fs.readFileSync( this._PidLocation( service ) ).toString().trim();
    if( pid.match( /^\d+$/ ) && this._PidDetail( service ) === this._Title( service ) ){
      process.kill( pid, overrideSignal );
    }
    if( overrideSignal === "SIGTERM" || overrideSignal === "SIGKILL" ){
      try{
        fs.unlinkSync( this._PidLocation( service ) );
      }
      catch( ex ){
        //Throw away kill process file errors//
      }
    }
  }

  async _YieldProcesses(){
    if( !this.options.services || this.cliOptions.command === "manual" ){
      this._YieldProcess();
    }
    else{
      if( this.cliOptions.service ){
        this.options.services.filter( x => x.name === this.cliOptions.service )[0].pushDebug = true;
        this._YieldProcess( this.cliOptions.service );
      }
      else{
        for( let i = 0; i < this.options.services.length; i++ ){
          await this._YieldProcess( this.options.services[i].name );
        }
      }
    }
  }

  _Status( service ){
    return this._Title( service ) + " is " + ( ( this._IsStopped( service ) ) ? "stopped" : "running" );
  }

  _Timeout( timer ){
    return new Promise( ( resolve, reject ) => {
      setTimeout( () => resolve(), timer );
    });
  }

  async _YieldProcess( service ){
    if( this.cliOptions.isBootStrapped ){
      this._ConfigureProcess( service );
      //console.log( "--YIELD PROCESS " + service + " FINISHED--" );
      this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this ) );
    }
    else{
      switch( this.cliOptions.command ){
        case "restart":
          let maxKillTimer = 3000;
          let currentTimer = 0;
          this._KillProcess( service );
          while( currentTimer < maxKillTimer && !this._IsStopped( service ) ){
            await this._Timeout( 10 );
            currentTimer += 10;
          }
          if( !this._IsStopped( service ) ){
            console.log( "Couldn't stop process sending termination signal." );
            this._KillProcess( service, "SIGTERM" );
          }
          await this._RunCommand( service, this._GenerateArguments( service ), false, this.options.services.filter( x => x.name === service )[0].captureInput || false );
          break;
        case "manual":
          const getUsage = require('command-line-usage');
          let sections = this.options.usage || [];
          sections.push( { header : "Options", optionList : this._appCliOptions.filter( option => option.name !== "isBootStrapped" ) } );
          console.log( getUsage( sections.filter( x => x.name !== "isBootStrapped" ) ) );
          break;
        case "status":
          console.log( this._Status( service ) );
          break;
        case "stop":
          if( !this._IsStopped( service ) ){
            this._KillProcess( service );
            console.log( this._Title( service ) + " has been stopped." );
          }
          else{
            if( fs.existsSync( this._PidLocation( service ) ) ){
              fs.unlinkSync( this._PidLocation( service ) );
              console.log( "Cleared stale pid for " + this._Title( service ) + "." );
            }
            else{
              console.log( this._Title( service ) + " is not running." );
            }
            
          }
          break;
        case "start":
          if( this._IsStopped( service ) ){
            await this._RunCommand( service, this._GenerateArguments( service ), false, this.options.services.filter( x => x.name === service )[0].captureInput || false );
          }
          else{
            console.log( this._Title( service ) + " is already running." );
          }
          break;
        case "restart-debug":
          if( !this._IsStopped( service ) ){
            this._KillProcess( service );
            console.log( this._Title( service ) + " stopped to restart for debug." );
          }
        case "debug":
          if( this._IsStopped( service ) ){
            if( !this.options.services ){
              this._ConfigureProcess( service );
              this.options.execute( new Bootstrapper( service, this ));
            }
            else if( this.options.services.filter( x => x.name === service )[0].pushDebug ){
              this._ConfigureProcess( service );
              this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this ) );
            }
            else{
              await this._RunCommand( service, this._GenerateArguments( service ), true, this.options.services.filter( x => x.name === service )[0].captureInput || false );
            }
          }
          else{
            console.log( this._Title( service ) + " is already running.\nRun 'stop', 'restart', or 'restart-debug'." );
          }
          break;
      }
    }
  }

  Caller( depth ) {
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

  _GenerateArguments( service ){
    let args = [ this.execScript ];
    args = args.concat( this.options.forwardArgs || [] );

    let cliOps = Object.assign( {}, this.cliOptions );
    cliOps.service = service;
    cliOps.isBootStrapped = true;
    args = args.concat( this.options.forwardArgs || [] );
    for( let i = 0; i < this._appCliOptions.length; i++ ){
      if( cliOps[this._appCliOptions[i].name] ){
        args.push( "--" + this._appCliOptions[i].name );
        args.push( cliOps[this._appCliOptions[i].name] );
      }
    }
    return args;
  }

  _RunCommand( service, args, watch = false, passinput = false ){
    return new Promise( ( resolve, reject ) => {
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
          //finishedCallback();
        } );
        resolve();
      }
      else{
        this._ValidatePath( path.resolve( path.dirname( this.StdOut( service ) ) ), "stdout log file" );
        this._ValidatePath( path.resolve( path.dirname( this.StdErr( service ) ) ), "stderr log file" );
        let out = fs.openSync( this.StdOut( service ), 'a');
        let outRead = fs.createReadStream( this.StdOut( service ) );
        let readStream = fs.createReadStream( this.StdOut( service ) );
        let err = fs.openSync( this.StdErr( service ), 'a');
        let errRead = fs.createReadStream( this.StdErr( service ) );
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

  _PidDetail( service ){
    if( !fs.existsSync( this._PidLocation( service ) ) ){
      return "";
    }
    else{
      try{
        let pidNumber = fs.readFileSync( this._PidLocation( service ) ).toString().trim();
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

  _IsStopped( service ){
    return !( ( fs.existsSync( this._PidLocation( service ) ) && this._PidDetail( service ) === this._Title( service ) ) );
  }

  _CreateCliOptions( defaultCliOptions ){
    if( this.options.services && this.options.services instanceof Array ){
      let valueTypes = this.options.services.map( x => "[underline]{" + x.name + "}" );
      defaultCliOptions.push( { name : "service", alias : 's', type : String, description : "Service to execute command on.", typeLabel : valueTypes.join("|") } );
    }
    let appCliOptions = this.options.cli || [];
    let appCliNames = appCliOptions.map( y => y.name );
    defaultCliOptions.filter( x => appCliNames.indexOf( x.name ) === -1 ).map( x => appCliOptions.push( x ) );
    this._appCliOptions = appCliOptions;
    this.cliOptions = commandLineArgs( this._appCliOptions );
  }

  _Title( service ){
    return this._ReplaceNaming( service, this.options.processName || "bootloader-%service%" );
  }

  _PidLocation( service ){
    return this._ReplaceNaming( service, this.options.pid || "run/process-%service%.pid" );
  }

  StdErr( service ){
    return this._ReplaceNaming( service, this.options.stderr || "logs/stderr-%service%.log" );
  }

  StdOut( service ){
    return this._ReplaceNaming( service, this.options.stdout || "logs/stdout-%service%.log" );
  }

  _ConfigureProcess( service ){
    process.title = this._Title( service );
    this._ValidatePath( path.resolve( path.dirname( this._PidLocation( service ) ) ), "pid file" );
    if( this.options.useLogging === undefined || this.options.useLogging === true ){
      let appendLogs = this.options.appendLogs || false;
      let startupMessage = this.options.startupMessage || "======= Start up " + ( new Date() ) + " =======\r\n";
      if( appendLogs ){
        fs.appendFileSync( this.StdOut( service ), "\n" );
        console.log( startupMessage );
        fs.appendFileSync( this.StdErr( service ), "\n" );
        console.error( startupMessage );
      }
      else{
        fs.writeFileSync( this.StdOut( service ), "" );
        console.log( startupMessage );
        fs.writeFileSync( this.StdErr( service ), "" );
        console.error( startupMessage );
      }
    }
  }

  _ReplaceNaming( service, namedString ){
    namedString = namedString.replace( "%service%", service || "daemon" );
    this._appCliOptions.map( x => namedString = namedString.replace( "%" + x.name + "%", this.cliOptions[x.name] ));
    return namedString;
  }

  _ValidatePath( dir, reason ){
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