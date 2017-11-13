exports.Service = require( "./service.js" ).Service;
exports.startup = function( exec, options ){
  return new exports.Service( exec, options );
}
//exports.bootstrap = function( cliOptsFile ){
//  var bootstrap = require( "./Bootstrapper.js" ).bootstrap( cliOptsFile );
//  bootstrap.Init();
//  bootstrap.SetupProcessEvents();
//  return bootstrap;
//};
