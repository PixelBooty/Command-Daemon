exports.Service = require( "./service.js" ).Service;
exports.startup = function( exec, options ){
  return new exports.Service( exec, options );
}