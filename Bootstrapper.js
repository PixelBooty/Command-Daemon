const fs = require( "fs" );
const spawn = require('child_process').spawn;

/**
 * Class that helps bootstrap the application, by setting up events and triggers.
 */
exports.Bootstrapper = class Bootstrapper{
  /**
   * Constructor for Bootstraper.
   */
  constructor( serviceName, service, bootstrapProcess = true ){
    this._serviceName = serviceName,
    this._bootstrapProcess = bootstrapProcess;
    this.service = service;
    this.options = this.service.cliOptions;
    this._closers = [];
    if( this._bootstrapProcess ){
      this._setupPid();
      this._loadConfigFile();
    }
    else{
      this._loadConfigFile();
      if( this.options.hookProcessOptions !== false ){
        this.setupProcessEvents();
      }
    }
    
  }

  /**
   * Clears the pid out of the file system.
   */
  _clearPid(){
    fs.unlinkSync( this._pidFile );
  }

  onclose( method ){
    if( method instanceof Function ){
      //The coffee is for closers!
      this._closers.push( method );
    }
  }

  task( command, options = {}, onclose = null ){
    if( !options.env ){
      options.env = process.env;
    }
    let killSignal = options.killSignal || null;
    let args = command.split( " " );
    command = args[0];
    args.splice( 0, 1 );
    let childSpawn = spawn( command, args, options );
    childSpawn.stdout.on( 'data', ( chunk ) => {
      console.log( chunk.toString().trim() );
    } );
    childSpawn.stderr.on( 'data', ( chunk ) => {
      console.error( chunk.toString().trim() );
    });
    childSpawn.on( "exit", ( ) => {
      console.log( `Task '${command} ${args.join(" ")}' CLOSED!` );
      if( onclose !== null ){
        onclose();
      }
    } );

    this.onclose( ( signal ) => {
      childSpawn.kill( killSignal || signal );
    });

    return childSpawn;
  }

  /**
   * Sets up the process events, e.g. exit, SIGINT, and exceptions.
   */
  setupProcessEvents(){
    process.on( "exit", ( signal ) => {
      for( let i = 0; i < this._closers.length; i++ ){
        this._closers[i]( signal );
      }
    });

    //Process teardown.
    process.on('SIGINT', () => {
      console.log('Signal exit, closing.\n');
      for( let i = 0; i < this._closers.length; i++ ){
        this._closers[i]( 'SIGINT' );
      }
      this._closers = [];
      process.exit();
    });

    //Crash event handle.
    process.on('uncaughtException', (err) => {
      console.error('Caught Exception:', err );
    });

    process.on('unhandledRejection', (reason, p) => {
      console.error('Caught Rejection:', reason );
      // application specific logging, throwing an error, or other logic here
    });
  }

  /**
   * Creates the pid file and makes sure it can be manipulated if the application changes user.
   */
  _setupPid(){
    this._pidFile = this.service._pidLocation( this._serviceName );
    fs.writeFileSync( this._pidFile, process.pid.toString() );
    fs.chmodSync( this._pidFile, "0777");
    process.on( "exit", ( signal ) => {
      this._clearPid();
    });
  }

  /**
   * Loads the config file set in the command line arguments.
   */
  _loadConfigFile(){
    if( this.service.configFile ){
      this.options.config = this.service.configFile;
    }
    if( this.options.config ){
      let configFile = this.service._replaceNaming( this._serviceName, this.options.config );
      if( fs.existsSync( configFile ) ){
        try{
          this.config = require( configFile );
          this.config.fileName = configFile;
        }
        catch( ex ){
          console.error( `Unable to require config file ${configFile}.` );
        }
      }
      else{
        if( this._bootstrapProcess ){
          console.error( `Missing config file at ${configFile} using blank config.` )
        }
      }
    }
    this.config = this.config || {};
    if( this.config.debug === undefined ){
      this.config.debug = ( this.service.cliOptions.command === "debug" || this.service.cliOptions.command === "restart-debug" );
    }
  }
}