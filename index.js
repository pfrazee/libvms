module.exports = {
  BackendVM: require('./lib/backend-vm'),
  VMFactory: require('./lib/vm-factory'),
  CallLog: require('./lib/call-log'),
  DatArchive: require('node-dat-archive'),
  RPCServer: require('./lib/rpc-server'),
  RPCClient: require('nodevms-client'),
  Verifier: require('./lib/verifier'),
  Swarm: require('./lib/swarm'),
}