let fs = require( "fs" );

/**
 * Class that helps bootstrap the application, by setting up events and triggers.
 */
exports.Bootstrapper = class Bootstrapper{
  /**
   * Constructor for Bootstraper.
   */
  constructor( serviceName, service, cliOptions ){
    this.serviceName = serviceName,
    this.service = service;
    this.options = this.service.cliOptions;
    
    this._SetupPid();
    this._LoadConfigFile();
    if( this.options.hookProcessOptions !== false ){
      this.SetupProcessEvents();
    }
  }

  /**
   * Clears the pid out of the file system.
   */
  _ClearPid(){
    fs.unlinkSync( this._pidFile );
  }

  /**
   * Sets up the process events, e.g. exit, SIGINT, and exceptions.
   */
  SetupProcessEvents(){
    process.on( "exit", ( signal ) => {
      this._ClearPid();
    });

    //Process teardown.
    process.on('SIGINT', () => {
      //console.log('Signal exit, closing.\n');
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
  _SetupPid(){
    this._pidFile = this.service._PidLocation( this._serviceName );
    fs.writeFileSync( this._pidFile, process.pid );
    fs.chmodSync( this._pidFile, "0777");
  }

  /**
   * Loads the config file set in the command line arguments.
   */
  _LoadConfigFile(){
    if( this.options.config ){
      this.config = JSON.parse( fs.readFileSync( this.options.config ).toString() );
      this.config.fileName = this.options.config;
    }
  }
}