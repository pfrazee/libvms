# LibVMS

An API for running cryptographically auditable VMs. Part of [NodeVMS](https://npm.im/nodevms).

## How it works

LibVMS uses the Node VM to execute Javascript files. Its goal is to reduce the trust needed in the host that executes the VM. To accomplish this, it uses [an append-only ledger](https://npm.im/hypercore) to maintain a call log. The call log records the VM script, all RPC calls, and all call results. Additionally, RPC calls may be signed by the keypair of a caller. The log is then distributed on the [Dat network](https://beakerbrowser.com/docs/inside-beaker/dat-files-protocol.html); it can not be forged, and it can not be altered after distribution (alterations are trivial to detect).

Additionally, LibVMS provisions a [Dat files archive](https://npm.im/hyperdrive) for the VM to store state. This files archive is distributed over the Dat network, for clients to freely read. As with the call log, the files archive is backed by an append-only ledger. All of its state changes are recorded in the call log.

The security of LibVMS rests in the unforgeability of its ledgers, and the ability to fully replay the VM history. Any client can download the call log and files archive, instantiate their own copy of the VM, and replay the log to verify the results. If a replay is found to produce mismatched state, we can assume either A) the VM script has nondeterministic behaviors, or B) the host has tampered with the state of the VM. In either case, the VM is no longer trustworthy.

**This is beta software** and subject to changes.

## Examples

### Run a VM

```js
const {BackendVM, RPCServer} = require('libvms')

// read script
const scriptCode = `
  exports.foo = () => 'bar'
`
const dir = './bobs-vm-data'
const title = 'Bobs VM'

// initiate vm
const backendVM = new BackendVM(scriptCode)
await backendVM.deploy({dir, title})
console.log('backend script exports:', Object.keys(backendVM.exports))

// init rpc server
var rpcServer = new RPCServer(backendVM, {port: 5555})
await rpcServer.isReadyPromise
console.log('Serving at localhost:5555')
console.log('Files URL:', backendVM.filesArchive.url)
console.log('Call log URL:', backendVM.callLog.url)
```

### Connect to run commands

```js
const {RPCClient} = require('libvms')

// connect to the server
const client = new RPCClient('ws://localhost:5555')
await client.isReadyPromise

// run the command
console.log(await client.foo()) // => 'bar'
```

### Audit the VM state

```js
const {RPCClient, CallLog, DatArchive, BackendVM} = require('libvms')

// connect to the server
const client = new RPCClient('ws://localhost:5555')
await client.isReadyPromise

// fetch the call log
const callLog = await CallLog.fetch(client.backendInfo.callLogUrl)

// fetch the dat archive
const filesArchive = new DatArchive(client.backendInfo.filesArchiveUrl)
await filesArchive.download('/')

// replay the call log
const backendVM = await BackendVM.fromCallLog(callLog, client.backendInfo, {dir: opts.dir})

// compare outputs (will throw on mismatch)
await Verifier.compareLogs(callLog, backendVM.callLog)
await Verifier.compareArchives(filesArchive, backendVM.filesArchive)
```

## API

```js
const {
  BackendVM,
  CallLog,
  DatArchive,
  Verifier,
  RPCServer,
  RPCClient
} = require('libvms')
```

### BackendVM

```js
const {BackendVM} = require('libvms')

// step 1. instantiate vm with a backend script
var backendVM = new BackendVM(`exports.foo = () => 'bar'`)

// step 2. start the files archive & call log, and eval the script
await backendVM.deploy({
  dir: './foo-backend-data',
  title: 'The Foo Backend'
})

// step 3. start the RPC server
const {RPCServer} = require('libvms')
var server = new RPCServer(backendVM, {port: 5555})
await server.isReadyPromise

// now serving!
// attributes:
backendVM.code // backend script contents
backendVM.exports // the `module.exports` of the backend script
backendVM.filesArchive // the backend's DatArchive
backendVM.callLog // the backend's CallLog

// alternative instantiation: replaying a call log
var backendVM = BackendVM.fromCallLog(callLog, assertions)
// ^ assertions are values in the call log that need to be tested, currently:
//   - filesArchiveUrl: the url expected for the files archive
```

### CallLog

```js
const {CallLog} = require('libvms')

// create, open, or fetch the log
var callLog = CallLog.create(dir, code, filesArchiveUrl)
var callLog = CallLog.open(dir)
var callLog = CallLog.fetch(callLogUrl, dir) // if `dir` is falsy, will use memory

// methods/attrs:
callLog.length // how many entries in the log
await callLog.list({start, end}) // list the entries. start/end optional

// appends (used internally):
await callLog.append(obj)
await callLog.appendInit({code, filesArchiveUrl})
await callLog.appendCall({userId, methodName, args, res, err, filesVersion})
```

### DatArchive

See [node-dat-archive](https://npm.im/node-dat-archive)

### Verifier

```js
const {Verifier} = require('libvms')

await Verifier.compareLogs(callLogA, callLogB)
await Verifier.compareArchives(archiveA, archiveB)
```

### RPCServer

```js
const {RPCServer} = require('libvms')

var server = new RPCServer(backendVM, {port:})
await server.isReadyPromise
server.close()
```

### RPCClient

```js
const {RPCClient} = require('libvms')

const client = new RPCClient(url, {user:}) // 'user' is optional

client.url // => string
client.backendInfo.methods // => Array of strings, the method names
client.backendInfo.callLogUrl // => url of the vm's call log
client.backendInfo.filesArchiveUrl // => url of the vm's files archive

try {
  await client.isReadyPromise
} catch (e) {
  console.error('ERROR: Failed to connect to server')
  console.error(e.message)
}

// all methods exported by the backend will be attached to `client`
await client.foo() // => 'bar'
```