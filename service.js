const fs = require( "fs" );
const path = require( "path" );
const commandLineArgs = require('command-line-args');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
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
  execute : Function #for single services this will do inline command execution keeping the debugger running intack.
}
*/

exports.Service = class Service{
  constructor( options = {} ){
    this.execScript = path.relative( process.cwd(), this.Caller(2) );
    this.options = options;
    this._CreateCliOptions( [
      { name : "command", alias : 'x', type : String, defaultValue : "start" },
      { name : "killCode", alias : 'k', type : String, defaultValue : "SIGINT" },
      { name : "config", alias : "c", type : String, defaultValue : "" },
      { name : "isBootStrapped", type : Boolean, defaultValue : false }
    ] );

    this._ConfigureProcess( this.cliOptions.service );
    this._YieldProcesses();
  }

  _KillProcess( service ){
    let pid = fs.readFileSync( this._PidLocation( service ) ).toString().trim();
    if( pid.match( /^\d+$/ ) && this._PidDetail( service ) === this._Title( service ) ){
      process.kill( pid, this.cliOptions.killCode );
    }
    if( this.cliOptions.killCode === "SIGTERM" || this.cliOptions.killCode === "SIGKILL" ){
      try{
        fs.unlinkSync( this._PidLocation( service ) );
      }
      catch( ex ){
        //Throw away kill process file errors//
      }
    }
  }

  async _YieldProcesses(){
    if( !this.options.services ){
      this._YieldProcess();
    }
    else{
      if( this.cliOptions.service ){
        this._YieldProcess( this.cliOptions.service )
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

  async _YieldProcess( service ){
    if( this.cliOptions.isBootStrapped ){
      console.log( "--YIELD PROCESS " + service + " FINISHED--" );
      this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this ) );
    }
    else{
      switch( this.cliOptions.command ){
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
          console.log( "Start called" );
          //this._RunCommand( "node", [ "--harmony",  "bootstrap.js", "--service", cliOptions.service, "--spawn", cliOptions.spawn ], false );
          break;
        case "debug":
          if( this._IsStopped( service ) ){
            if( !this.options.services ){
              this.options.execute( new Bootstrapper( service, this ));
            }
            else if( this.options.services.filter( x => x.name === service )[0].pushDebug ){
              this.options.services.filter( x => x.name === service )[0].execute( new Bootstrapper( service, this ) );
            }
            else{
              await this._RunCommand( this._GenerateArguments( service ), true, this.options.services.filter( x => x.name === service )[0].captureInput || false );
            }
          }
          else{
            console.log( this._Title( service ) + " is already running.\nRun 'stop', 'restart', or 'restart-debug'." );
          }
          
          //this._RunCommand( "node", [ "--harmony", "bootstrap.js", "--service", cliOptions.service, "--spawn", cliOptions.spawn ], true, false, ( ) => {
          //  process.exit();
          //} );
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

  _RunCommand( args, watch = false, passinput = false ){
    return new Promise( ( resolve, reject ) => {
      if( watch ){
        let childSpawn = spawn( this.options.exec || "node", args );
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
          console.log( chunk.toString().trim() );
        } );
        childSpawn.stderr.on( 'data', ( chunk ) => {
          console.error( chunk.toString().trim() );
        });
        childSpawn.on( "exit", ( ) => {
          //finishedCallback();
        } );
        //TODO Map STDOUT to find command start and then redirect output//
        resolve();
      }
      else{
        let out = fs.openSync( logOut, 'a');
        let err = fs.openSync( logError, 'a');
        let childSpawn = spawn( this.options.exec || "node", args, {
          detached: true,
          stdio: [ 'ignore', out, err ]
        } );
        childSpawn.unref();
        setTimeout( () => {
          process.exit();
        }, 10000 );
        resolve();
        //TODO Map STDOUT to find command start and then redirect output//
      }
    });
  }

  _PidDetail( service ){
    if( !fs.existsSync( this._PidLocation( service ) ) ){
      return "";
    }
    else{
      let pidNumber = fs.readFileSync( this._PidLocation( service ) ).toString().trim();
      if( pidNumber.match( /^\d+$/) ){
        try{
          return execSync( "ps -p " + pidNumber + " -o command=" ).toString().trim();
        }
        catch( ex ){
          return "";
        }
      }
      return "";
    }
  }

  _IsStopped( service ){
    return !( ( fs.existsSync( this._PidLocation( service ) ) && this._PidDetail( service ) === this._Title( service ) ) );
  }

  _CreateCliOptions( defaultCliOptions ){
    if( this.options.services && this.options.services instanceof Array ){
      defaultCliOptions.push( { name : "service", alias : 's', type : String } );
    }
    let appCliOptions = this.options.cli || [];
    let appCliNames = appCliOptions.map( y => y.name );
    defaultCliOptions.filter( x => appCliNames.indexOf( x.name ) === -1 ).map( x => appCliOptions.push( x ) );
    this._appCliOptions = defaultCliOptions;
    this.cliOptions = commandLineArgs( this._appCliOptions );
  }

  _Title( service ){
    return this._ReplaceNaming( service, this.options.processName || "bootloader-%service%" );
  }

  _PidLocation( service ){
    return this._ReplaceNaming( service, this.options.pid || "run/process-%service%.pid" );
  }

  _ConfigureProcess( service ){
    process.title = this._Title( service );
    this._ValidatePath( path.resolve( path.dirname( this._PidLocation( service ) ) ), "pid file" );
    if( this.options.useLogging === undefined || this.options.useLogging === true ){
      let appendLogs = this.options.appendLogs || false;
      this.stdout = this._ReplaceNaming( service, this.options.stdout || "logs/stdout-%service%.log" );
      this._ValidatePath( path.resolve( path.dirname( this.stdout ) ), "stdout log file" );
      this.stderr = this._ReplaceNaming( service, this.options.stderr || "logs/stderr-%service%.log" );
      this._ValidatePath( path.resolve( path.dirname( this.stderr ) ), "stderr log file" );
      let startupMessage = this.options.startupMessage || "======= Start up " + ( new Date() ) + " =======";
      if( appendLogs ){
        fs.appendFileSync(this.stdout, startupMessage );
        fs.appendFileSync(this.stderr, startupMessage );
      }
      else{
        fs.writeFileSync(this.stdout, startupMessage );
        fs.writeFileSync(this.stderr, startupMessage );
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